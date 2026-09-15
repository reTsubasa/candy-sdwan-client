import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import canonicalize from "canonicalize";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const contracts = path.join(root, "contracts");
const examples = path.join(contracts, "examples");

function readJson(fullPath) {
  try { return JSON.parse(fs.readFileSync(fullPath, "utf8")); }
  catch (error) { throw new Error(`${path.relative(root, fullPath)}: invalid JSON: ${error.message}`); }
}
function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function expectReject(label, callback) {
  try { callback(); } catch { return; }
  fail(`${label}: expected rejection`);
}
function uuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: false });
const schemaFiles = fs.readdirSync(contracts).filter((file) => file.endsWith(".schema.json"));
const schemaObjects = Object.fromEntries(schemaFiles.map((file) => [file, readJson(path.join(contracts, file))]));
for (const file of schemaFiles) ajv.addSchema(schemaObjects[file]);
const schemas = Object.fromEntries(schemaFiles.map((file) => [file, ajv.getSchema(schemaObjects[file].$id)]));
function validateSchema(file, value) {
  const valid = schemas[file](value);
  assert(valid, `${file}: ${ajv.errorsText(schemas[file].errors)}`);
}

function unsignedProjection(projection) {
  const unsigned = structuredClone(projection);
  delete unsigned.signature;
  delete unsigned.content_hash;
  return unsigned;
}

function checkProjectionSemantics(projection, signatureVector) {
  assert(projection.not_before <= projection.issued_at, "projection issued_at precedes not_before");
  assert(projection.issued_at <= projection.stale_until, "projection stale_until precedes issued_at");
  assert(projection.stale_until <= projection.grant_expires_at, "projection stale_until exceeds grant expiry");
  assert(projection.audience.tenant_id === projection.tenant_id, "projection audience tenant mismatch");
  assert(projection.audience.user_id === projection.user_id, "projection audience user mismatch");
  assert(projection.audience.device_id === projection.device_id, "projection audience device mismatch");
  assert(projection.audience.device_key_id === projection.device_key_id, "projection audience key mismatch");
  assert(projection.mode_capabilities.includes(projection.traffic_mode), "traffic_mode is not in mode_capabilities");
  const assignments = [projection.selected_node, ...projection.standby_nodes];
  const nodeIds = new Set();
  for (const node of assignments) {
    assert(!nodeIds.has(node.node_id), `duplicate node assignment ${node.node_id}`);
    nodeIds.add(node.node_id);
    assert(node.assignment_lease_until <= projection.stale_until, "node lease exceeds projection stale_until");
  }
  assert(nodeIds.has(projection.global_egress.node_id), "global egress node is not assigned");
  if (projection.traffic_mode === "global") {
    assert(projection.global_egress.enabled === true, "global mode requires global egress");
    assert(projection.global_egress.dns_egress !== "none", "global mode requires DNS egress");
  } else {
    assert(projection.global_egress.enabled === false, "policy mode cannot enable global egress");
    assert(projection.global_egress.dns_egress === "none", "policy mode cannot use DNS egress");
  }
  const canonical = canonicalize(unsignedProjection(projection));
  assert(typeof canonical === "string", "projection canonicalization returned no bytes");
  const hash = crypto.createHash("sha256").update(canonical, "utf8").digest();
  assert(projection.content_hash === `sha256:${hash.toString("hex")}`, "projection content_hash does not match RFC8785 payload");
  assert(projection.signing_key_id === signatureVector.signing_key_id, "projection signing key is not in trusted test vector");
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const publicKey = crypto.createPublicKey({ key: Buffer.concat([spkiPrefix, Buffer.from(signatureVector.public_key_base64, "base64")]), format: "der", type: "spki" });
  const signedMessage = Buffer.concat([Buffer.from(signatureVector.domain, "utf8"), hash]);
  assert(crypto.verify(null, signedMessage, publicKey, Buffer.from(projection.signature, "base64")), "projection Ed25519 signature is invalid");
  assert(projection.signature === signatureVector.signature_base64, "projection signature does not match fixed vector");
}

const allowedStates = {
  identity: new Set(["unregistered", "authenticating", "authenticated", "expired", "revoked", "error"]),
  control_plane: new Set(["offline", "connecting", "online", "stale", "revoked"]),
  policy: new Set(["none", "syncing", "staged", "active", "rejected", "expired"]),
  node_assignment: new Set(["none", "assigned", "lease_expired", "degraded"]),
  data_plane: new Set(["stopped", "preparing", "connecting", "connected", "draining", "degraded", "failed"]),
  traffic: new Set(["idle", "active", "blocked", "fail_open", "degraded"]),
  display: new Set(["disconnected", "connecting", "connected", "degraded", "action_required", "unavailable"])
};
const agentMethods = new Set(["get_status", "connect", "disconnect", "request_traffic_mode", "get_identity", "get_policy_status", "get_diagnostics", "logout", "subscribe_status", "get_capabilities", "cancel"]);
function checkStatusSemantics(status) {
  const t = status.last_transition;
  assert(t.occurred_at <= status.reported_at, "last transition is after status report");
  assert(t.from !== t.to, "last transition has identical from/to values");
  assert(allowedStates[t.dimension].has(t.from), "last transition from value is invalid for dimension");
  assert(allowedStates[t.dimension].has(t.to), "last transition to value is invalid for dimension");
  assert(t.to === status[t.dimension], "last transition does not describe current status");
  if (status.display === "connected") {
    assert(status.identity === "authenticated", "connected display requires authenticated identity");
    assert(status.control_plane === "online" || status.control_plane === "stale", "connected display requires online control plane");
    assert(status.policy === "active", "connected display requires active policy");
    assert(status.node_assignment === "assigned", "connected display requires assigned node");
    assert(status.data_plane === "connected", "connected display requires connected data plane");
    assert(status.health === "healthy" || status.health === "degraded", "connected display requires usable health");
  }
  if (status.identity !== "authenticated") assert(status.data_plane !== "connected", "unauthenticated status cannot have connected data plane");
}
function checkEventSemantics(event) {
  assert(event.from.dimension === event.to.dimension, "status event changes more than one dimension");
  assert(event.from.value !== event.to.value, "status event has identical from/to values");
  assert(allowedStates[event.from.dimension].has(event.from.value), "status event from value is invalid");
  assert(allowedStates[event.to.dimension].has(event.to.value), "status event to value is invalid");
}
function checkClientControlSemantics(message) {
  const payload = message.payload;
  if (message.message_type === "register_device_response") {
    assert(payload.grant.device_id === payload.device_id, "Client Grant device binding mismatch");
    assert(payload.grant.device_key_id === payload.device_key_id, "Client Grant key binding mismatch");
    assert(payload.grant.expires_at > payload.grant.issued_at, "Client Grant expiry must follow issue time");
  }
  if (message.message_type === "projection_response") {
    assert(payload.projection.device_id === payload.device_id, "Projection response device binding mismatch");
    assert(payload.projection.device_key_id === payload.device_key_id, "Projection response key binding mismatch");
    assert(payload.projection.grant_id === payload.grant_id, "Projection response Grant binding mismatch");
    checkProjectionSemantics(payload.projection, signatureVector);
  }
  if (message.message_type === "receipt_request") {
    assert(payload.device_id === projection.device_id, "receipt device binding mismatch");
    assert(payload.device_key_id === projection.device_key_id, "receipt key binding mismatch");
    assert(payload.projection_id === projection.projection_id, "receipt projection binding mismatch");
    assert(payload.content_hash === projection.content_hash, "receipt content hash mismatch");
  }
}

const projection = readJson(path.join(examples, "policy_projection.json"));
const status = readJson(path.join(examples, "agent_status.json"));
const request = readJson(path.join(examples, "agent_request.json"));
const response = readJson(path.join(examples, "agent_response.json"));
const capabilities = readJson(path.join(examples, "agent_capabilities.json"));
const event = readJson(path.join(examples, "status_event.json"));
const telemetry = readJson(path.join(examples, "telemetry_event.json"));
const errors = readJson(path.join(contracts, "error_codes.json"));
const signatureVector = readJson(path.join(examples, "signature_vector.json"));
const clientControlExamples = [
  "client_register_request.json",
  "client_register_response.json",
  "client_projection_response.json",
  "client_receipt_request.json",
  "client_receipt_response.json",
  "client_revoke_response.json"
].map((file) => readJson(path.join(examples, file)));
const errorCodes = new Map(errors.codes.map((entry) => [entry.code, entry]));
assert(errorCodes.size === errors.codes.length, "error registry contains duplicate codes");
for (const entry of errors.codes) {
  assert(entry.code.startsWith(`${entry.code.split("_")[0]}_`), `error code has invalid namespace: ${entry.code}`);
}

validateSchema("policy_projection.schema.json", projection);
validateSchema("agent_status.schema.json", status);
validateSchema("agent_request.schema.json", request);
validateSchema("agent_response.schema.json", response);
validateSchema("agent_capabilities.schema.json", capabilities);
validateSchema("status_event.schema.json", event);
validateSchema("telemetry_event.schema.json", telemetry);
validateSchema("error_registry.schema.json", errors);
for (const example of clientControlExamples) validateSchema("client_control.schema.json", example);
checkProjectionSemantics(projection, signatureVector);
checkStatusSemantics(status);
checkEventSemantics(event);
for (const example of clientControlExamples) checkClientControlSemantics(example);
assert(errorCodes.has(telemetry.code), `telemetry code is not registered: ${telemetry.code}`);
assert(errorCodes.get(telemetry.code).owner === telemetry.source, "telemetry source does not own error code");
assert(errorCodes.get(telemetry.code).severity === telemetry.severity, "telemetry severity disagrees with registry");
assert(errorCodes.get(telemetry.code).retryable === telemetry.retryable, "telemetry retryability disagrees with registry");

const audienceMismatch = structuredClone(projection);
audienceMismatch.audience.device_id = "44444444-4444-4444-8444-444444444445";
expectReject("audience mismatch", () => checkProjectionSemantics(audienceMismatch, signatureVector));
const tampered = structuredClone(projection);
tampered.allowed_resources[0].ports[0] = 8443;
expectReject("signature tamper", () => checkProjectionSemantics(tampered, signatureVector));
const stale = structuredClone(projection);
stale.stale_until = stale.grant_expires_at + 1;
expectReject("stale window beyond grant", () => {
  validateSchema("policy_projection.schema.json", stale);
  checkProjectionSemantics(stale, signatureVector);
});
const duplicate = structuredClone(projection);
duplicate.standby_nodes[0].node_id = duplicate.selected_node.node_id;
expectReject("duplicate node assignment", () => checkProjectionSemantics(duplicate, signatureVector));
const badStatus = structuredClone(status);
badStatus.display = "connected";
badStatus.data_plane = "failed";
expectReject("invalid status combination", () => {
  validateSchema("agent_status.schema.json", badStatus);
  checkStatusSemantics(badStatus);
});
const badEvent = structuredClone(event);
badEvent.to.dimension = "display";
expectReject("multi-dimension status event", () => {
  validateSchema("status_event.schema.json", badEvent);
  checkEventSemantics(badEvent);
});
const extraField = structuredClone(request);
extraField.payload.unexpected = true;
expectReject("request payload boundary", () => validateSchema("agent_request.schema.json", extraField));
const unknownMethod = structuredClone(request);
unknownMethod.method = "debug_dump";
expectReject("unknown Agent method", () => validateSchema("agent_request.schema.json", unknownMethod));
for (const method of capabilities.methods) assert(agentMethods.has(method), `capabilities advertise unknown method ${method}`);
assert(capabilities.methods.includes("get_capabilities"), "capabilities discovery method is missing");
const unregisteredTelemetry = structuredClone(telemetry);
unregisteredTelemetry.code = "unknown_error_code";
expectReject("unregistered telemetry code", () => {
  validateSchema("telemetry_event.schema.json", unregisteredTelemetry);
  assert(errorCodes.has(unregisteredTelemetry.code), "unregistered telemetry code accepted");
});
const duplicateErrorRegistry = structuredClone(errors);
duplicateErrorRegistry.codes[1].code = duplicateErrorRegistry.codes[0].code;
expectReject("duplicate error code", () => {
  const codes = new Set(duplicateErrorRegistry.codes.map((entry) => entry.code));
  assert(codes.size === duplicateErrorRegistry.codes.length, "duplicate error code accepted");
});
const mismatchedClientResponse = structuredClone(clientControlExamples[1]);
mismatchedClientResponse.payload.grant.device_id = "99999999-9999-4999-8999-999999999999";
expectReject("Client Grant cross-device binding", () => checkClientControlSemantics(mismatchedClientResponse));
const mismatchedReceipt = structuredClone(clientControlExamples[3]);
mismatchedReceipt.payload.content_hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
expectReject("Client receipt content binding", () => checkClientControlSemantics(mismatchedReceipt));
assert(uuid(projection.device_id), "fixture UUID sanity check failed");
console.log("PASS contracts: JSON Schema, semantic constraints, Agent API, status model, and Ed25519 vector");

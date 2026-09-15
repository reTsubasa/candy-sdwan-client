import http from "node:http";
import process from "node:process";
import { URL } from "node:url";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const projection = JSON.parse(fs.readFileSync(path.join(root, "contracts/examples/policy_projection.json"), "utf8"));
const faults = new Set((process.env.SDWAN_TEST_FAULTS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const delayMs = Number.parseInt(process.env.SDWAN_TEST_DELAY_MS ?? "0", 10);
const dropPercent = Number.parseInt(process.env.SDWAN_TEST_DROP_PERCENT ?? "0", 10);
const cloudPort = Number.parseInt(process.env.SDWAN_CLOUD_PORT ?? "0", 10);
const nodePort = Number.parseInt(process.env.SDWAN_NODE_PORT ?? "0", 10);
const clockOffsetSeconds = Number.parseInt(process.env.SDWAN_TEST_CLOCK_OFFSET_SECONDS ?? "0", 10);
let revoked = false;
let requestCounter = 0;

function responseJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function faulted(kind) {
  if (faults.has(kind)) return true;
  if (dropPercent <= 0) return false;
  requestCounter += 1;
  return requestCounter % 100 < dropPercent;
}

function withFaults(kind, handler) {
  return async (req, res) => {
    if (faulted(kind)) return responseJson(res, 503, { error: "injected_fault", kind });
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return handler(req, res);
  };
}

const cloud = http.createServer();
cloud.on("request", withFaults("cloud-offline", (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/health") return responseJson(res, 200, { service: "mock-cloud", control_plane: "online", clock_offset_seconds: clockOffsetSeconds });
  if (url.pathname === "/v1/client/projection" && req.method === "GET") {
    if (revoked) return responseJson(res, 410, { error: "grant_revoked", code: "auth_device_revoked" });
    return responseJson(res, 200, { projection, source: "mock-cloud", issued_at: projection.issued_at + clockOffsetSeconds });
  }
  if (url.pathname === "/v1/client/revoke" && req.method === "POST") {
    revoked = true;
    return responseJson(res, 202, { accepted: true, revoked: true });
  }
  return responseJson(res, 404, { error: "not_found" });
}));

const node = http.createServer();
node.on("request", withFaults("node-offline", (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/health") return responseJson(res, 200, { service: "mock-node", data_plane: "ready" });
  if (url.pathname === "/v1/peer/authorize" && req.method === "POST") {
    if (revoked) return responseJson(res, 403, { accepted: false, code: "auth_device_revoked" });
    return responseJson(res, 200, { accepted: true, authorization: "projection_and_grant_validated" });
  }
  return responseJson(res, 404, { error: "not_found" });
}));

await Promise.all([
  new Promise((resolve) => cloud.listen(cloudPort, "127.0.0.1", resolve)),
  new Promise((resolve) => node.listen(nodePort, "127.0.0.1", resolve))
]);

const actualCloudPort = cloud.address().port;
const actualNodePort = node.address().port;

console.log(JSON.stringify({
  cloud: `http://127.0.0.1:${actualCloudPort}`,
  node: `http://127.0.0.1:${actualNodePort}`,
  data_plane: "mocked_authorization_only",
  faults: [...faults],
  delay_ms: delayMs,
  drop_percent: dropPercent,
  clock_offset_seconds: clockOffsetSeconds,
  test_key_source: "fixtures_only"
}));

function shutdown() {
  cloud.close();
  node.close();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

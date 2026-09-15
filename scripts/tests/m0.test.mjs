import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function startEnv(extraEnv = {}) {
  const child = spawn(process.execPath, ["scripts/dev_env.mjs"], {
    cwd: root,
    env: { ...process.env, SDWAN_CLOUD_PORT: "0", SDWAN_NODE_PORT: "0", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  return { child, ready: new Promise((resolve, reject) => {
    child.stdout.on("data", () => {
      try { resolve(JSON.parse(output.trim().split("\n").at(-1))); } catch { /* wait for complete line */ }
    });
    child.once("error", reject);
  }) };
}

async function stopEnv(child) {
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 500))]);
}

test("M0 local Cloud/Node environment exposes control-plane-only health", async () => {
  const env = startEnv();
  const urls = await env.ready;
  try {
    const [cloud, node] = await Promise.all([fetch(`${urls.cloud}/health`), fetch(`${urls.node}/health`)]);
    assert.equal(cloud.status, 200);
    assert.equal(node.status, 200);
    assert.equal((await cloud.json()).service, "mock-cloud");
    assert.equal((await node.json()).service, "mock-node");
  } finally {
    await stopEnv(env.child);
  }
});

test("M0 fault injection makes Cloud and Node unavailable deterministically", async () => {
  const env = startEnv({ SDWAN_TEST_FAULTS: "cloud-offline,node-offline", SDWAN_TEST_DELAY_MS: "2", SDWAN_TEST_CLOCK_OFFSET_SECONDS: "120" });
  const urls = await env.ready;
  try {
    const [cloud, node] = await Promise.all([fetch(`${urls.cloud}/health`), fetch(`${urls.node}/health`)]);
    assert.equal(cloud.status, 503);
    assert.equal(node.status, 503);
  } finally {
    await stopEnv(env.child);
  }
});

test("M0 fault injection reports measurable delay and clock offset", async () => {
  const env = startEnv({ SDWAN_TEST_DELAY_MS: "40", SDWAN_TEST_CLOCK_OFFSET_SECONDS: "120" });
  const urls = await env.ready;
  try {
    const started = performance.now();
    const response = await fetch(`${urls.cloud}/health`);
    const elapsed = performance.now() - started;
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.clock_offset_seconds, 120);
    assert.ok(elapsed >= 30, `expected injected delay, got ${elapsed.toFixed(1)}ms`);
  } finally {
    await stopEnv(env.child);
  }
});

test("M0 fault injection can deterministically drop every request", async () => {
  const env = startEnv({ SDWAN_TEST_DROP_PERCENT: "100" });
  const urls = await env.ready;
  try {
    const response = await fetch(`${urls.cloud}/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "injected_fault", kind: "cloud-offline" });
  } finally {
    await stopEnv(env.child);
  }
});

test("M0 revoke closes the mock authorization path", async () => {
  const env = startEnv();
  const urls = await env.ready;
  try {
    const before = await fetch(`${urls.node}/v1/peer/authorize`, { method: "POST" });
    assert.equal(before.status, 200);
    const revoke = await fetch(`${urls.cloud}/v1/client/revoke`, { method: "POST" });
    assert.equal(revoke.status, 202);
    const projection = await fetch(`${urls.cloud}/v1/client/projection`);
    const after = await fetch(`${urls.node}/v1/peer/authorize`, { method: "POST" });
    assert.equal(projection.status, 410);
    assert.equal(after.status, 403);
    assert.equal((await after.json()).code, "auth_device_revoked");
  } finally {
    await stopEnv(env.child);
  }
});

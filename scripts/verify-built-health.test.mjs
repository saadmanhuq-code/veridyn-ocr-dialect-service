import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { test } from "node:test";

const repoRoot = process.cwd();
const nextBin = join(repoRoot, "node_modules", "next", "dist", "bin", "next");

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const { port } = address;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

async function waitForHealth(url, child, output) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Built server exited ${child.exitCode} before health was ready:\n${output()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for built health route:\n${output()}`);
}

test("built /api/health returns a non-null deployed commit SHA without runtime env", async () => {
  assert.equal(existsSync(join(repoRoot, ".next", "BUILD_ID")), true, "run npm run build before this test");

  const port = await availablePort();
  const childEnv = { ...process.env };
  delete childEnv.VERCEL_GIT_COMMIT_SHA;
  let output = "";
  const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: repoRoot,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-8_000);
  });
  child.stderr.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-8_000);
  });

  try {
    const response = await waitForHealth(`http://127.0.0.1:${port}/api/health`, child, () => output);
    const body = await response.json();
    assert.match(body.runtime_sha, /^[0-9a-f]{7,64}$/i);
    assert.equal(body.commit_sha, body.runtime_sha);
    assert.notEqual(body.runtime_sha, null);
  } finally {
    if (child.exitCode === null) child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", resolve);
      setTimeout(resolve, 5_000);
    });
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});

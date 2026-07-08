/**
 * Deploy-identity binding regression test for /api/health.
 *
 * Confirms the health endpoint's JSON body — not just the source code —
 * exposes `runtime_sha`, `commit_sha`, and `contract_version`, so a remote-truth probe can
 * verify WHICH build is actually serving traffic, not just that some build
 * responds 200.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { GET } from "../app/api/health/route.js";
import pkg from "@/package.json";

test("health route: commit_sha is null when VERCEL_GIT_COMMIT_SHA is unset", async () => {
  const previous = process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    const res = await GET(new NextRequest("http://localhost/api/health"));
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.runtime_sha, null, "runtime_sha should be null with no VERCEL_GIT_COMMIT_SHA");
    assert.equal(body.commit_sha, null, "commit_sha should be null with no VERCEL_GIT_COMMIT_SHA");
    assert.equal(
      body.contract_version,
      pkg.version,
      "contract_version should mirror package.json version",
    );
  } finally {
    if (previous === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = previous;
  }
});

test("health route: commit_sha reflects VERCEL_GIT_COMMIT_SHA when set (deploy identity)", async () => {
  const previous = process.env.VERCEL_GIT_COMMIT_SHA;
  process.env.VERCEL_GIT_COMMIT_SHA = "abc123deadbeef";
  try {
    const res = await GET(new NextRequest("http://localhost/api/health"));
    const body = await res.json();
    assert.equal(body.runtime_sha, "abc123deadbeef");
    assert.equal(body.commit_sha, "abc123deadbeef");
  } finally {
    if (previous === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = previous;
  }
});

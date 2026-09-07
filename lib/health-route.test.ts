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

import { GET, resolveRuntimeSha } from "../app/api/health/route.js";
import { BUILD_COMMIT_SHA } from "@/lib/generated-build-info";
import pkg from "@/package.json";

test("health route: built artifact SHA fallback is never null", async () => {
  const previous = process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    const res = await GET(new NextRequest("http://localhost/api/health"));
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(BUILD_COMMIT_SHA, /^[0-9a-f]{7,64}$/i, "generated build SHA must identify a commit");
    assert.equal(body.runtime_sha, BUILD_COMMIT_SHA);
    assert.equal(body.commit_sha, BUILD_COMMIT_SHA);
    assert.notEqual(body.runtime_sha, null);
    assert.notEqual(body.commit_sha, null);
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

test("resolveRuntimeSha: prefers the first non-empty candidate in priority order", () => {
  assert.equal(
    resolveRuntimeSha(["  ", undefined, "build-time-sha", "should-not-be-reached"]),
    "build-time-sha",
  );
});

test("resolveRuntimeSha: falls back to explicit 'unknown' only when every candidate is empty/unset", () => {
  assert.equal(resolveRuntimeSha([undefined, null, "", "   "]), "unknown");
  assert.equal(resolveRuntimeSha([]), "unknown");
});

test("health route: GIT_COMMIT_SHA (build-time env) is used when VERCEL_GIT_COMMIT_SHA is unset", async () => {
  const previousVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  const previousGit = process.env.GIT_COMMIT_SHA;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  process.env.GIT_COMMIT_SHA = "build-env-sha-1234567";
  try {
    const res = await GET(new NextRequest("http://localhost/api/health"));
    const body = await res.json();
    assert.equal(body.runtime_sha, "build-env-sha-1234567");
    assert.equal(body.commit_sha, "build-env-sha-1234567");
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = previousVercel;
    if (previousGit === undefined) delete process.env.GIT_COMMIT_SHA;
    else process.env.GIT_COMMIT_SHA = previousGit;
  }
});

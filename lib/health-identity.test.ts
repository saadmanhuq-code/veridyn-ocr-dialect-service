import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveBuildIdentity } from "./health-identity";

test("resolveBuildIdentity: VERCEL_GIT_COMMIT_SHA wins the chain", () => {
  const id = resolveBuildIdentity({
    VERCEL_GIT_COMMIT_SHA: "vercel-sha",
    GIT_COMMIT_SHA: "git-sha",
    COMMIT_SHA: "plain-sha",
    BUILD_COMMIT_SHA: "build-sha",
  });
  assert.deepEqual(id, { commit_sha: "vercel-sha", sha_source: "VERCEL_GIT_COMMIT_SHA" });
});

test("resolveBuildIdentity: falls back to injected SHAs on CLI deploys", () => {
  assert.deepEqual(resolveBuildIdentity({ GIT_COMMIT_SHA: "git-sha" }), {
    commit_sha: "git-sha",
    sha_source: "GIT_COMMIT_SHA",
  });
  assert.deepEqual(resolveBuildIdentity({ COMMIT_SHA: "plain-sha" }), {
    commit_sha: "plain-sha",
    sha_source: "COMMIT_SHA",
  });
  assert.deepEqual(resolveBuildIdentity({ BUILD_COMMIT_SHA: "build-sha" }), {
    commit_sha: "build-sha",
    sha_source: "BUILD_COMMIT_SHA",
  });
});

test("resolveBuildIdentity: blank/whitespace values are skipped, value is trimmed", () => {
  const id = resolveBuildIdentity({
    VERCEL_GIT_COMMIT_SHA: "   ",
    GIT_COMMIT_SHA: "  abc123  ",
  });
  assert.deepEqual(id, { commit_sha: "abc123", sha_source: "GIT_COMMIT_SHA" });
});

test("resolveBuildIdentity: nothing set -> nulls (existing health contract allows null)", () => {
  assert.deepEqual(resolveBuildIdentity({}), { commit_sha: null, sha_source: null });
});

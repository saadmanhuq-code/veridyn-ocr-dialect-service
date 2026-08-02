import assert from "node:assert/strict";
import { test } from "node:test";

import { selectBuildCommitSha } from "../scripts/generate-build-info.mjs";

const COMMIT_SHA = "1234567890abcdef1234567890abcdef12345678";

test("build identity rejects dirty Git fallback for production artifacts", () => {
  assert.throws(
    () =>
      selectBuildCommitSha({
        authoritativeCandidates: [],
        gitSha: COMMIT_SHA,
        dirty: true,
      }),
    /Refusing to stamp git HEAD onto a dirty build/,
  );
});

test("build identity accepts clean Git fallback", () => {
  assert.equal(
    selectBuildCommitSha({
      authoritativeCandidates: [],
      gitSha: COMMIT_SHA,
      dirty: false,
    }),
    COMMIT_SHA,
  );
});

test("authoritative deployment SHA takes precedence over dirty local Git state", () => {
  const deploySha = "abcdef1234567890abcdef1234567890abcdef12";
  assert.equal(
    selectBuildCommitSha({
      authoritativeCandidates: [deploySha],
      gitSha: COMMIT_SHA,
      dirty: true,
    }),
    deploySha,
  );
});

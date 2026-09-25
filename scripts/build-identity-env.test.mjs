import assert from "node:assert/strict";
import { test } from "node:test";

import { authoritativeShaCandidates, selectBuildCommitSha } from "./generate-build-info.mjs";

const OPERATOR_SHA = "f527dc7f3d2b1a0c9e8d7f6a5b4c3d2e1f0a9b8c";

test("build identity accepts operator GIT_COMMIT_SHA when the build has no Git metadata", () => {
  assert.equal(
    selectBuildCommitSha({
      authoritativeCandidates: authoritativeShaCandidates({ GIT_COMMIT_SHA: OPERATOR_SHA }),
      gitSha: "",
      dirty: false,
    }),
    OPERATOR_SHA,
  );
});

test("platform-provided SHAs keep precedence over GIT_COMMIT_SHA", () => {
  const vercelSha = "abcdef1234567890abcdef1234567890abcdef12";
  assert.equal(
    selectBuildCommitSha({
      authoritativeCandidates: authoritativeShaCandidates({
        VERCEL_GIT_COMMIT_SHA: vercelSha,
        GIT_COMMIT_SHA: OPERATOR_SHA,
      }),
      gitSha: "",
      dirty: false,
    }),
    vercelSha,
  );
});

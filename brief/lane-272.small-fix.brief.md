# Lane 272: build identity accepts operator GIT_COMMIT_SHA

## Observed

anchor-probe:freshness is red for veridyn-ocr: `runtime sha unverifiable`. Live
`https://veridyn-ocr-dialect-service.vercel.app/api/health` (2026-09-25T05:52Z) returns
`{"ok":true,"runtime_sha":null,"commit_sha":null,"contract_version":"1.0.0"}`. Only pre-2026-08-03
source can return null (`6963355` `app/api/health/route.ts`: `VERCEL_GIT_COMMIT_SHA || null`), so
production is a stale CLI deploy. Current main already exposes a non-null `runtime_sha`.

## Cause

The documented deploy is `npx vercel deploy --prod` from the CLI. A CLI deploy uploads no `.git`, and
`scripts/generate-build-info.mjs` (the `prebuild` step) only trusted `VERCEL_GIT_COMMIT_SHA`,
`GITHUB_SHA` or `CI_COMMIT_SHA` before falling back to `git rev-parse HEAD`. It ignored the
`GIT_COMMIT_SHA` override that the runtime chain in `lib/health-identity.ts` already honours. A
Git-less build that has only `GIT_COMMIT_SHA` therefore failed with "Cannot determine build commit
SHA" instead of stamping the commit, which blocks the redeploy that clears the probe.

## Change

- `scripts/generate-build-info.mjs`: exported `authoritativeShaCandidates(env)` (Vercel, GitHub, GitLab
  CI, then `GIT_COMMIT_SHA`) and used it for the build stamp. Existing precedence is unchanged, and
  the dirty-tree refusal and SHA pattern check still apply.
- `README.md`: the deploy command passes `GIT_COMMIT_SHA` as both build and runtime env.
- `scripts/build-identity-env.test.mjs`: new focused test.

The probe turns green only after an operator redeploys main to production. This MR does not deploy.

## Files

- `scripts/generate-build-info.mjs`
- `scripts/build-identity-env.test.mjs`
- `README.md`

## Acceptance checks

- machine: `node --test scripts/build-identity-env.test.mjs`

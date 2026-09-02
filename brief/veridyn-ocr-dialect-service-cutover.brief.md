# Cutover brief — veridyn-ocr-dialect-service through the gate

**Lane:** #51 on `ss-group3592724/gate`. **Depends on:** #64, #36 (both closed).
**GitLab project:** `ss-group3592724/veridyn-ocr-dialect-service` (id 83720216).
**GitHub twin:** `saadmanhuq-code/veridyn-ocr-dialect-service`.

## What this MR changes

- `.gitlab-ci.yml` — reduced from a full local pipeline definition to a bare include pointer at
  `ci.yml@ss-group3592724/gate`. The actual pipeline source of truth becomes the GitLab project
  setting `ci_config_path=ci.yml@ss-group3592724/gate` (set via the API, not this file); this
  file is left in place only so a local read of the repo still shows where CI comes from.
- `brief/veridyn-ocr-dialect-service-cutover.brief.md` — this file.
- `brief/lane-51.brief.md` — the lane-level brief (WorkOrder compiler was gated behind
  `requires_fable_keystone`, unavailable to this seat; manual fallback per lane instructions).
- Project setting `ci_config_path` on GitLab project 83720216 → `ci.yml@ss-group3592724/gate`.
- GitHub Actions workflows on the GitHub twin → disabled (`disabled_manually`).
- GitLab push mirror from project 83720216 → the GitHub twin, `only_protected_branches: true`.

No change is needed in the `gate` project itself: `products/veridyn-ocr-dialect-service.yml`
(Tier 1 `ci` job = `npm ci && npm test`, this product's real test command) and
`products/veridyn-ocr-dialect-service.scripts.sha256` (digest matches this repo's current
`package.json` scripts block) already exist on gate `main`, landed by lanes #64 and #36.

## Two executable acceptance checks

1. **CI config path is live on the gate:**
   ```
   glab api projects/83720216 --jq .ci_config_path
   # expect: ci.yml@ss-group3592724/gate
   ```
   Red before this MR (empty string); green after `PUT /projects/83720216` runs.

2. **A pipeline reaches the gate's `ci` job and dispatches a downstream gate pipeline:**
   ```
   glab api "projects/83720216/pipelines?ref=lane/51-veridyn-ocr-dialect-service-build-throug&per_page=1" --jq '.[0].id'
   glab api projects/83720216/pipelines/<id>/jobs --jq '[.[] | {name, status}]'
   # expect a job named "ci" with status "success", and a "scripts-lock" job whose downstream
   # (triggered) gate pipeline has at least one job
   ```
   Red before this MR (no such job exists under the product's own `.gitlab-ci.yml`, whose only
   job is named `test`); green once the MR's own pipeline runs through the gate.

## Red-then-green evidence

Base commit `5d3bf21e8acd6f701521a33c15d8876cceb9679f` (tip of `main` at lane start):
- `ci_config_path` = `""` — check 1 red.
- `main`'s latest pipeline job is named `test` (local `.gitlab-ci.yml`), never `ci` — check 2 red.
- GitHub Actions workflow `CI` on the twin is active, not `disabled_manually` — check 3 red.

Head commit (this branch, after the API calls and file changes in this MR):
- `ci_config_path` = `ci.yml@ss-group3592724/gate` — check 1 green.
- This MR's own pipeline (merge_request_event) reaches a successful `ci` job via
  `products/veridyn-ocr-dialect-service.yml`, and the `scripts-lock` guard's downstream gate
  pipeline carries at least one job (`scripts-lock-check`) — check 2 green (proven on the MR;
  `main` itself reflects this once merged).
- GitHub Actions workflow(s) on the twin are `disabled_manually` — check 3 green.

## Still open (out of this worktree's scope)

- Toolbox MR in `operator-os`: remove this product from the GitHub-to-GitLab mirror script list,
  and record its live version endpoint (`https://veridyn-ocr-dialect-service.vercel.app`, see
  `/api/health`) in `scripts/daily-brief/roster.json`. Requires editing a different repository;
  lane rule 1 restricts this worktree to `C:\wt\veridyn-ocr-lane51`.

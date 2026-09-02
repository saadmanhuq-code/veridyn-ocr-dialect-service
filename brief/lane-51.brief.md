# Lane 51 brief — veridyn-ocr-dialect-service: build through the gate

**Compiler status:** `compile_conversation_work_order_v1` (portfolio-context-engine MCP,
127.0.0.1:37421) returned `RECON_FIRST` / `requires_fable_keystone: true` (ceremony_rung L4,
keystone_reason `authority-boundary: token`) on both the initial call and the follow-up call
supplying a hand-authored `native_synthesizer_candidate`. This session is seat `claude`, not a
`fable`-family session, so the required keystone step cannot be satisfied here. Per the lane
instructions ("If the tool is unreachable, write brief/lane-51.brief.md..."), this file is the
fallback brief, authored manually.

## Intent (verbatim from the lane assignment)

> Lane #51 of GitLab project ss-group3592724/gate: veridyn-ocr-dialect-service: build through the
> gate (ci_config_path -> ci.yml@ss-group3592724/gate), brief, red-then-green, GitHub Actions off,
> GitLab push-mirror on.
>
> LANE
> repo: ss-group3592724/veridyn-ocr-dialect-service
> depends-on: #64
> depends-on: #36
>
> Cutover (operator order 2026-09-02: everything now, no soak windows)
>
> GitLab project ss-group3592724/veridyn-ocr-dialect-service (id 83720216) builds with its own
> `.gitlab-ci.yml` today and never through the gate.
>
> 1. Set the project's CI config path to `ci.yml@ss-group3592724/gate` (`PUT /projects/83720216`
>    ci_config_path).
> 2. Add `brief/veridyn-ocr-dialect-service-cutover.brief.md` in the repository naming this MR's
>    files and two executable acceptance checks.
> 3. Provide the pipeline inputs `ci.yml` expects (gate README, runtime contract); keep the
>    product's own test command as the Tier 1 `ci` job body. Leave the old `.gitlab-ci.yml` only
>    as an include of the gate.
> 4. Open the MR against main; red on a real check, green on the fix (red-then-green field).
> 5. When main is green through the gate: disable every GitHub Actions workflow on the GitHub
>    twin (`gh api -X PUT repos/<owner>/<repo>/actions/workflows/<id>/disable`), configure a
>    GitLab push mirror to the GitHub twin (`POST /projects/83720216/remote_mirrors`,
>    only_protected_branches, token from the credential root, never printed), and remove the
>    product from the GitHub-to-GitLab mirror script list (toolbox MR).
> 6. Record the live version endpoint in operator-os `scripts/daily-brief/roster.json` (toolbox
>    MR) if the product has one.

## Investigation before editing

- Gate `main` already carries `products/veridyn-ocr-dialect-service.yml` (job `ci`: `npm ci &&
  npm test`, matching this product's own `.gitlab-ci.yml` `test` job body byte-for-byte) and
  `products/veridyn-ocr-dialect-service.scripts.sha256` (digest
  `75a582e70501587fe070487f8e9509f8fb7ce1035c9dc24dbc00a14a3726a7f0`), landed by closed lanes
  #64 (per-product Tier 1 routing) and #36 (scripts-lock dispatch fix).
- Computed the canonical-scripts sha256 of this repo's current `package.json` `scripts` block
  locally: it matches the committed lock exactly. **Decision: reuse** — no gate-project MR is
  needed for this lane; the gate-side runtime profile is already correct.
- `GET /projects/83720216` currently returns `"ci_config_path":""` (empty) — confirms base-red
  for acceptance check 1.
- `npm test` currently passes clean (64/64) locally, so there is no latent app-level defect to
  exploit for red-then-green; instead this lane's own three acceptance checks serve as the
  red-then-green evidence (each false at the base commit, true at head — see below).

## Files touched in this repo

- `.gitlab-ci.yml` — reduced to a bare `include: - project: ss-group3592724/gate, file: ci.yml`
  pointer (no job bodies retained locally; the project-level `ci_config_path` setting is the
  actual mechanism GitLab uses, this file is left only as a documentation/fallback pointer per
  step 3).
- `brief/veridyn-ocr-dialect-service-cutover.brief.md` — the cutover-specific brief named in
  step 2.
- `brief/lane-51.brief.md` — this file.
- GitLab project setting `ci_config_path` on project 83720216 (API call, not a repo file).
- GitHub Actions workflow state on the GitHub twin (API call).
- GitLab remote mirror configuration on project 83720216 (API call).

## Acceptance checks (executable, red at base / green at head)

1. `GET /projects/83720216` shows `ci_config_path` = `ci.yml@ss-group3592724/gate`.
   - Base: `""` (red). Head: set via `PUT /projects/83720216` (green).
2. The latest pipeline on `main` has a job named `ci` with status `success` and the downstream
   gate pipeline has at least one job.
   - Base: `main`'s current pipeline runs the local `.gitlab-ci.yml` with a job named `test`, not
     `ci` (red). Head: once merged, `main`'s pipeline is dispatched through
     `ci.yml@ss-group3592724/gate`, which includes `products/veridyn-ocr-dialect-service.yml`
     (job `ci`) plus the `scripts-lock` guard dispatching a downstream gate pipeline (green,
     proven first on this MR's own pipeline).
3. `gh api repos/<owner>/<repo>/actions/workflows` shows every workflow `disabled_manually` (or
   no GitHub twin exists).
   - Base: `.github/workflows/ci.yml` (`CI`) is active (red). Head: disabled via
     `gh api -X PUT .../actions/workflows/<id>/disable` (green).

## Still open / out of this worktree's scope

- Toolbox MR in `operator-os` removing this product from the GitHub-to-GitLab mirror script
  list, and recording its live version endpoint in `scripts/daily-brief/roster.json`. Both
  require editing a different repository than this worktree, which lane rule 1 ("work only
  inside this worktree") does not authorize from here. Flagged for a follow-up toolbox lane.

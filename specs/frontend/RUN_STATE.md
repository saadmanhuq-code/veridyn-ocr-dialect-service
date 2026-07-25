# Frontend Factory — RUN_STATE — veridyn-ocr

> Frontend Factory v2.2 (AM-12 Wiring-Truth Gate folded in). Per AM-1, any agent
> joining this run reads this file + the phase artifacts and **resumes**; it does
> not re-derive completed work. If an artifact exists and its SHA matches, it is truth.
>
- **Product:** veridyn-ocr (`saadmanhuq-code/veridyn-ocr-dialect-service`)
- **Family:** DOC-GRAVITY (signature trust device: Document chain — uploaded by, source hash, permission, review status, audit event). Family design/kit NOT started (manifest §1 / §2 row 13).
- **Residency/tier:** non-regulated. This is an OCR/dialect satellite service of the Veridyn product line; sole verified production consumer is ProteinChain (`VERIDYN_OCR_URL` / `VERIDYN_OCR_API_KEY`).
- **Base branch:** `origin/main` @ `ab643ad` (current branch `fix/veridyn-ocr-honesty`).
- **Prior FF artifacts:** none (manifest §2 row 13 "none found"; verified directly in this worktree — no prior `RUN_STATE.md` / `UI_AUDIT.md` / `IA_SPEC.md` / `DESIGN.md`). This run bootstraps.

## Frontend surface verdict (verified 2026-07-25)

The repo **does have a user-facing frontend surface** — this is **not** a queue-exit / vacuous-complete case.

- `/` (`app/page.tsx`) — unauthenticated integration/reference page with bundled cue chips and regional samples. Protected OCR/dialect APIs are documented but not called. `"use client"` React component.
- `/lab` (`app/lab/page.tsx`) — server redirect to `/`.

Everything else under `app/` is a JSON **API route** for authenticated server-side consumers, not a screen. Full route map + per-route wiring evidence lives in [`UI_AUDIT.md`](./UI_AUDIT.md).

## Phase ledger (0–7 + AM-12 Phase 1.5)

Phase = session boundary (AM-1). Each phase commits its artifacts + this file in one checkpoint commit.

| Phase | Status | Artifact / evidence | Notes |
|---|---|---|---|
| 0 — Legacy freeze + bootstrap (AM-11) | NOT STARTED | — | Create `legacy/pre-factory` branch + `pre-factory-<date>` tag, push to GitLab + GitHub mirror, set protections. Not required for a docs-only Phase 1.5; mandatory before any Phase 6 rebuild MR. |
| 1 — Route inventory (UI audit) | DONE (refreshed 2026-07-25) | [`UI_AUDIT.md`](./UI_AUDIT.md) §"Route inventory" | Enumerated every route/view in the current fix branch: 2 UI screens + 7 API endpoints. |
| **1.5 — Wiring-truth classification (AM-12)** | **UPDATED** | [`UI_AUDIT.md`](./UI_AUDIT.md) §"Wiring Classification Table (Phase 1.5, AM-12)" | `/` = FIXTURE-ONLY, intentionally labelled as a public reference surface; `/lab` = redirect → `/`. Protected APIs require server-held bearer auth. |
| 2 — Domain mining / reference screens | NOT STARTED | — | `/` is recorded as FIXTURE-ONLY reference content and may not promote to `client_ready=true` without authenticated live-wiring proof. |
| 3 — IA_SPEC / contracts | NOT STARTED | — | One contract per route/screen. |
| 4 — Design direction | NOT STARTED | — | Blocked on DOC-GRAVITY family design (manifest §3.5). Builder = Kimi K3 per manifest §7.2.3. |
| 5 — Kit | NOT STARTED | — | DOC-GRAVITY family domain components (e.g. `DocumentChain`) under shared kit; family kit not started. |
| 6 — Rebuild | NOT STARTED | — | Docs-only phase; no screens rebuilt in this run. |
| 7 — Engineering audits + verification | NOT STARTED | — | A future interactive UI must prove user/session authorization and real backend variation without creating a public bearer-key relay. |

## Per-route build/verify ledger

| Route | Wiring (Phase 1.5) | Built (Phase 6) | Verified (Phase 7 check 13) |
|---|---|---|---|
| `/` (Dialect Reference) | FIXTURE-ONLY — intentionally labelled public reference surface; no protected API calls | — | — |
| `/lab` | redirect → `/` (no independent data path) | — | — |

## Open blockers

- Interactive public API access is blocked pending a real user/session authentication and authorization design; a server-key-only proxy is unsafe.
- Downstream (Phase 4–6) blocked on DOC-GRAVITY family design/kit, which itself awaits a proven family pilot (manifest §3.5).

## Next action

Phase 1.5 is **COMPLETE**. Next = **DOC-GRAVITY family lane** per manifest §3.5 (family design + one proven pilot before per-product Phase 4–6). This product is **not** a queue-exit (frontend surface exists). No `client_ready` claim is made or implied by this run (AM-12 §5).

## Adjacent findings (reported, not fixed — orchestrator-routed)

- **Overclaimed consumer copy:** the `/` homepage and several route docstrings name "DataRoom, BDA, and Agentic" as consumers of `/api/phrase-eval` and `/api/facts/extract`. The product truth store records the **sole verified production consumer as ProteinChain**. Copy/claim issue, not a wiring classification matter — out of scope for this docs-only run; flagged for the product owner.
- **Bundled reference inputs are explicit:** cue chips + RegSpeech12 regional samples (`lib/dialect-samples.ts`) are labelled as reference material. `/` is recorded as FIXTURE-ONLY and the authenticated-interactivity gap is documented in `WIRING_GAP_TICKETS.md`.

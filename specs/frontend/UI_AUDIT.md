# UI_AUDIT — veridyn-ocr

> Frontend Factory Phase 1 (route inventory) + Phase 1.5 (AM-12 Wiring-Truth Gate).
> Evidence is read against `origin/main` @ `6963355` in worktree
> `task/veridyn-ocr-ff-phase15-wiring-audit`. Every classification cites `file:line`;
> nothing is assumed (AM-12: UNRESOLVED-with-reason is the only allowed non-evidence state).
>
> **W5 honesty update (2026-11-11, deployed lineage):** `/` was converted to an
> unauthenticated integration/reference surface that makes no browser API calls.
> The wiring classification below supersedes the original Phase-1.5 MIXED
> finding (which described the pre-W5 page that called bearer-protected APIs
> keyless and received 401s in production).

## Surface summary

The repo **has** a user-facing frontend surface — a single Bengali Dialect Lab page
served by Next.js 15 App Router. It is **not** a queue-exit / vacuous-complete case.

- One substantive UI screen: `/` — unauthenticated integration/reference page (bundled cue chips / regional samples, capability matrix, curl examples, consumer onboarding). It makes no browser API calls.
- One redirect screen: `/lab` → `/`.
- Seven JSON **API routes** under `/api/*` — the live backend for authenticated server-side consumers, not screens; the public UI does not call them. They are traced *to*, not classified as wiring targets.

All `mock` / `fixture` / `MOCK_` / `demo` references in the repo are confined to **test files** (`*.test.ts`) — verified by grep. The production runtime path has **no fixture fallback** (README: "OCR is never mocked on this deployment"; image-intent / voice endpoints return an honest `fallback: true` / `vision_keys_required` flag when no vendor key is configured — a service-degradation signal, not fake content).

## Route inventory (CURRENT main)

UI routes / views / screens:

| Route | File | Method / kind | Surface |
|---|---|---|---|
| `/` | `app/page.tsx` | `"use client"` page | Dialect + OCR integration reference — the only substantive UI. Documents the protected contract (capability matrix, curl examples, onboarding) and renders bundled static cue/sample reference data. No uploads, no browser API calls, no API key. |
| `/lab` | `app/lab/page.tsx` | server component | `redirect("/")` (legacy path; primary UI moved to `/`). |

API routes (live backend — data sources, not screens):

| Route | File | Purpose |
|---|---|---|
| `GET /api/health` | `app/api/health/route.ts` | Liveness + deploy identity (`runtime_sha`); optional `?warm=ocr`. |
| `POST /api/documents/extract` | `app/api/documents/extract/route.ts` | OCR ingest (multipart) → normalized text + candidate facts. |
| `POST /api/dialect/analyze` | `app/api/dialect/analyze/route.ts` | Dialect cue inference over submitted text. |
| `POST /api/phrase-eval` | `app/api/phrase-eval/route.ts` | Batch (≤50) phrase → dialect inference. |
| `POST /api/facts/extract` | `app/api/facts/extract/route.ts` | Text-only fact extraction (regex engine). |
| `POST /api/image-intent` | `app/api/image-intent/route.ts` | Image intent classification (vision); `fallback:true` if no provider. |
| `POST /api/voice/transcribe` | `app/api/voice/transcribe/route.ts` | Audio STT + dialect; `fallback:true` if no provider. |

No `not-found.tsx` / `loading.tsx` / `error.tsx` / route groups exist under `app/` (confirmed via `git ls-tree -r HEAD` + `find app -type f`). The UI surface is exactly the two routes above.

## Wiring Classification Table (Phase 1.5, AM-12)

Definitions (AM-12 §1): **REAL-WIRED** = primary content fetched from a live backend call whose response varies with real input/identity; any mutation persists and is re-fetchable. **FIXTURE-ONLY** = primary content rendered from a static/demo fixture module regardless of runtime identity. **MIXED** = some elements real-wired, others not.

| Route | Classification | Evidence (file:line of the data path) | If MIXED: which elements are fixture |
|---|---|---|---|
| `/` (Dialect Reference) | **FIXTURE-ONLY (intentional public reference surface)** | `app/page.tsx` contains no `fetch()` and explicitly states that the bearer-protected OCR/dialect routes are unavailable from the unauthenticated browser (header comment `app/page.tsx:7-17`; hero copy `:55-56`). Cue chips, samples, and reference metadata come from `lib/dialect-samples.ts` (import at `app/page.tsx:5`); there is no live verdict or OCR result. A server-side bridge was rejected because, without user authentication, it would expose the protected service through a public relay. | All rendered phrase/dialect metadata is bundled reference data. The page labels it as reference data (`No API call`, `Bundled reference data (static)`) and labels API panels `Server auth required`; it does not masquerade as live output. |
| `/lab` | **REDIRECT → `/`** | `app/lab/page.tsx:5` (`redirect("/")`). No independent data path. | — (inherits `/`). |

**FIXTURE-ONLY routes:** `/` is intentionally reference-only and is recorded in [`WIRING_GAP_TICKETS.md`](./WIRING_GAP_TICKETS.md). `/lab` redirects to it. The classification is an explicit security boundary, not a claim that protected API output is available publicly.

### Method note (AM-12 §1)

The `/` page is a `"use client"` component with **no server-side data loader and no browser API calls** — every rendered phrase/dialect datum comes from the bundled `lib/dialect-samples.ts` reference module and is labelled as such. This is the inverse of the `getX() → hardcoded demo value` failure mode AM-12 was written for: the static data is presented *as* static reference material next to the documented server-side contract, never as live output. The `dialectCueCatalog()` inside `lib/dialect.ts` remains the cue engine's classification knowledge base; it runs only behind the bearer-protected API routes.

## Predict-then-compare proof ledger (HARD_RULES)

| proof_id | command_or_probe | expected_result | expectation_reason | actual_result | comparison | evidence_ref | mismatch_disposition |
|---|---|---|---|---|---|---|---|
| P1 | `git ls-tree -r --name-only HEAD \| grep app/` | 2 UI files (`page.tsx`, `lab/page.tsx`) + `layout.tsx` + `globals.css` + 7 API route.ts | Next App Router; README names only `/` and `/lab` | exactly those | MATCH | this doc §"Route inventory" | — |
| P2 | `grep -rniE "mock\|fixture\|MOCK_\|demo" app lib` (excl. `//`) | hits only in `*.test.ts` | README asserts OCR never mocked; engines are real | all hits in `lib/*.test.ts` (audio-stt, dialect-classifier, integrity-auth-coverage) | MATCH | this doc §"Surface summary"; RUN_STATE.md adjacent findings | — |
| P3 | trace `/` primary content data path | no protected `/api/*` request is reachable from the unauthenticated page | The page has no user authentication, so a server-key bridge would create a public relay | no `fetch()` in `app/page.tsx`; API panels say `Server auth required` | MATCH | Wiring table row `/` | — |
| P4 | classify `/` per AM-12 | FIXTURE-ONLY, explicitly labelled as reference material | all rendered phrase and dialect metadata comes from `lib/dialect-samples.ts` | FIXTURE-ONLY (intentional reference surface) | MATCH | Wiring table row `/` | — |
| P5 | enumerate FIXTURE-ONLY routes | `/` only; `/lab` redirects to it | the public page intentionally renders bundled reference data and no protected output | 1 FIXTURE-ONLY route | MATCH | this doc + `WIRING_GAP_TICKETS.md` | — |

Both mismatch directions treated as suspicious: none occurred. No terminal PASS is claimed on a mismatch.

# UI_AUDIT — veridyn-ocr

> Frontend Factory Phase 1 (route inventory) + Phase 1.5 (AM-12 Wiring-Truth Gate).
> Evidence was refreshed on 2026-07-25 in `fix/veridyn-ocr-honesty`, based on
> `origin/main` @ `ab643ad`. Every classification cites `file:line`;
> nothing is assumed (AM-12: UNRESOLVED-with-reason is the only allowed non-evidence state).

## Surface summary

The repo **has** a user-facing frontend surface — a single Bengali Dialect Lab page
served by Next.js 15 App Router. It is **not** a queue-exit / vacuous-complete case.

- One substantive UI screen: `/` (public integration guidance plus bundled cue chips / regional samples).
- One redirect screen: `/lab` → `/`.
- Seven JSON **API routes** under `/api/*` — these are bearer-protected integration endpoints, not screens. The unauthenticated public UI does not call them.

No protected API route silently substitutes bundled output. The public page intentionally imports `lib/dialect-samples.ts`, labels its content as bundled reference data, and makes no claim that those values came from OCR or dialect execution. Image-intent / voice endpoints return an explicit `fallback: true` / `vision_keys_required` signal when no vendor key is configured.

## Route inventory (current fix branch)

UI routes / views / screens:

| Route | File | Method / kind | Surface |
|---|---|---|---|
| `/` | `app/page.tsx` | `"use client"` page | Public integration/reference page. Bundled cue phrases can be loaded locally; protected OCR, dialect, and batch APIs are documented but not called. |
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
| `/` (Dialect Reference) | **FIXTURE-ONLY (intentional public reference surface)** | `app/page.tsx` contains no `fetch()` and explicitly states that the bearer-protected OCR/dialect routes are unavailable from the unauthenticated browser. Cue chips, samples, and reference metadata come from `lib/dialect-samples.ts`; there is no live verdict or OCR result. A server-side bridge was rejected because, without user authentication, it would expose the protected service through a public relay. | All rendered phrase/dialect metadata is bundled reference data. The page labels it as reference data and labels API panels `Server auth required`; it does not masquerade as live output. |
| `/lab` | **REDIRECT → `/`** | `app/lab/page.tsx:5` (`redirect("/")`). No independent data path. | — (inherits `/`). |

**FIXTURE-ONLY routes:** `/` is intentionally reference-only and is recorded in [`WIRING_GAP_TICKETS.md`](./WIRING_GAP_TICKETS.md). `/lab` redirects to it. The classification is an explicit security boundary, not a claim that protected API output is available publicly.

### Method note (AM-12 §1)

The `/` page is a `"use client"` component with **no server-side data loader and no browser API calls**. Its bundled phrase catalog is visibly labelled as reference material. Live OCR and dialect results are available only to authenticated server-side consumers of the protected routes.

## Predict-then-compare proof ledger (HARD_RULES)

| proof_id | command_or_probe | expected_result | expectation_reason | actual_result | comparison | evidence_ref | mismatch_disposition |
|---|---|---|---|---|---|---|---|
| P1 | `git ls-tree -r --name-only HEAD \| grep app/` | 2 UI files (`page.tsx`, `lab/page.tsx`) + `layout.tsx` + `globals.css` + 7 API route.ts | Next App Router; README names only `/` and `/lab` | exactly those | MATCH | this doc §"Route inventory" | — |
| P2 | trace bundled page data | every bundled value is labelled as reference data, never as API output | the public route intentionally does not authenticate | cue/sample imports at `app/page.tsx:5`; `No API call` at `:92`; reference rendering at `:111-157` | MATCH | this doc §"Surface summary"; `lib/public-ui-honesty.test.ts` | — |
| P3 | trace `/` primary content data path | no protected `/api/*` request is reachable from the unauthenticated page | The page has no user authentication, so a server-key bridge would create a public relay | no `fetch()` in `app/page.tsx`; API panels say `Server auth required` | MATCH | Wiring table row `/` | — |
| P4 | classify `/` per AM-12 | FIXTURE-ONLY, explicitly labelled as reference material | all rendered phrase and dialect metadata comes from `lib/dialect-samples.ts` | FIXTURE-ONLY (intentional reference surface) | MATCH | Wiring table row `/` | — |
| P5 | enumerate FIXTURE-ONLY routes | `/` only; `/lab` redirects to it | the public page intentionally renders bundled reference data and no protected output | 1 FIXTURE-ONLY route | MATCH | this doc + `WIRING_GAP_TICKETS.md` | — |

Both mismatch directions treated as suspicious: none occurred. No terminal PASS is claimed on a mismatch.

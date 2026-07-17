# UI_AUDIT — veridyn-ocr

> Frontend Factory Phase 1 (route inventory) + Phase 1.5 (AM-12 Wiring-Truth Gate).
> Evidence is read against `origin/main` @ `6963355` in worktree
> `task/veridyn-ocr-ff-phase15-wiring-audit`. Every classification cites `file:line`;
> nothing is assumed (AM-12: UNRESOLVED-with-reason is the only allowed non-evidence state).

## Surface summary

The repo **has** a user-facing frontend surface — a single Bengali Dialect Lab page
served by Next.js 15 App Router. It is **not** a queue-exit / vacuous-complete case.

- One substantive UI screen: `/` (OCR → transcript → cue chips / regional samples → dialect verdict; plus a batch phrase-eval panel).
- One redirect screen: `/lab` → `/`.
- Seven JSON **API routes** under `/api/*` — these are the live backend the UI calls, not screens; they are traced *to*, not classified as wiring targets.

All `mock` / `fixture` / `MOCK_` / `demo` references in the repo are confined to **test files** (`*.test.ts`) — verified by grep. The production runtime path has **no fixture fallback** (README: "OCR is never mocked on this deployment"; image-intent / voice endpoints return an honest `fallback: true` / `vision_keys_required` flag when no vendor key is configured — a service-degradation signal, not fake content).

## Route inventory (CURRENT main)

UI routes / views / screens:

| Route | File | Method / kind | Surface |
|---|---|---|---|
| `/` | `app/page.tsx` | `"use client"` page | Dialect Lab homepage — the only substantive UI. Three interactive panels: ① document OCR → transcript; ② transcript + cue chips / regional samples → dialect verdict; ③ batch phrase-eval. |
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
| `/` (Dialect Lab) | **MIXED** | Primary content is real-wired via client `fetch()` calls: ① OCR transcript + facts — `app/page.tsx:137` (`fetch("/api/documents/extract")`) → `extractDocumentPayload` at `app/api/documents/extract/route.ts:40` (real OCR engine, `lib/extract-document.ts:5`); ② dialect verdict (score/status/label/region/cue/source) — `app/page.tsx:91` (`fetch("/api/dialect/analyze")`) → `inferDialectFromText` at `app/api/dialect/analyze/route.ts:28` (real cue engine, `lib/dialect.ts`); ③ batch phrase-eval table — `app/page.tsx:69` (`fetch("/api/phrase-eval")`) → per-phrase `inferDialectFromText` at `app/api/phrase-eval/route.ts:77-82`. No fixture fallback in any production code path. | **Static reference-phrase affordances rendered from `lib/dialect-samples.ts`:** cue chips (`app/page.tsx:305-310`, import at `:5`; source `lib/dialect-samples.ts:12-45`), regional sample cards (`app/page.tsx:344-353`; source `lib/dialect-samples.ts:47-102`, several `source: "RegSpeech12"`), and dialect dropdown options (`app/page.tsx:316-320`; source `lib/dialect-samples.ts:104-113`). These are **input quick-fill / reference phrases**, not primary content — the transcript, verdict, and batch results are always live-computed. Fixtures are by design, not wiring gaps. |
| `/lab` | **REDIRECT → `/`** | `app/lab/page.tsx:5` (`redirect("/")`). No independent data path. | — (inherits `/`). |

**FIXTURE-ONLY routes:** none. The two UI routes do not render primary content from fixtures. The `/` route's only fixture elements are reference-phrase affordances (above); no route is FIXTURE-ONLY, so none are filed in [`WIRING_GAP_TICKETS.md`](./WIRING_GAP_TICKETS.md).

### Method note (AM-12 §1)

The `/` page is a `"use client"` component with **no server-side data loader** — every datum is produced by a user-triggered `fetch()` to a live `/api/*` route. There is no `getX() → hardcoded demo value` pattern (the exact failure mode AM-12 was written for, e.g. Agentic's `getOrganization() → shonaliGarments`). The static `dialectCueCatalog()` inside `lib/dialect.ts` is the cue engine's **classification knowledge base** (the phrases the heuristic scores against), analogous to a model's vocabulary — it is not "demo content rendered to the user"; the rendered verdict is computed live from the submitted text against that catalog.

## Predict-then-compare proof ledger (HARD_RULES)

| proof_id | command_or_probe | expected_result | expectation_reason | actual_result | comparison | evidence_ref | mismatch_disposition |
|---|---|---|---|---|---|---|---|
| P1 | `git ls-tree -r --name-only HEAD \| grep app/` | 2 UI files (`page.tsx`, `lab/page.tsx`) + `layout.tsx` + `globals.css` + 7 API route.ts | Next App Router; README names only `/` and `/lab` | exactly those | MATCH | this doc §"Route inventory" | — |
| P2 | `grep -rniE "mock\|fixture\|MOCK_\|demo" app lib` (excl. `//`) | hits only in `*.test.ts` | README asserts OCR never mocked; engines are real | all hits in `lib/*.test.ts` (audio-stt, dialect-classifier, integrity-auth-coverage) | MATCH | this doc §"Surface summary"; RUN_STATE.md adjacent findings | — |
| P3 | trace `/` primary content data path | every primary panel reaches a live `/api/*` call, no bundled fixture behind it | AM-12 REAL-WIRED test: parameterized by real input reaching a live endpoint | OCR→`/api/documents/extract` (:137); dialect→`/api/dialect/analyze` (:91); batch→`/api/phrase-eval` (:69) | MATCH | Wiring table row `/` | — |
| P4 | classify `/` per AM-12 | MIXED (primary real; fixture elements = reference-phrase inputs only) | cue chips + regional samples render static `lib/dialect-samples.ts`, so ≥1 element is not real-wired → MIXED, not pure REAL-WIRED | MIXED, fixture elements enumerated | MATCH | Wiring table row `/` | — |
| P5 | enumerate FIXTURE-ONLY routes | none | no route renders primary content from a fixture | 0 FIXTURE-ONLY | MATCH | this doc + `WIRING_GAP_TICKETS.md` | — |

Both mismatch directions treated as suspicious: none occurred. No terminal PASS is claimed on a mismatch.

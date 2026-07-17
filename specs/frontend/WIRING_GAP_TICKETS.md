# WIRING_GAP_TICKETS — veridyn-ocr

> Frontend Factory Phase 1.5 (AM-12 §3). Every FIXTURE-ONLY route becomes one
> ticket here: route, why it is fixture-only, what real data source/endpoint
> would need to exist, and rough class (trivial wire-up vs. needs new backend
> work). Per the Factory's scope-lock principle, wiring a fixture to a real
> backend is backend/domain work — filed here, never built inside an FF run.

## Tickets

**None.** No FIXTURE-ONLY routes were identified in this audit (see
[`UI_AUDIT.md`](./UI_AUDIT.md) §"Wiring Classification Table").

The two UI routes classify as:

- `/` (Dialect Lab) — **MIXED**. Primary content (OCR transcript, dialect verdict,
  batch phrase-eval results) is **REAL-WIRED** via live `fetch()` calls to
  `/api/documents/extract`, `/api/dialect/analyze`, and `/api/phrase-eval`.
- `/lab` — **REDIRECT → `/`**, no independent data path.

## Why the MIXED fixture elements are NOT gaps

The `/` route's only non-real-wired elements are **static reference-phrase
affordances** imported from `lib/dialect-samples.ts`:

- Cue chips — `app/page.tsx:305-310` ← `lib/dialect-samples.ts:12-45`.
- Regional sample cards (RegSpeech12-style) — `app/page.tsx:344-353` ← `lib/dialect-samples.ts:47-102`.
- Dialect dropdown options — `app/page.tsx:316-320` ← `lib/dialect-samples.ts:104-113`.

These are **input quick-fill / reference phrases** (the page labels them
"RegSpeech12-style reference phrases · click loads text + cue analysis"), not
primary content that masquerades as live data. The transcript, dialect verdict,
score, matched cue, and batch results are all computed live from the user's
actual input against the real cue/OCR engines. AM-12 §3 tickets exist to surface
routes whose *primary content* is a fixture needing a backend; that defect is not
present here. No backend work is required to make these elements real — they are
intentionally static reference data.

## Live-wiring note for Phase 7 (AM-12 check 13, forward-looking)

When Phase 6 rebuilds `/`, check 13 must prove against a real backend:
(a) primary content differs across distinct real inputs (e.g. two different
uploaded documents yield different transcripts/facts; two distinct phrases yield
different dialect verdicts) — readily satisfiable today since all primary paths
are already live;
(b) any submit action is re-fetchable from a fresh load — the OCR/dialect/phrase
paths are stateless reads over submitted input, so this holds by construction;
(c) no production code path silently falls back to bundled fixture data — verified
true today (P2 in `UI_AUDIT.md` proof ledger; all `mock`/`fixture` refs are in test files only).

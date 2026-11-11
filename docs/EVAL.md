# Evaluation harness

Reproducible evaluation for `veridyn-ocr-dialect-service`: committed gold sets,
a synthetic-fixture generator, and a live runner that fails loudly (nonzero
exit) when a regression threshold is crossed. Everything here is additive —
no service code or consumer contract changes.

## Layout

| Path | What |
| --- | --- |
| `tests/eval/gold/dialect-gold.json` | 40 dialect entries: 29 gate (≥3 per catalog label — sylhet, barishal, chittagong, noakhali, rangpur, sandwip, dhaka — plus 3 Banglish and 3 Bangladeshi-English negatives that must stay `unresolved`), 11 probes (true labels the 11-phrase cue catalog cannot resolve yet; reported, never gated). Baselines measured against `inferDialectFromText` (`lib/dialect.ts`, floor 0.58) on 2026-11-11. |
| `tests/eval/gold/ocr-gold.json` | 8 extraction entries for `POST /api/documents/extract`: 3 txt (exact gate, deterministic intake), 3 print PNGs (EN / BN / mixed), 1 text-layer PDF, 1 image-only scanned PDF (token-F1 gate). Expected text already includes service normalisation (Bengali digits → ASCII, whitespace collapsed). |
| `tests/eval/gold/stt-gold.json` | STT smoke over `tests/fixtures/*.wav`. `gold_transcript` is `null` (no consented transcripts committed yet), so the runner checks the response contract only — `fallback:false`, non-empty `transcript_bn`, dialect evidence, `stt_provenance`. File-name dialect hints are unverified and are reported as candidate evidence, never as accuracy. |
| `tests/eval/generate-fixtures.mjs` | Renders OCR gold `lines` to upload bytes: PNG via `@napi-rs/canvas`, text PDF via `pdf-lib` (Latin only — that is why `pdf_text` gold is EN), scanned PDF = image-only page wrapping the PNG (exercises the pdfjs-dist + canvas raster path). No binaries are committed; the gold JSON is the truth. |
| `tests/eval/scoring.mjs` | Pure scoring (token-F1 identical to `lib/dialect.ts`, dialect/OCR/STT scoring, latency rollup, threshold evaluation). No network, no env. |
| `tests/eval/scoring.test.mjs` | Offline self-tests for the above, incl. gold integrity (≥3 per label, gate baselines self-consistent) and generator byte checks. |
| `scripts/eval-live.mjs` | The live runner (below). |

## Run it

Offline self-test (no deployment, no key — safe anywhere):

```powershell
node --test tests/eval/scoring.test.mjs
node scripts/eval-live.mjs --dry-run          # list planned checks
node tests/eval/generate-fixtures.mjs         # optional: write tests/eval/generated/
```

Against a preview or production deployment (PowerShell):

```powershell
$env:EVAL_BASE_URL = 'https://veridyn-ocr-dialect-service.vercel.app'  # or a preview URL
$env:VERIDYN_OCR_API_KEY = '<bearer key>'   # read from env only; never printed by the runner
node scripts/eval-live.mjs                 # all suites
node scripts/eval-live.mjs --suite dialect,negatives --output eval-report.json
```

`npm test` never touches the network: it runs `lib/**/*.test.ts` only, and the
live runner is never invoked from it. Suites: `health`, `dialect`
(`POST /api/phrase-eval` in ≤50-phrase batches + one `POST /api/dialect/analyze`
spot check that both routes agree), `ocr` (fixtures generated in-memory),
`stt` (multipart `audio` field, contract in `app/api/voice/transcribe/route.ts`),
`negatives` (9 checks: missing/wrong bearer → 401/403 fail-closed, empty and
>50-phrase phrase-eval bodies → 400, missing upload file → 400, bad audio
mime → 415, missing `audio_base64` → 400). Per-route latency (avg/max) is
always reported. Exit codes: `0` pass, `1` threshold failure, `2` config error
(missing base URL/key, runner crash).

## Regression thresholds (defaults; env-overridable)

| Gate | Default | Env |
| --- | --- | --- |
| Dialect gate accuracy, overall **and** per label | 1.0 (every gate entry) | `EVAL_DIALECT_GATE_MIN` |
| OCR txt entries | exact match on `full_text_normalized` | — (deterministic path; no tolerance) |
| OCR png/pdf entries | token-F1 ≥ 0.9 per entry | `EVAL_OCR_TOKEN_F1_MIN` |
| STT | shape contract; token-F1 ≥ 0.6 once a `gold_transcript` exists | `EVAL_STT_TOKEN_F1_MIN` |
| STT `{fallback:true}` | failure | `EVAL_STT_ALLOW_FALLBACK=1` downgrades to a reported warning (e.g. a preview with no vendor keys) — it is never silently hidden |
| Negative paths | 9/9 | — |
| Health | `GET /api/health` 200 with `ok:true` | — |

Lowering a threshold to make a red run green is a deliberate decision: do it
in the same change that explains why (catalog/floor change, engine swap), and
refresh gold baselines at the same time (see below).

## Bengali font for print fixtures

PNG generation needs a Bengali-capable font or BN print renders as tofu and
the BN token-F1 gate fails loudly (by design). The generator looks for
`EVAL_BN_FONT_PATH`, then Nirmala (`C:/Windows/Fonts/Nirmala.ttc`) and common
Noto Sans Bengali paths, and the runner report says whether one registered.

## Extending the gold sets

**Synthetic first.** New OCR print cases = new `lines` in `ocr-gold.json`
(generator renders them; keep text invented — fake invoice numbers, fake
names). New dialect cases = new entries with measured baselines: run the
phrase through `inferDialectFromText` (or the deployed `/api/phrase-eval`),
record `baseline`, and set `gate:true` only if the current service already
meets the expectation — otherwise add it as a probe (`gate:false`) so the run
stays green while the gap stays visible. Promote a probe to a gate in the same
change that fixes the catalog/floor/classifier behavior it probes.

**Real samples — privacy rules (non-negotiable):**

1. Written, revocable consent from the speaker/document owner for evaluation
   use, recorded out-of-band; no consent, no commit.
2. No PII in the repo: no real names, NID/birth-certificate numbers, phone
   numbers, addresses, account numbers, signatures, or faces. Redact before
   commit and re-check the redaction; prefer re-rendered synthetic copies of
   real layouts over scans of real documents.
3. Voice: commit only the minimal clip needed, with the transcript the
   speaker approved. File names must not encode identity; a region hint in a
   file name stays an unverified hint until a consented label exists.
4. Gold labels are claims about dialect/OCR truth — record who labeled them
   and when in the entry `note`. Heuristic engine output is candidate
   evidence: never transcribe engine output into a gold field without human
   verification, and keep `review-required` honesty labeling wherever results
   are surfaced.
5. If consent is withdrawn, delete the fixture and its gold entry in the same
   change; note the removal (not the content) in the commit message.

## Known limits (measured 2026-11-11, see gold headers)

- The cue catalog is 7 labels / 11 phrases; Rajshahi, Khulna, Mymensingh,
  Banglish, and Bangladeshi English have no positive coverage — Banglish/EN
  appear only as must-stay-unresolved negatives. Novel paraphrases of covered
  dialects are probes (the matcher cannot resolve them today); the Vertex
  classifier runs only on the voice path and is out of scope for
  `dialect-gold.json` (it has its own live tests in `lib/vertex-live.test.ts`).
- `dhaka-probe-confusion` documents a real wrong-region suggestion
  (`আমি ঢাকায় থাকি` → barishal). Truth stays in the gold file; the fix
  belongs in the catalog, not in the expectation.
- OCR gold is clean synthetic print only: no handwriting, stamps, skew, or
  multi-page/layout cases yet, and confidence remains heuristic.

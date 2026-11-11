# Consumer guide — veridyn-ocr-dialect-service

How a product integrates this OCR + dialect service today, stated at the level
of what is actually deployed and verified — not what is planned.

- **Base URL (prod):** `https://veridyn-ocr-dialect-service.vercel.app`
- **Public probe:** `GET /api/health` (no key)
- **Everything else:** bearer-protected, **server-side calls only**
- **Sole verified production consumer:** **ProteinChain**. No other product is
  recorded as a verified production consumer of this deployment. If your
  product integrates, your own live proof (authenticated call from your
  server, candidate output reviewed) is what makes you a verified consumer —
  being listed in an example, docstring, or roadmap does not.

## Honesty contract (read first)

Every value this service returns is **candidate evidence only**:

- Extracted text can contain OCR errors; `extractable: true` means "readable
  text was produced", not "the text is correct".
- `candidate_facts` are deterministic regex **hints** over the text, not
  verified facts. Document-type candidates live in the separate additive
  `structured_fields` (`bd_extract.v1`: NID, trade licence, passport MRZ,
  invoice/receipt) — every field there is `candidate_only` with
  `review_required: true`, source spans into the raw extracted text, and
  structural validations (format/check-digit/date consistency) that are
  signals, never proof of a genuine document or identity.
- Dialect `status: "suggested"` is a heuristic cue match above a 0.58 floor
  over a small catalog (11 labels, 19 cue phrases; the Rajshahi / Khulna /
  Mymensingh / Cumilla cues are curated candidate evidence without corpus
  validation and require a stronger 0.75 match, so a mere place mention is
  not suggested). Romanized Bengali (Banglish) renderings of catalog cues can
  resolve; evidence carries an additive `script_mix`. `unresolved` is a
  correct, expected answer for most real-world dialect input today, including
  Bangladeshi-English forms the catalog does not cover. Scoring caps input at
  2,000 characters (`input_truncated: true` when cut); POST
  /api/dialect/analyze accepts opt-in `"use_classifier": true` for the Vertex
  classifier resolver.
- Confidence / `match_score` values are provider or heuristic estimates, not
  calibrated accuracy. Do not present them to users as verified accuracy.
- `{ fallback: true }` (voice, image-intent) means the provider was **not**
  run. It is never a successful result.

Keep a human or downstream review step between this service's output and any
decision, filing, payment, or user-facing claim.

## Onboarding (per consumer)

Access is by bearer key. The operator can issue **per-consumer named keys**
(configured server-side; each key is individually revocable and accepted /
rejected calls are attributed to the consumer name in a `usage_event.v1`
server log line — the key value itself is never logged). Deployments without
named keys use the shared service key (`VERIDYN_OCR_API_KEY`, plus
`VERIDYN_OCR_API_KEY_NEXT` during rotation) exactly as before. Per-consumer
quotas and rate limits are **not yet available**. Corpus logging emits an
event only when the caller sends explicit `consent` (voice /
image-intent); absent consent no corpus event is emitted. Onboarding:

1. **Request access from the service operator.** State your product, the
   server environment that will hold the key, expected request volume, and the
   document/audio types you will send. Expect to be recorded as a consumer
   candidate — not as verified — at this stage.
2. **Receive the key through your secret channel** (never email/chat/git).
   Store it only in server-side secrets (e.g. your host's env/secret store).
   Never put it in browser or mobile code, a `NEXT_PUBLIC_*` variable, a repo,
   or a log line. Because the key is shared, treat any leak as a service-wide
   rotation event and tell the operator immediately.
3. **Configure your server:** base URL env (your convention, e.g.
   `VERIDYN_OCR_URL=https://veridyn-ocr-dialect-service.vercel.app/api`) and
   the bearer key env your stack already uses for this service. Call from
   server code that adds `Authorization: Bearer <key>` per request. Do not
   build a public proxy that relays the key for anonymous browser callers —
   that turns your product into an unauthenticated OCR endpoint.
4. **Prove the path with synthetic data first:** `GET /api/health`, then one
   authenticated `POST /api/documents/extract` with a synthetic PNG/PDF whose
   expected text you know. Confirm the sidecar shape (below) and your handling
   of `warnings` before sending real documents.
5. **Handle errors and fallbacks explicitly** (taxonomy below), including
   `401`, `403` (do not retry-storm), and `{ fallback: true }`.
6. **Record your live proof** (date, environment, endpoint, redacted sample
   result) in your own product's run-state/docs, and ask the operator to update
   the verified-consumer record. Until then, do not describe your product as
   a consumer of this service in user-facing copy.

Browser-direct integration is not supported: there is no user/session auth on
this service, CORS (`OCR_CORS_ORIGINS`, empty by default) never substitutes
for the bearer key, and the public page at `/` deliberately makes no API calls.

## Data handling (what to tell your own reviewers)

- Document, image, and audio bytes are sent to the configured upstream
  provider (Vertex / Gemini / OpenRouter) for processing — your data-processing
  review must cover those providers, not just this service.
- The extract/dialect/phrase/facts routes do not persist uploads. The voice and
  image-intent routes can emit a corpus event (content hash, transcript,
  dialect fields, your `product`/`region` tags) to stdout **only when the
  operator has set `VERIDYN_CORPUS_LOG=enabled`** (off by default) **and the
  caller sends explicit end-user `consent`** (default false; absent consent
  no corpus event is emitted). Before sending real personal audio/images,
  confirm the corpus-log setting with the operator and make sure your own
  consent/lawful-basis covers it.
- Do not send credentials, payment data, or documents you are not authorised
  to process with a third-party AI provider. When in doubt, send synthetic or
  redacted samples and ask the operator first.

## Endpoints, contracts, and limits

All `POST` routes require `Authorization: Bearer <key>` and run synchronously
under a 60 s route budget. Contracts are additive-only: new fields may appear,
existing field names/types below will not be removed or repurposed without a
new schema version.

### `GET /api/health` — public

`{ ok: true, runtime_sha, commit_sha, contract_version }`, plus `ocr_warm`
when called as `/api/health?warm=ocr`. `runtime_sha` may be `null` when the
deploy did not bind a git SHA (e.g. CLI deploys) — treat `null` as "identity
not bound", not as downtime.

### `POST /api/documents/extract` — multipart OCR

Form fields: `file` (required), `language` (optional: `ben+eng` default,
`ben`, `eng`).

| Limit | Value |
|-------|-------|
| File size | 10 MB (over → `400` with the limit in `detail`) |
| Types | `.png .jpg .jpeg .webp .bmp .tif .tiff .pdf .docx .txt .md .csv` |
| PDF pages | Text layer up to **50 pages** (30s budget); scanned-page OCR up to **10 pages** within a **50s** budget — truncation is always warned with processed/total, per-page records in additive `pages[]` |
| Layout output | None (no boxes, lines, or reading-order structure) |

Response (sidecar-compatible shape — do not rename on the consumer side):

```json
{
  "file_name": "scan.png",
  "file_extension": ".png",
  "bytes": 12345,
  "intake_kind": "image_scan",
  "text_preview": "first 1200 chars…",
  "full_text_normalized": "full normalized text…",
  "candidate_facts": [{ "fact_key": "…", "label": "…", "value": "…", "source": "…" }],
  "extractable": true,
  "warnings": ["…candidate evidence only…"],
  "ocr_provenance": { "engine": "…", "…": "…" }
}
```

On Vercel, image/scanned-PDF OCR runs the vision provider chain
(Vertex → Gemini → OpenRouter vision list) and does not fall back to
Tesseract; off Vercel, `tesseract.js` (ben+eng) is the fallback. Text-layer
PDFs are read with `pdfjs-dist`, not OCR'd. Bengali-digit normalization is
applied to the returned text.

```powershell
# PowerShell: key from your server secret store — shown as a placeholder only.
curl.exe -X POST "https://veridyn-ocr-dialect-service.vercel.app/api/documents/extract" `
  -H "Authorization: Bearer <server-side API key>" `
  -F "file=@scan.png" -F "language=ben+eng"
```

### `POST /api/dialect/analyze` — dialect cue evidence

Body: `{ "text": "…" }`. Response: `{ schema_version: "dialect_cue.v1",
input_characters, evidence }` where `evidence.status` is `suggested`,
`unresolved`, or `missing_transcript`, with `dialect_label`, `speaker_region`,
`match_score`, `candidate_label`, and `method: "cue_match"` when suggested.
Empty or missing `text` is not a `400` here: it returns HTTP 200 with
`evidence.status: "missing_transcript"`.
Dialect is opt-in: document extraction never fills this in for you.

### `POST /api/phrase-eval` — batch cue evidence

Body: `{ "phrases": ["…", "…"] }` (max **50**) or `{ "phrase": "…" }`.
Response: `{ schema_version: "phrase_eval.v1", suggestion_floor: 0.58,
results: [{ phrase, characters, normalized, evidence }] }`.

### `POST /api/facts/extract` — regex fact hints over text you already hold

Body: `{ "text": "…" }` (non-empty, max **500 KB**). Response:
`{ schema_version: "facts_extract.v1", characters, candidate_facts }`.
Same regex engine as the extract route; hints only — see the honesty contract.

### `POST /api/image-intent` — image intent

Form field: `image` (JPEG/PNG/WEBP, max **4 MB**); optional `product`,
`region`. Success: `image_intent.v1` result. No vision provider: HTTP 200
`{ fallback: true, detail: "No vision provider configured" }` off Vercel, or
HTTP `503 { detail, vision_keys_required: true }` on Vercel.

### `POST /api/voice/transcribe` — speech to text + dialect

Multipart `audio` (webm/ogg/m4a/mp4/mpeg/wav, max **8 MB**; optional
`product`, `region`) or JSON `{ audio_base64, mime_type, product?, region? }`.
Success: `{ transcript_raw, transcript_bn, language, dialect,
stt_provenance, fallback: false }`. No speech provider configured: exactly
`{ fallback: true }` with HTTP 200 — branch on `fallback`, not status. This
`{ fallback: true }` shape is a frozen consumer contract; do not treat a
missing transcript field as an empty transcript.

## Error taxonomy

Error bodies are `{ "detail": string }` unless noted. Log `detail`
server-side; do not show it verbatim to end users.

| HTTP | When | Consumer action |
|------|------|-----------------|
| `400` | Non-JSON/non-multipart body; missing `file`/`audio`/`image`/`text`; unsupported document type; document over 10 MB; >50 phrases; facts text over 500 KB | Fix the request. No retry unchanged. |
| `401` | Bearer key missing or not matching current/next key (`detail: "Unauthorized"`) | Fix server-side key config; check rotation state with the operator. |
| `403` | Service has no key configured (`detail: "Forbidden: API key not configured."`) | Operator action. Back off — never retry-storm a 403. |
| `413` | Audio over 8 MB or image over 4 MB | Shrink/re-encode the input, then retry once. |
| `415` | Unsupported audio/image media type | Convert to an accepted type listed above. |
| `500` | Unexpected failure on the extract path (provider/engine error text in `detail`) | Bounded retry with backoff; if persistent, report timestamp + `file_name` (never document contents) to the operator. |
| `503` | Image-intent on Vercel without a vision provider (`vision_keys_required: true`) | Operator action. Treat like `fallback` in UX ("unavailable"), not like a user error. |
| `200` + `fallback: true` | Voice / image-intent provider not configured | Show your own "unavailable, type it instead" path. Never fabricate a transcript/intent locally. |
| `200` + `extractable: false` | No readable text extracted (see `warnings`) | Ask for a clearer scan or a different format; do not invent text. |
| `200` + `evidence.status: "unresolved"` | No dialect cue at/above the suggestion floor | Record "unknown dialect". This is an honest answer, not an error. |

## Rotation, versioning, and compatibility

- **Rotation:** the operator sets the successor key, consumers switch their
  server secret to it, then the operator promotes it. Both keys work during
  the window; there is no per-consumer cutover signal, so coordinate in your
  own release process and confirm with one authenticated synthetic call.
- **Schema versions in responses today:** `dialect_cue.v1`,
  `phrase_eval.v1`, `facts_extract.v1`, `image_intent.v1`, plus the
  unversioned extract sidecar shape and voice shapes above. Pin your parsing
  to field names, tolerate additive fields, and never depend on `detail`
  wording beyond the two frozen auth strings (`401`/`403` above).
- **Not available today** (do not build against these): quotas/rate limits
  (per-consumer keys give identity + revocation + log attribution only),
  async/batch document jobs, PDF pages beyond the 50-text / 10-OCR caps,
  layout/bounding boxes, browser-direct keys, and any "verified" flag on
  output (`structured_fields` schemas are candidate-only). If your product
  needs one, raise it with the operator before promising it to users.


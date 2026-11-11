# OCR + dialect service

Standalone **Next.js** deployment for document OCR plus an optional Bengali **dialect cue** analyzer. On Vercel, image and scanned-PDF OCR uses a configured Vertex, Gemini, or OpenRouter vision provider and does not fall back to Tesseract. Text-layer PDFs are read with `pdfjs-dist`; non-Vercel runtimes may use server-side `tesseract.js` (ben+eng). Canonical prod: **`https://veridyn-ocr-dialect-service.vercel.app`**.

Consumer-facing onboarding, limits, and the error taxonomy live in **[CONSUMERS.md](./CONSUMERS.md)**. This file is the operator/service reference.

## Product framing

| Layer | Responsibility |
|--------|----------------|
| **Public UI (`/`)** | Unauthenticated integration/reference surface. Cue chips and regional samples are bundled static reference data; the page does not upload files, does not call protected APIs, and never receives the service bearer key. It documents the contract (capability matrix, curl examples, onboarding steps) for server-side consumers. |
| **`/lab`** | Legacy path — **redirect to `/`** (everything lives on one page). |
| **Private APIs** | `POST /api/documents/extract` (multipart file) · `POST /api/dialect/analyze` · `POST /api/phrase-eval` · `POST /api/facts/extract` · `POST /api/image-intent` · `POST /api/voice/transcribe` — all bearer-protected, server-side only. `GET /api/health` is the only public probe. |

The sole verified production consumer is **ProteinChain**
(`specs/frontend/RUN_STATE.md`). Consumer adoption is product-specific:
products should mount their documented OCR base URL env (`VERIDYN_OCR_URL` or
product-specific equivalent) and route server-side upload flows through
**`/api/documents/extract`** only where that product's adapter is wired and
proven. Do not infer that every named consumer calls this service on every
upload; record each product's live proof separately. A product named in a
route docstring, example, or roadmap is not thereby a verified consumer.

All extracted text, candidate facts, and dialect labels are **candidate
evidence only** (`warnings`, `candidate_facts`, evidence `status` say so in
every response). Nothing this service returns is human-verified; consumers
must keep a review step before acting on values.

---

## Integration: `VERIDYN_OCR_URL` normalization

The PCBD/adapters **`extractViaVeridyn`** resolves the POST URL safely so env mistakes do not silently 404 → mock fallback:

| You set… | Resolved POST endpoint |
|-----------|-------------------------|
| `https://svc.vercel.app` (bare `.vercel.app`) | `https://svc.vercel.app/api/documents/extract` |
| `https://svc.vercel.app/api` | `https://svc.vercel.app/api/documents/extract` |
| `https://sidecar.example.com` (non-Vercel) | `https://sidecar.example.com/documents/extract` (Fly/Python sidecar parity) |
| Full URL ending in `/documents/extract` | Passthrough verbatim |

Recommended for this service: **`https://veridyn-ocr-dialect-service.vercel.app/api`**  
(also accepts bare host — both resolve correctly.)

Mirror the active bearer key server-side where used. This service accepts
**`VERIDYN_OCR_API_KEY`** and **`VERIDYN_OCR_API_KEY_NEXT`**; callers send
**`Authorization: Bearer [REDACTED]`** from server-side code. During rotation, set `_NEXT`, update
consumers to send it, then promote it to the primary key after all consumers
are cut over. Operators may also set **`VERIDYN_OCR_API_KEYS`** with
per-consumer named keys (individually revocable; accept/reject calls emit a
`usage_event.v1` log line with the consumer name, never the key). Quotas and
rate limits are **not yet available**.

---

## Auth and rotation contract

- Auth **fails closed**. If neither `VERIDYN_OCR_API_KEY` nor
  `VERIDYN_OCR_API_KEY_NEXT` is configured, every environment rejects all
  requests with `403 Forbidden` (a permanent config error, not a retryable
  outage) by default. The unauthenticated allow-all bypass requires **all
  three** of the following conditions simultaneously:
    1. `VERIDYN_OCR_ALLOW_UNAUTHENTICATED=true` — must be set explicitly by
       the developer.
    2. Not running on Vercel (`VERCEL` env var absent) — Vercel sets this on
       every deployment including preview, so all deployed Vercel environments
       fail closed regardless of the flag.
    3. Not a production build (`NODE_ENV !== "production"`) — `next build` sets
       this, which covers `next start` and all preview builds.

  This triple-condition opt-in prevents fail-open on non-Vercel hosts (e.g.
  Docker containers on Oracle VM3) that omit the flag and have no keys
  configured. Local `npm run dev` with the flag set stays zero-friction.
- If either key is configured, extraction requests must send an exact Bearer [REDACTED]  token match for the current or next key; otherwise `401 Unauthorized`.
- Do not treat an unauthenticated smoke test as authenticated provider proof.
  Authenticated proof requires the service and consumer to use matching server
  side keys.
- Keep real key values in the secure operator stash or deployment secrets, never
  in git, in a browser bundle (`NEXT_PUBLIC_*`), or in the public UI.

---

## Provider / model chain (truth)

| Path | On Vercel | Off Vercel |
|------|-----------|------------|
| Image scan OCR | Vision provider chain only: **Vertex → Gemini Studio → OpenRouter vision list**. No Tesseract fallback; with no vision keys, OCR fails rather than silently degrading. | Same vision chain when keys are configured; otherwise (or on vision failure) server-side `tesseract.js` with `ben+eng` language data. |
| Text-layer PDF | `pdfjs-dist` text layer, up to **50 pages** (30s budget; env `VERIDYN_PDF_MAX_TEXT_PAGES` / `VERIDYN_PDF_TEXT_TIME_BUDGET_MS`). | Same. |
| Scanned PDF | Render up to **10 pages** (50s budget; env `VERIDYN_PDF_MAX_OCR_PAGES` / `VERIDYN_PDF_OCR_TIME_BUDGET_MS`) to PNG, then the vision chain. Truncation warned; `pages[]` per page. | Same render step; OCR per the image row above. |
| TXT / MD / CSV / DOCX | Direct text decode (DOCX via `word/document.xml`). No OCR. | Same. |
| Voice (`/api/voice/transcribe`) | Configured speech provider (Vertex / Gemini / OpenRouter per env); none configured → `{ fallback: true }` (HTTP 200). | Same contract. |
| Image intent (`/api/image-intent`) | Configured vision provider; none configured on Vercel → `503` with `vision_keys_required: true`. | None configured → `{ fallback: true, detail: "No vision provider configured" }` (HTTP 200). |

Model names are env-overridable (`VERTEX_MODEL`, `GEMINI_OCR_MODEL`,
`VERIDYN_STT_MODEL`, `VERIDYN_IMAGE_INTENT_MODEL`, `OPENROUTER_OCR_MODELS` /
legacy `OPENROUTER_OCR_MODEL`); code defaults name a live Gemini flash model
and a built-in OpenRouter vision list. Operators must verify the exact model
is enabled on the backing project/account — a model name in code is not proof
the provider account serves it. Confidence values in responses are
provider/heuristic estimates, not calibrated accuracy.

---

## API reference

Full request/response contracts, limits, and error handling for consumers:
**[CONSUMERS.md](./CONSUMERS.md)**. Summary:

### `GET /api/health`

Public runtime probe: `{ ok, runtime_sha, commit_sha, contract_version }`.
`runtime_sha` is `VERCEL_GIT_COMMIT_SHA` — it is `null` for CLI/local deploys
that do not set it, so a `null` value means "deploy identity not bound", not
"unhealthy". `?warm=ocr` additionally returns `ocr_warm`
(`vision_ready` / `vision_keys_required` / `ready` / error text).

### `POST /api/documents/extract`

Multipart `file` (required), optional `language` (`ben+eng`, `ben`, `eng`).
Limits: 10 MB; PDFs up to 50 text-layer pages / 10 scanned-OCR pages within
time budgets (truncation warned, never silent); synchronous 60 s route
budget. Response aligns with the Veridyn/sidecar contract:
`file_name`, `file_extension`, `bytes`, `intake_kind`, `text_preview`,
`full_text_normalized`, `candidate_facts`, `extractable`, `warnings`,
`ocr_provenance`, plus additive `pages` (PDF per-page records, else null) and
`structured_fields` (`bd_extract.v1` NID / trade-licence / passport-MRZ /
invoice candidates — `candidate_only`, review-required, spans into the raw
extracted text). No layout/bounding-box output is produced.

### `POST /api/dialect/analyze`

JSON **`{ "text": "বাংলা …" }`**. Response: `schema_version: dialect_cue.v1`,
`input_characters`, **`evidence`** with **`status`**
(`suggested` / `unresolved` / `missing_transcript`), `dialect_label`,
`speaker_region`, `match_score`, `candidate_label`, `method: cue_match`.
The cue catalog is a small curated set (11 labels, 19 cue phrases);
Rajshahi/Khulna/Mymensingh/Cumilla cues are curated candidate evidence
(no corpus validation) gated at a stronger 0.75 match. Evidence carries
additive `script_mix` and `input_truncated` (scoring caps input at 2,000
chars); Banglish renderings of catalog cues can resolve, Bangladeshi-English
stays `unresolved`. Optional `"use_classifier": true` runs the Vertex
classifier resolver instead of cue-only. `suggested` is a heuristic
suggestion above the 0.58 floor, not a verified label.

Dialect is **never** inferred from OCR automatically — callers opt in.

### `POST /api/phrase-eval`

JSON `{ "phrases": string[] }` (max 50) or `{ "phrase": string }`. Response:
`phrase_eval.v1` with per-phrase `evidence` (same cue engine as above).

### `POST /api/facts/extract`

JSON `{ "text": string }` (max 500 KB). Response: `facts_extract.v1` with
`candidate_facts` from a deterministic regex engine (garment-compliance-style
hints such as hours, age, certificate/wage signals). These are candidate
hints, not verified facts, and there are no document-type schemas (no
NID/licence/invoice extraction) on this route.

### `POST /api/image-intent`

Multipart `image` (JPEG/PNG/WEBP, max 4 MB). Response: `image_intent.v1`, or
the fallback/503 shapes in the provider table above.

### `POST /api/voice/transcribe`

Multipart `audio` or JSON `{ audio_base64, mime_type }` (webm/ogg/m4a/mp4/
mpeg/wav, max 8 MB). Success returns transcript fields plus dialect evidence
with `fallback: false`; no speech provider configured returns exactly
`{ fallback: true }` (HTTP 200) — consumers must branch on `fallback`, not on
HTTP status alone.

### Error taxonomy (summary)

| HTTP | Body | Meaning / consumer action |
|------|------|---------------------------|
| `400` | `{ detail }` | Malformed body, missing field, unsupported file type, phrase/text over limit. Fix the request; do not retry unchanged. |
| `401` | `{ detail: "Unauthorized" }` | Missing or non-matching bearer key. Fix server-side key config. |
| `403` | `{ detail: "Forbidden: API key not configured." }` | Service has no key configured. Permanent until the operator configures one — do not retry-storm. |
| `413` | `{ detail }` | Audio/image over its size cap. Shrink the input. (Document extracts over 10 MB return `400` with the limit in `detail`.) |
| `415` | `{ detail }` | Unsupported audio/image media type. Convert the input. |
| `500` | `{ detail }` | Unexpected server/provider failure on the extract path. Retry with backoff is reasonable; surface `detail` in logs, not to end users verbatim. |
| `503` | `{ detail, vision_keys_required: true }` | Image-intent on Vercel with no vision provider configured. Operator action required. |
| `200` + `{ fallback: true }` | — | Provider not configured (voice; image-intent off Vercel). A supported degradation signal, **not** a successful transcription/classification. |

---

## Node client sketch

```typescript
async function extractOcr(base: string, buf: Uint8Array, filename: string, apiKey?: string) {
  const form = new FormData();
  form.append("file", new Blob([buf]), filename);
  const headers: Record<string, string> = apiKey?.trim()
    ? { Authorization: `Bearer ${apiKey.trim()}` }
    : {};
  const res = await fetch(`${base.replace(/\/+$/, "")}/api/documents/extract`, {
    method: "POST",
    body: form,
    headers,
  });
  return res.json();
}
```

Server-side only — never call this from browser code with a real key. (Or rely
on **`veridynExtractEndpoint()`** in `protein-chain-bd` — it maps env → correct
suffix.)

---

## Operational notes

- **PDF page caps**: text-layer read stops at 50 pages / 30s and scanned-PDF raster OCR at 10 pages / 50s (env-tunable, clamped; truncation always warned with processed/total). Documents needing later pages must be split by the caller today. For native-Tesseract parity, deploy the Docker sidecar (`protein-chain-bd/scripts/veridyn-ocr-service`) and point **`VERIDYN_OCR_URL`** at it.
- **Warm latency**: vision-provider latency and availability apply on Vercel; non-Vercel `tesseract.js` workers have their own first-use warm-up cost.
- **`OCR_CORS_ORIGINS`** (comma-separated allowlist) on this service scopes browser CORS and **fails closed**: a matching request origin is reflected into `Access-Control-Allow-Origin`, unlisted origins get no grant, and the default is empty (no wildcard). Set `*` only to deliberately allow any browser origin. Server-to-server calls do not rely on CORS, and CORS never substitutes for the bearer key.
- **Per-consumer isolation is key-level only**: named keys (`VERIDYN_OCR_API_KEYS`) give individual revocation and `usage_event.v1` attribution, but there are no quotas or rate limits yet. Treat every key holder as trusted within its key scope; rotate the shared key via `_NEXT` if it leaks, accepting that shared-key consumers must cut over. GET /api/health carries an additive `build` identity object (commit SHA + source) alongside `runtime_sha`/`commit_sha`.


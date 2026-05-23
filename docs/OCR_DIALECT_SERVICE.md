# OCR + dialect service

Shared cross-product OCR and Bengali dialect cue analysis. Primary deployment: **Next.js on Vercel** (see repo `veridyn-ocr-dialect-service`).

## Canonical production deployment

- **`https://veridyn-ocr-dialect-service.vercel.app`** (team `ravihuq-6378s-projects`; project `veridyn-ocr-dialect-service`)

Set consumer `VERIDYN_OCR_URL` to **`https://veridyn-ocr-dialect-service.vercel.app`** (no trailing slash).

## Web UI routes (OCR-first)

| Route | Role |
|-------|------|
| **`/`** | **Primary** — document upload → Bengali + English OCR → extracted text → autofill candidate fields. Dialect analysis is a **collapsed add-on** panel (opt-in button after OCR). |
| **`/lab`** | **Add-on** — full Bengali Dialect Phrase Lab (cue chips, regional RegSpeech12 samples, manual transcript analyze). Secondary to OCR; links back to `/`. |

Product IA: OCR is the hero flow; dialect is never auto-run on upload and does not compete for attention on the landing page. API consumers (`protein-chain-bd`, etc.) call `/api/documents/extract` as primary; `/api/dialect/analyze` remains opt-in.

## Service URLs (self-hosted forks)
- Dialect shares the same origin: `POST …/api/dialect/analyze` (no second base URL unless you split deployments manually).

## Environment variables (names only — no secrets in git)

| Variable | Scope | Meaning |
|---------|-------|---------|
| `VERIDYN_OCR_URL` | **Consumers** (e.g. `protein-chain-bd`, `bangla-decision-agent`) | HTTPS base URL of this service (**no trailing slash**) |
| `VERIDYN_OCR_API_KEY` | **Consumers** + **this service** | Optional bearer token; clients send `Authorization: Bearer …`; server verifies when set |
| `OCR_CORS_ORIGIN` | **This service** | Optional explicit CORS allow-origin (`*` default) |

## API

### Health

```http
GET /api/health
```

### Document extract (multipart — Veridyn sidecar–compatible keys)

```http
POST /api/documents/extract
Content-Type: multipart/form-data
```

Fields:

- **`file`** (required): PNG, JPG, WEBP, TIFF, PDF (text layer), DOCX, TXT, MD, CSV.
- **`language`** (optional form field): OCR hint — examples: omitted / `ben+eng`, `ben`, `eng`.

Response mirrors the Python FastAPI shape where possible (`text_preview`, `extractable`, `warnings`, `candidate_facts`, `ocr_provenance`).

Additive field for integrations that need downstream NLP/dialect beyond 1200 characters:

- **`full_text_normalized`**: normalized full text string (consumers should treat as candidate-only).

Dialect is **not** implied by OCR; call `/api/dialect/analyze`.

### Dialect cues (ported lab heuristic)

```http
POST /api/dialect/analyze
Content-Type: application/json
```

Body:

```json
{ "text": " … OCR / transcript text … " }
```

Response:

```json
{
  "schema_version": "dialect_cue.v1",
  "input_characters": 42,
  "evidence": {
    "status": "suggested" | "unresolved" | "missing_transcript",
    "source": "transcript_match" | …,
    "dialect_label": "sylhet" | … | null,
    "speaker_region": "Sylhet" | … | null,
    "match_score": 0.7123 | null,
    "candidate_label": "phrase_chip" | … | null
  }
}
```

**Supported cue dialect variants** (Bangladesh regional exemplars wired in code): Sylhet, Barishal, Chattogram/Chittagong, Noakhali, plus bundled long-form Noakhali and Chittagong reference phrases copied from VERIDYN Bengali dialect lab.

English-only input typically yields `unresolved` — dialect module targets Bangla transcripts.

### Integrating from Node / serverless (example)

Document extract (`protein-chain-bd` already aligns with this pattern via `extractViaVeridyn`):

```typescript
async function extractOcr(serviceBase: string, buf: Uint8Array, filename: string, apiKey?: string) {
  const form = new FormData();
  form.append("file", new Blob([buf]), filename);
  const headers = apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {};
  const res = await fetch(`${serviceBase.replace(/\/+$/, "")}/api/documents/extract`, {
    method: "POST",
    body: form,
    headers,
  });
  return res.json();
}
```

Dialect example:

```typescript
await fetch(`${base}/api/dialect/analyze`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
  },
  body: JSON.stringify({ text: normalizedText }),
});
```

## Operational notes

- **Vercel path** uses WASM Tesseract (`tesseract.js`). For scanned multi-page PDFs with native OCR + OSD (Veridyn `document_intake.py` parity), continue to deploy **`protein-chain-bd/scripts/veridyn-ocr-service`** on Docker/Fly/Railway and point `VERIDYN_OCR_URL` there instead.
- **Warm latency**: First image OCR cold start may fetch language models; retries are acceptable for integrations.

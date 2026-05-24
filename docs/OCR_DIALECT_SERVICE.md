# OCR + dialect service

Standalone **Next.js** deployment for autonomous document OCR (**not mocked** — WASM `tesseract.js` on typical image/PDF/text inputs) plus an optional Bengali **dialect cue** analyzer. Canonical prod: **`https://veridyn-ocr-dialect-service.vercel.app`**.

## Product framing

| Layer | Responsibility |
|--------|----------------|
| **Public UI (`/`)** | **Bengali Dialect Lab** — cue chips, RegSpeech-style regional samples, transcript, verdict panel. **Upload path runs real OCR first** and streams text into the transcript; dialect analyze is cue-based on whatever text is in the box (`POST /api/dialect/analyze`). |
| **`/lab`** | Legacy path — **307/redirect to `/`** (everything lives on one page). |
| **Private APIs** | `POST /api/documents/extract` (multipart file) · `POST /api/dialect/analyze` JSON body `{ "text": "…" }` · `GET /api/health`. |

Consumers (`protein-chain-bd`, future `bangla-decision-agent`, etc.) mount **`VERIDYN_OCR_URL`** and call **`/api/documents/extract`** on every document upload server-side — **automatic OCR backbone** independent of optional dialect UX.

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

Mirror **`VERIDYN_OCR_API_KEY`** server-side where used; callers send **`Authorization: Bearer …`** only when configured.

---

## API reference

### `GET /api/health`

Runtime probe.

### `POST /api/documents/extract`

Multipart `file` (required), optional `language` (`ben+eng`, `ben`, …). Response aligns with upstream Veridyn/sidecar fields — includes **`full_text_normalized`** where available for long-text consumers.

### `POST /api/dialect/analyze`

JSON **`{ "text": "বাংলা …" }`**. Response: `schema_version: dialect_cue.v1`, **`evidence`** object with **`status`**, **`dialect_label`**, **`match_score`**, etc.

Dialect is **never** inferred from OCR automatically — callers opt in.

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

(Or rely on **`veridynExtractEndpoint()`** in `protein-chain-bd` — it maps env → correct suffix.)

---

## Operational notes

- **Multi-page raster PDF**: WASM path may degrade vs Docker sidecar (`protein-chain-bd/scripts/veridyn-ocr-service`). For maximal parity deploy that sidecar and point **`VERIDYN_OCR_URL`** at it.
- **Warm latency**: first WASM OCR may download language blobs; retries are acceptable.
- **`OCR_CORS_ORIGIN`** on this service scopes browser CORS; server-to-server calls do not rely on it.

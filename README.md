# veridyn-ocr-dialect-service

Standalone OCR + dialect “catcher” service for Bangladesh-first workflows.

- **OCR**: `POST /api/documents/extract` — compatible multipart contract with **`protein-chain-bd/scripts/veridyn-ocr-service/`** (Docker + native Tesseract) when you need parity; **this deployment** favors Vercel + `tesseract.js`.
- **Runtime**: Production build targets **Vercel** (`tesseract.js` WASM for images). Scanned PDFs should be exported to images — text-layer PDF uses `pdf-parse`.
- **Dialect**: `POST /api/dialect/analyze` — heuristic cue-matching ported from `factory-VERIDYN/ui/bengali-dialect-lab/`.
- **Web UI**: `/` — dialect lab homepage (OCR → transcript → chips/samples/verdict). `/lab` redirects to `/`.

Documentation: **[docs/OCR_DIALECT_SERVICE.md](./docs/OCR_DIALECT_SERVICE.md)**

## Local

```powershell
npm install
npm run dev
# http://localhost:3333 — UI uploads file
curl http://localhost:3333/api/health
```

## Smoke (after dev server is running)

```powershell
npm run smoke
```

## Deploy Vercel

```powershell
$env:VERCEL_TOKEN="<from salts file>"
npx vercel deploy --prod --yes
```

Production: canonical deployment is `https://veridyn-ocr-dialect-service.vercel.app`.

**Bearer auth fails closed.** Set `VERIDYN_OCR_API_KEY` (and optionally
`VERIDYN_OCR_API_KEY_NEXT` for staged rotation) on every deployed environment
— production **and** preview. Consumers send `Authorization: Bearer <matching
key>`. If no key is configured, deployed environments reject all API requests
with `503 Service unavailable`; the allow-all bypass exists only in genuine
local dev (not on Vercel, `NODE_ENV !== "production"`). Promote `_NEXT` after
all consumers are updated.

**CORS fails closed.** `OCR_CORS_ORIGINS` (comma-separated allowlist) controls
which browser origins may make cross-origin calls. A matching origin is
reflected into `Access-Control-Allow-Origin`; unlisted origins get no CORS
grant. The default is **empty** (no cross-origin access) — there is no wildcard
default. Set it to your real consumer origins (e.g. DataRoom / BDA / Agentic),
or `*` only if you deliberately want any-origin browser access. Server-to-server
consumers do not rely on CORS.

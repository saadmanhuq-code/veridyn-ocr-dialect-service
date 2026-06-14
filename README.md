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
Bearer auth is fail-closed by default. Configure `VERIDYN_OCR_API_KEY` and/or
`VERIDYN_OCR_API_KEY_NEXT`; consumers must send `Authorization: Bearer <matching
key>`. Use the `_NEXT` key for staged rotation, then promote it after all
consumers are updated. If both keys are absent, protected OCR routes return 503.
`VERIDYN_OCR_ALLOW_UNAUTHENTICATED=true` is honored only outside production for
an explicit local/dev run. `OCR_CORS_ORIGIN` can tighten browser CORS; the default is the canonical
production origin, not `*`. Server-to-server consumers do not rely on CORS.

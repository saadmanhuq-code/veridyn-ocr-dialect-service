# veridyn-ocr-dialect-service

Standalone OCR + dialect “catcher” service for Bangladesh-first workflows.

- **OCR**: `POST /api/documents/extract` — compatible multipart contract with [`protein-chain-bd` scripts/veridyn-ocr-service](../protein-chain-bd/scripts/veridyn-ocr-service/).
- **Runtime**: Production build targets **Vercel** (`tesseract.js` WASM for images). Scanned PDFs should be exported to images — text-layer PDF uses `pdf-parse`.
- **Dialect**: `POST /api/dialect/analyze` — heuristic cue-matching ported from `factory-VERIDYN/ui/bengali-dialect-lab/`.

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

Production: configure optional `VERIDYN_OCR_API_KEY` match on consumers; optionally `OCR_CORS_ORIGIN` for tightening CORS (default `*`).

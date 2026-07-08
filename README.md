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

## Vercel Vision OCR fallback

The image OCR and image-intent paths try Vertex first, then direct Gemini, then
OpenRouter vision models. Set `OPENROUTER_API_KEY` for the OpenRouter fallback.
`OPENROUTER_OCR_MODELS` accepts a comma-separated ordered model chain. If it is
unset, legacy `OPENROUTER_OCR_MODEL` is tried first and then the built-in
fallbacks are used: `xiaomi/mimo-v2.5`, `qwen/qwen3-vl-8b-instruct`, and
`qwen/qwen3-vl-30b-a3b-instruct`. Keep unproven or router-alias models such as
DeepSeek text models, NVIDIA free vision routes, and `openrouter/free` out of the
default image chain until a live image probe proves that exact model for OCR.

**Bearer auth fails closed.** Set `VERIDYN_OCR_API_KEY` (and optionally
`VERIDYN_OCR_API_KEY_NEXT` for staged rotation) on every deployed environment
— production **and** preview. Consumers send `Authorization: Bearer <matching
key>`. If no key is configured, every environment rejects all API requests with
`403 Forbidden` by default. The allow-all bypass requires **all three**
conditions to hold simultaneously: (a) `VERIDYN_OCR_ALLOW_UNAUTHENTICATED=true`
set explicitly, (b) not on Vercel, and (c) `NODE_ENV !== "production"`. This
explicit opt-in prevents fail-open on non-Vercel hosts (e.g. Docker on Oracle
VM3) that omit the flag and have no keys configured. Promote `_NEXT` after all
consumers are updated.

**CORS fails closed.** `OCR_CORS_ORIGINS` (comma-separated allowlist) controls
which browser origins may make cross-origin calls. A matching origin is
reflected into `Access-Control-Allow-Origin`; unlisted origins get no CORS
grant. The default is **empty** (no cross-origin access) — there is no wildcard
default. Set it to your real consumer origins (e.g. DataRoom / BDA / Agentic),
or `*` only if you deliberately want any-origin browser access. Server-to-server
consumers do not rely on CORS.

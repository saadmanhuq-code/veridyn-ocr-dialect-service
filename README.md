# veridyn-ocr-dialect-service

Standalone OCR + dialect “catcher” service for Bangladesh-first workflows.

- **OCR**: `POST /api/documents/extract` — compatible multipart contract with **`protein-chain-bd/scripts/veridyn-ocr-service/`** (Docker + native Tesseract) when you need parity. On Vercel, image and scanned-PDF OCR uses a configured Vertex, Gemini, or OpenRouter vision provider; the deployment does not fall back to Tesseract.
- **Runtime**: Production targets **Vercel**. Text-layer PDFs use `pdf-parse`; non-Vercel runtimes may fall back to server-side `tesseract.js` for image OCR.
- **Dialect**: `POST /api/dialect/analyze` — heuristic cue-matching ported from `factory-VERIDYN/ui/bengali-dialect-lab/`.
- **Web UI**: `/` — unauthenticated integration/reference page. It does not call the bearer-protected APIs or receive an API key. `/lab` redirects to `/`.

Documentation: **[docs/OCR_DIALECT_SERVICE.md](./docs/OCR_DIALECT_SERVICE.md)** — integration and operational reference for this extraction-tier satellite. It does not define VERIDYN decision-engine or product authority; current authority remains in the private `saadmanhuq-code/veridyn-rule-engine-v2-private` repository.

## Local

```powershell
npm install
npm run dev
# http://localhost:3333 — public integration/reference UI
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

**Per-consumer API keys (`VERIDYN_OCR_CONSUMER_KEYS`).** The single shared
`VERIDYN_OCR_API_KEY` still works (attributed as consumer `legacy`), but new
and migrating consumers should get their own individually revocable key
instead of sharing one static secret. Set `VERIDYN_OCR_CONSUMER_KEYS` to
either a JSON object or a comma-separated `name:key` list:

```
VERIDYN_OCR_CONSUMER_KEYS={"proteinchain":"<key-a>","dataroom":"<key-b>"}
# or:
VERIDYN_OCR_CONSUMER_KEYS=proteinchain:<key-a>,dataroom:<key-b>
```

- **Issue** a new consumer: generate a fresh random secret (e.g. `openssl rand
  -hex 32`), add a `name: key` entry for it, redeploy, and hand the consumer
  its own key (never reuse another consumer's key or the legacy key).
- **Revoke** a consumer: delete its entry from `VERIDYN_OCR_CONSUMER_KEYS` and
  redeploy. Every other named consumer, and the legacy key, keep working
  unaffected — revocation is per-entry, not all-or-nothing.
- Every authenticated request is attributed to its consumer name (or
  `legacy` for the shared key) in the server log and in the
  `x-veridyn-consumer` response header, so a compromised or offboarded
  consumer can be identified and cut off individually.
- Keep real key values in the secure operator stash or deployment secrets,
  never in git — same rule as the legacy key.

**CORS fails closed.** `OCR_CORS_ORIGINS` (comma-separated allowlist) controls
which browser origins may make cross-origin calls. A matching origin is
reflected into `Access-Control-Allow-Origin`; unlisted origins get no CORS
grant. The default is **empty** (no cross-origin access) — there is no wildcard
default. Set it to your real consumer origins (e.g. DataRoom / BDA / Agentic),
or `*` only if you deliberately want any-origin browser access. Server-to-server
consumers do not rely on CORS.

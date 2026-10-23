# Agent Instructions — veridyn-ocr-dialect-service

## Product boundary and invariants

- **Product key:** `veridyn-ocr`
- **Role:** Standalone OCR and Bengali dialect "catcher" satellite service for Bangladesh-first intake workflows.
- **Authority:** This service owns OCR/extraction for intake support; it does not define VERIDYN decision-engine or dialect authority (runtime authority is `veridyn-proven-recovery-2026-05-22`). Its `/api/dialect/analyze` endpoint is a ported heuristic cue-matcher for intake support, not the governed dialect authority.
- **Verified consumer:** One verified production consumer exists — ProteinChain (`VERIDYN_OCR_URL` / `VERIDYN_OCR_API_KEY`). Other consumers are unverified, not asserted absent.
- **Surfaces:** Unauthenticated reference page at `/` (bundles cue chips and regional samples; `/lab` redirects to `/`). Protected API routes under `/api/` require bearer auth.
- **Deployments:** Leader/operator only. Coding seats do not deploy.

## Build and verification

- Install dependencies: `npm ci`
- Run test suite: `npm test`
- Build application: `npm run build`
- Typecheck / lint: `npm run lint`
- Local dev server: `npm run dev`

## Portfolio State Protocol

Product key: `veridyn-ocr`. Its state file is
`state/products/veridyn-ocr.json` in `ss-group3592724/portfolio-core`.
Use the [Portfolio State System](https://gitlab.com/ss-group3592724/portfolio-core/-/blob/main/STATE-SYSTEM.md)
for state reads and writes, shared-package adoption, and state merge requirements.

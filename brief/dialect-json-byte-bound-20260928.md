# OCR dialect JSON byte bound

Base: e7e6e397d7a0f47fb1146409c428950631de99af
Scope: app/api/dialect/analyze/route.ts, app/api/phrase-eval/route.ts, lib/limited-json-body.ts, lib/dialect-input-boundary.test.ts, this brief.
Family: Codex native.
Spec: After authentication, both dialect text routes must stop reading a JSON body after 65,536 bytes even when Content-Length is missing or underreported, return 413 before JSON parse/inference, and keep malformed small JSON at 400. Phrase-eval JSON null must return 400 instead of throwing. Preserve the existing 8,192-character text bound and ordinary inference.
Acceptance: Commit route-level tests first; baseline CI must fail actual padded-body and null-body behaviors. Fixed exact-head CI and postmerge main CI must pass.
Residual: Infrastructure may buffer bytes before NextRequest reaches the route; this bound protects route parsing/heap, not the proxy's ingress limit.
Closeout: NATIVE-RESULT {base, head, red_pipeline, green_pipeline, result, limits}

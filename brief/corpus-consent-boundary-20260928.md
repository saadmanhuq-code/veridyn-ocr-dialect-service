# Stop OCR corpus writes without end-user consent

Base: 8d4a5306422f741ef43784046e0b9e0abc789e4a
Scope: app/api/voice/transcribe/route.ts, app/api/image-intent/route.ts, lib/corpus-log.ts, lib/corpus-consent-boundary.test.ts, this brief.
Family: Codex native.
Acceptance: With VERIDYN_CORPUS_LOG=enabled, successful authenticated voice and image requests return their normal product result but emit no corpus_event.v1 line while no end-user consent flow exists. The logger refuses consent:false/missing. Existing explicit-consent helper behavior remains available for a future verified consent path.
Red at base: pending exact-head test-only CI.
Green at head: pending exact-head GitLab CI.
Residual: Existing process/log-drain corpus lines may retain historical transcripts or hashes; retention cleanup requires a separate live inventory. This repair does not add a consent UI.
Closeout: NATIVE-RESULT {base, head, red_pipeline, green_pipeline, result, limits}

# Detect active mutation auth calls in OCR routes

Base: f2ef2e1f33c622cb77460f1a6cd732fd395e96dc
Scope: lib/integrity-auth-coverage.ts, lib/integrity-auth-coverage.test.ts, this brief.
Family: Codex native.
Acceptance: AUTH-COVERAGE flags exported mutation handlers if requireApiKey appears only in a comment, string literal, or sibling GET handler. It still accepts a real requireApiKey call in the mutation handler and passes the current real-route scan.
Red at base: test-only head 1a89778c948a080f69211187a7b4770ef7d8dd63, pipeline 2887926664, failed three planted route cases: requireApiKey in a comment, in a string literal, or only in a sibling GET handler. Existing clean route scan and other auth tests passed.
Green at head: pending exact-head GitLab CI.
Limit: This statically proves a call exists inside the handler; it does not prove the handler honors a denied response. Request-level auth tests remain necessary for effective authority.
Closeout: NATIVE-RESULT {base, head, red_pipeline, green_pipeline, result, limits}

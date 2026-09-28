# Key OCR worker cache by packaged language

Base: f2ef2e1f33c622cb77460f1a6cd732fd395e96dc
Scope: lib/ocr-engine.ts, lib/ocr-engine-language.test.ts, this brief.
Family: Codex native.
Acceptance: Requesting Bengali after English returns a Bengali-specific worker, while repeated English requests reuse the English worker. Only language combinations backed by packaged ben/eng tessdata are accepted; unsupported language cannot silently reuse another worker. A failed worker initialization can be retried.
Red at base: pending exact-head test-only CI.
Green at head: pending exact-head GitLab CI.
Limit: This checks worker selection and resource reuse; OCR recognition accuracy still depends on document quality and traineddata.
Closeout: NATIVE-RESULT {base, head, red_pipeline, green_pipeline, result, limits}

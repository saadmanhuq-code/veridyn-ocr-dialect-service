> **HISTORICAL / RECORD (2026-09-29):** Dated task brief and acceptance record from 2026-09-28. Retained unchanged for provenance.

# Bound dialect matcher input

Base: 296ed87964188b70d1e7417ded0384e286a2f4ec
Scope: app/api/dialect/analyze/route.ts, app/api/phrase-eval/route.ts, lib/dialect.ts, lib/dialect-input-boundary.test.ts, this brief.
Family: Codex native.
Acceptance: Authenticated dialect analyze rejects text longer than 8192 UTF-16 characters with 413 before matching. Phrase evaluation rejects a batch whose aggregate phrase length exceeds 8192 with 413 before matching. Ordinary inputs still return their established response. The 50-phrase count cap remains.
Red at base: test-only eba7b16380b86cb5149fc1f5fc02b7e4f435add6 pipeline 2887871104 failed the two oversized-request cases (actual 200, expected 413); ordinary inference passed.
Green at head: pending exact-head GitLab CI.
Limit: This bounds the matcher work triggered by these two routes; it does not define a raw HTTP byte limit for arbitrary JSON bodies.
Closeout: NATIVE-RESULT {base, head, red_pipeline, green_pipeline, result, limits}

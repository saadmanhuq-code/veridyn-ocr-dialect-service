> **HISTORICAL / RECORD (2026-09-29):** Dated task brief and acceptance record from 2026-09-28. Retained unchanged for provenance.

# Surface vision-to-local OCR fallback

Base: 5fadbe7858c714728a2bda94c2201d8586a705e1
Scope: lib/pdf-raster-ocr.ts, lib/pdf-raster-ocr-fallback.test.ts, this brief.
Family: Codex native.
Acceptance: When configured vision OCR fails outside Vercel, image OCR may use local Tesseract but its result must identify provider failure in provenance and give a readable warning. Provider error text must not be exposed in the result. The test invokes the actual image OCR path, a stubbed failed provider response, and a real local worker.
Red at base: test-only 36429ec68c8003d99aa3eb53e32aa31dd7f7585e, pipeline 2887943446, failed one actual OCR image behavior assertion: provider request was attempted and Tesseract ran, but ocr_provenance.vision_fallback was undefined instead of provider_failure. The 90 existing tests passed.
Green at head: pending exact-head GitLab CI.
Limit: Vercel continues to throw on provider failure; this repair does not change provider selection or OCR accuracy.
Closeout: NATIVE-RESULT {base, head, red_pipeline, green_pipeline, result, limits}

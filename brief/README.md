# Task Briefs and Historical Records Index

This directory archives historical task briefs, cutover records, and acceptance documentation for `veridyn-ocr-dialect-service`. All files here are retained unchanged for provenance and audit history; active development is governed by the global kernel (`ss-group3592724/operator-os` main `AGENTS.md`) and active GitLab Gate CI.

## Cutover & Gate Migration (Historical)

- [`lane-51.brief.md`](./lane-51.brief.md): Lane #51 cutover execution brief and manual fallback record.
- [`veridyn-ocr-dialect-service-cutover.brief.md`](./veridyn-ocr-dialect-service-cutover.brief.md): Cutover acceptance checks and migration to GitLab Gate CI.

## 2026-09-28 Remediation Briefs (Historical Records)

- [`auth-coverage-active-call-20260928.md`](./auth-coverage-active-call-20260928.md): Detect active mutation auth calls in OCR routes.
- [`corpus-consent-boundary-20260928.md`](./corpus-consent-boundary-20260928.md): Stop OCR corpus writes without end-user consent.
- [`dialect-json-byte-bound-20260928.md`](./dialect-json-byte-bound-20260928.md): Bound dialect JSON bytes before parse and reject null phrase body.
- [`dialect-text-bound-20260928.md`](./dialect-text-bound-20260928.md): Bound dialect matcher input text length.
- [`ocr-worker-language-cache-20260928.md`](./ocr-worker-language-cache-20260928.md): Key OCR worker cache by packaged language.
- [`vision-fallback-provenance-20260928.md`](./vision-fallback-provenance-20260928.md): Surface vision-to-local OCR fallback and safe provenance.

## Minor Fix Briefs & Work Orders

- [`gate-c3-c4-veridyn-ocr-probe.small-fix.brief.md`](./gate-c3-c4-veridyn-ocr-probe.small-fix.brief.md): Gate C3/C4 probe brief.
- [`lane-272.small-fix.brief.md`](./lane-272.small-fix.brief.md): Lane 272 small fix brief.
- [`lane-24.workorder.json`](./lane-24.workorder.json): Lane 24 legacy work order artifact.

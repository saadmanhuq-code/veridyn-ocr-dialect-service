# Controlled Gate C3/C4 targeted-only probe

This is an authorized internal-Gate negative fixture. It clarifies the existing OCR service documentation link as an extraction-tier satellite and intentionally omits `README.md` from this first commit's declared file scope. `small-fix-policy` must reject that mismatch. The follow-up commit corrects only the scope declaration; it does not change product behavior, API contract, source authority, CI configuration, deployment, runtime, or state data.

## Files

- `docs/OCR_DIALECT_SERVICE.md`

## Acceptance checks

- machine: git diff --check 756e20d3b026bbf1ecf0aaada24bd68b48644998 HEAD -- README.md
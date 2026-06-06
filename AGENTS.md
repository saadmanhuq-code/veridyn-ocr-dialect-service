# Agent Instructions — veridyn-ocr-dialect-service

## Portfolio State Protocol

This repo participates in the **saadmanhuq-code** portfolio shared-state system.
The product key for this service is **`veridyn-ocr`**.
All shared state lives in a separate repo: **`saadmanhuq-code/portfolio-core`**.

### Read this product's state

Before starting work, read the per-product state file from `portfolio-core`.
You can do this without a local checkout by using the GitHub API:

```bash
# Via gh API (no checkout needed):
export MSYS_NO_PATHCONV=1
gh api repos/saadmanhuq-code/portfolio-core/contents/state/products/veridyn-ocr.json \
  --jq .content | base64 -d | jq .
```

Or, if you have a local checkout of `saadmanhuq-code/portfolio-core`:

```bash
cat state/products/veridyn-ocr.json | jq .
```

For the portfolio-wide shared-package registry (`@saadmanhuq-code/*`):

```bash
gh api repos/saadmanhuq-code/portfolio-core/contents/state/shared-packages.json \
  --jq .content | base64 -d | jq '.packages'
# or in a local checkout:
cat state/shared-packages.json | jq '.packages'
```

### Write state updates

After completing work that changes this product's status (CI fix, P0 fix/added,
deployment, package adoption), record it in `saadmanhuq-code/portfolio-core`.
Each call writes exactly ONE file (atomic, conflict-free):

```bash
# In a checkout of saadmanhuq-code/portfolio-core:
npx tsx scripts/update-state.ts veridyn-ocr <field> <value> --agent <your-name>
git add state/products/veridyn-ocr.json
git commit -m "state: <what changed> (veridyn-ocr, <your-name>)"
git push
```

Record adopting a shared package (writes only the registry file):

```bash
npx tsx scripts/update-state.ts shared_package @saadmanhuq-code/<pkg> adopt:veridyn-ocr --agent <your-name>
# and mirror it on the product side:
npx tsx scripts/update-state.ts veridyn-ocr shared_pkg_add @saadmanhuq-code/<pkg>:<version> --agent <your-name>
```

### Rules

- Do **not** hand-edit `state/portfolio-state.json` — it is the auto-generated,
  read-only rollup. Edit the per-product file (`state/products/veridyn-ocr.json`)
  and let `validate-state` regenerate the rollup.
- If you see `drift_warnings` for `veridyn-ocr` in the rollup, address them.
- The full protocol, the data model, and the validator's drift taxonomy are in
  `saadmanhuq-code/portfolio-core` → `STATE-SYSTEM.md`.
# Agent Instructions — veridyn-ocr-dialect-service

## Portfolio State Protocol

This repo participates in the **ss-group3592724** portfolio shared-state system on GitLab.
The product key for this service is **`veridyn-ocr`**.
All shared state lives in a separate repo: **`ss-group3592724/portfolio-core`**. GitHub is a push-mirror target, not the state authority; seats have no GitHub API access, so do not use `gh api`, `gh repo clone`, or `git push` here.

Product-key → repo map (keys differ from repo names):

| Product key | GitLab repo |
|---|---|
| `veridyn-ocr` | `ss-group3592724/veridyn-ocr-dialect-service` |
| `veridyn-bootstrap` | `ss-group3592724/veridyn-bootstrap` |
| `veridyn-compliance` | `ss-group3592724/veridyn-proven-recovery-2026-05-22` |

### Read this product's state

Before starting work, read the per-product state file from `portfolio-core`.
You can do this without a local checkout by using the GitLab API:

```bash
# Via glab api (no checkout needed):
glab api "projects/ss-group3592724%2Fportfolio-core/repository/files/state%2Fproducts%2Fveridyn-ocr%2Ejson/raw?ref=main"
```

Or, if you have a local checkout of `ss-group3592724/portfolio-core`:

```bash
cat state/products/veridyn-ocr.json | jq .
```

For the portfolio-wide shared-package registry (`@saadmanhuq-code/*`):

```bash
glab api "projects/ss-group3592724%2Fportfolio-core/repository/files/state%2Fshared-packages%2Ejson/raw?ref=main" | jq '.packages'
# or in a local checkout:
cat state/shared-packages.json | jq '.packages'
```

### Write state updates

After completing work that changes this product's status (CI fix, P0 fix/added,
deployment, package adoption), record it in `ss-group3592724/portfolio-core`
through a branch plus merge request — never a direct push to `main`.
Each call writes exactly ONE file (atomic, conflict-free):

```bash
# In a checkout of ss-group3592724/portfolio-core:
git checkout -b state/veridyn-ocr-<short-topic>
npx tsx scripts/update-state.ts veridyn-ocr <field> <value> --agent <your-name>
git add state/products/veridyn-ocr.json
git commit -m "state: <what changed> (veridyn-ocr, <your-name>)"
git push -u origin state/veridyn-ocr-<short-topic>
glab mr create --source-branch state/veridyn-ocr-<short-topic> --target-branch main --title "state: <what changed> (veridyn-ocr)"
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
  `ss-group3592724/portfolio-core` → `STATE-SYSTEM.md`.
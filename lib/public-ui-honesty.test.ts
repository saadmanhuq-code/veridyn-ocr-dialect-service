/**
 * Public-UI honesty gate (W5; smallest equivalent of PR #30's
 * public-ui-honesty.test.ts, adapted to this base in deploy-config.test.ts
 * style — source assertions resolved from the repo root, not process.cwd()).
 *
 * The unauthenticated page at `/` must never call the bearer-protected APIs
 * keyless (they correctly return 401 in production) and must never claim live
 * results it cannot produce. If a future authenticated UI is designed, this
 * test must be revisited deliberately — not weakened to make a keyless fetch
 * pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

test("public UI does not call protected APIs or imply browser authentication", () => {
  const page = source("app/page.tsx");

  assert.doesNotMatch(page, /\bfetch\s*\(/, "the unauthenticated page must not call protected APIs");
  assert.doesNotMatch(page, /XMLHttpRequest/, "the unauthenticated page must not call protected APIs");
  assert.doesNotMatch(page, /VERIDYN_OCR_API_KEY|NEXT_PUBLIC_.*API_KEY/);
  assert.doesNotMatch(page, /type="file"/, "the public page must not offer an upload it cannot submit");
  assert.doesNotMatch(page, /Production path|API live/);
  assert.match(page, /Server auth required/);
  assert.match(page, /does\s+not call the OCR or dialect APIs/);
  assert.match(page, /no API key is sent to this browser/);
});

test("public UI is an honest reference surface: capability matrix, static labels, consumer truth", () => {
  const page = source("app/page.tsx");

  assert.match(page, /Capability matrix/);
  assert.match(page, /No API call/, "bundled phrase reference must be labelled static");
  assert.match(page, /Bundled reference data \(static\)/);
  assert.match(page, /Sole verified production consumer:[\s\S]*ProteinChain/);
  assert.match(page, /docs\/CONSUMERS\.md/);
  assert.doesNotMatch(page, /DataRoom, BDA, and Agentic consume/);
  assert.doesNotMatch(page, /every other product integrates/);
  // `/lab` stays a bare redirect to the reference page.
  assert.match(source("app/lab/page.tsx"), /redirect\("\/"\)/);
});

test("Vercel OCR claims match the vision-provider-only runtime path", () => {
  const surfaces = [
    source("app/page.tsx"),
    source("app/layout.tsx"),
    source("README.md"),
    source("docs/OCR_DIALECT_SERVICE.md"),
    source("docs/CONSUMERS.md"),
  ].join("\n");

  assert.doesNotMatch(surfaces, /WASM Tesseract|tesseract\.js WASM for images|this deployment.*tesseract\.js/i);
  assert.match(surfaces, /vision provider/i);
  assert.match(source("README.md"), /On Vercel[\s\S]*does not fall back to Tesseract/);
});

test("frontend audit classifies the public page as an intentional reference surface", () => {
  // Ported from PR #30's third honesty test; layout allows it on this base.
  const audit = source("specs/frontend/UI_AUDIT.md");

  assert.match(audit, /FIXTURE-ONLY \(intentional public reference surface\)/);
  assert.match(audit, /no `fetch\(\)`/);
  assert.match(audit, /server-side bridge was rejected/i);
  assert.doesNotMatch(audit, /Primary content is real-wired via client `fetch\(\)`/);
});

test("consumer docs state current key/limit truth instead of inventing per-consumer keys", () => {
  assert.ok(existsSync(join(REPO_ROOT, "docs/CONSUMERS.md")), "docs/CONSUMERS.md must exist");
  const consumers = source("docs/CONSUMERS.md");

  assert.match(consumers, /ProteinChain/);
  // Integrated truth (W4): per-consumer named keys exist as operator-issued
  // credentials; quotas/rate limits do not. Guard both halves and the
  // merged W1/W3 limits so copy cannot drift back to the pre-wave claims.
  assert.match(consumers, /per-consumer named keys/i);
  assert.match(consumers, /quotas and rate limits are \*\*not yet available\*\*/i);
  assert.doesNotMatch(consumers, /Per-consumer keys are \*\*not yet\s+available\*\*/i);
  assert.doesNotMatch(consumers, /First \*\*2 pages\*\* only/);
  assert.match(consumers, /50 pages/);
  assert.match(consumers, /11 labels, 19 cue phrases/);
  assert.match(consumers, /candidate evidence/i);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

test("public UI does not call protected APIs or imply browser authentication", () => {
  const page = source("app/page.tsx");

  assert.doesNotMatch(page, /\bfetch\s*\(/, "the unauthenticated page must not call protected APIs");
  assert.doesNotMatch(page, /VERIDYN_OCR_API_KEY|NEXT_PUBLIC_.*API_KEY/);
  assert.doesNotMatch(page, /Production path|API live/);
  assert.match(page, /Server auth required/);
  assert.match(page, /does\s+not call the OCR or dialect APIs/);
  assert.match(page, /no API key is sent to this browser/);
});

test("Vercel OCR claims match the vision-provider-only runtime path", () => {
  const surfaces = [
    source("app/page.tsx"),
    source("app/layout.tsx"),
    source("README.md"),
    source("docs/OCR_DIALECT_SERVICE.md"),
  ].join("\n");

  assert.doesNotMatch(surfaces, /WASM Tesseract|tesseract\.js WASM for images|this deployment.*tesseract\.js/i);
  assert.match(surfaces, /vision provider/i);
  assert.match(source("README.md"), /On Vercel[\s\S]*does not fall back to Tesseract/);
});

test("frontend audit classifies the public panels as reference-only", () => {
  const audit = source("specs/frontend/UI_AUDIT.md");

  assert.match(audit, /FIXTURE-ONLY \(intentional public reference surface\)/);
  assert.match(audit, /no `fetch\(\)`/);
  assert.match(audit, /server-side bridge was rejected/i);
  assert.doesNotMatch(audit, /Primary content is real-wired via client `fetch\(\)`/);
});

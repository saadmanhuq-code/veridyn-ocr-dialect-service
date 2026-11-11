/**
 * Regression gate for two production failures observed 2026-11-11:
 *
 *  1. Scanned-PDF OCR returned HTTP 500 "Cannot find module '@napi-rs/canvas'"
 *     on Vercel. Root cause: webpack-bundled pdf.mjs resolves canvas via
 *     createRequire(import.meta.url), whose build-machine path does not exist
 *     at runtime. pdfjs-dist must stay a server-external package (loaded from
 *     real node_modules) and canvas must be force-included in file tracing.
 *
 *  2. Voice transcription silently degraded to { fallback: true } because the
 *     Gemini Studio default model "gemini-2.0-flash" was retired upstream
 *     (HTTP 404). Code defaults must name a live model; env overrides stay.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("extract route file tracing includes @napi-rs/canvas (scanned-PDF raster)", () => {
  const config = readFileSync(join(REPO_ROOT, "next.config.ts"), "utf8");
  const extractBlock = config.slice(config.indexOf('"/api/documents/extract"'));
  assert.match(extractBlock, /@napi-rs\/canvas\//, "canvas JS package must be force-traced");
  assert.match(extractBlock, /@napi-rs\/canvas-linux-x64-gnu\//, "linux native .node must be force-traced");
  assert.match(config, /serverExternalPackages:[^\]]*"@napi-rs\/canvas"/);
  assert.match(config, /serverExternalPackages:[^\]]*"pdfjs-dist"/, "pdfjs-dist must be external so its createRequire anchor is the real node_modules path");
});

test("no Gemini default names the retired gemini-2.0-flash model", () => {
  for (const rel of ["lib/audio-stt.ts", "lib/vision-ocr.ts", "lib/image-intent.ts"]) {
    const src = readFileSync(join(REPO_ROOT, rel), "utf8");
    assert.doesNotMatch(src, /\|\|\s*"gemini-2\.0-flash"/, `${rel} still defaults to retired model`);
    assert.match(src, /\|\|\s*"gemini-2\.5-flash"/, `${rel} must default to a live model`);
  }
});

test("Vertex default model is reachable on the prod GCP project", () => {
  // gemini-2.5-flash returns 404 on gen-lang-client-0305450104 in every
  // location probed (2026-11-11); gemini-3.8-flash/global returned 200.
  const src = readFileSync(join(REPO_ROOT, "lib/vertex-gemini.ts"), "utf8");
  assert.match(src, /DEFAULT_VERTEX_MODEL = "gemini-3\.8-flash"/);
});

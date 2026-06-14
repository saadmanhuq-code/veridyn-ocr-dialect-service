import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { corsHeaders } from "./cors";

let savedOrigin: string | undefined;

beforeEach(() => {
  savedOrigin = process.env.OCR_CORS_ORIGIN;
  delete process.env.OCR_CORS_ORIGIN;
});

afterEach(() => {
  if (savedOrigin === undefined) delete process.env.OCR_CORS_ORIGIN;
  else process.env.OCR_CORS_ORIGIN = savedOrigin;
});

test("CORS default is not wildcard", () => {
  assert.equal(
    corsHeaders()["Access-Control-Allow-Origin"],
    "https://veridyn-ocr-dialect-service.vercel.app",
  );
});

test("CORS can be explicitly configured", () => {
  process.env.OCR_CORS_ORIGIN = "https://example.com";
  assert.equal(corsHeaders()["Access-Control-Allow-Origin"], "https://example.com");
});

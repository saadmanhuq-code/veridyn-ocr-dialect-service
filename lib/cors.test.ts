import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { corsHeaders } from "./cors";

let savedOrigins: string | undefined;

beforeEach(() => {
  savedOrigins = process.env.OCR_CORS_ORIGINS;
  delete process.env.OCR_CORS_ORIGINS;
});

afterEach(() => {
  if (savedOrigins === undefined) delete process.env.OCR_CORS_ORIGINS;
  else process.env.OCR_CORS_ORIGINS = savedOrigins;
});

test("unset allowlist: no Access-Control-Allow-Origin (fail closed, no wildcard)", () => {
  const h = corsHeaders("https://attacker.example");
  assert.equal(h["Access-Control-Allow-Origin"], undefined);
  // Static headers are still present so preflight negotiation is well-formed.
  assert.equal(h["Access-Control-Allow-Methods"], "GET, POST, OPTIONS");
  assert.equal(h["Vary"], "Origin");
});

test("allowlisted origin is reflected", () => {
  process.env.OCR_CORS_ORIGINS = "https://dataroom.example,https://bda.example";
  const h = corsHeaders("https://dataroom.example");
  assert.equal(h["Access-Control-Allow-Origin"], "https://dataroom.example");
  assert.equal(h["Vary"], "Origin");
});

test("non-allowlisted origin is NOT reflected (fail closed)", () => {
  process.env.OCR_CORS_ORIGINS = "https://dataroom.example";
  const h = corsHeaders("https://evil.example");
  assert.equal(h["Access-Control-Allow-Origin"], undefined);
});

test("trailing slashes are normalized when matching", () => {
  process.env.OCR_CORS_ORIGINS = "https://dataroom.example/";
  const h = corsHeaders("https://dataroom.example");
  assert.equal(h["Access-Control-Allow-Origin"], "https://dataroom.example");
});

test("no request origin (same-origin call): omits Access-Control-Allow-Origin", () => {
  process.env.OCR_CORS_ORIGINS = "https://dataroom.example";
  const h = corsHeaders(null);
  assert.equal(h["Access-Control-Allow-Origin"], undefined);
});

test('explicit wildcard opt-in ("*") echoes "*"', () => {
  process.env.OCR_CORS_ORIGINS = "*";
  const h = corsHeaders("https://anything.example");
  assert.equal(h["Access-Control-Allow-Origin"], "*");
});

test("empty/whitespace entries are ignored", () => {
  process.env.OCR_CORS_ORIGINS = " , ,https://ok.example, ";
  assert.equal(corsHeaders("https://ok.example")["Access-Control-Allow-Origin"], "https://ok.example");
  assert.equal(corsHeaders("https://nope.example")["Access-Control-Allow-Origin"], undefined);
});

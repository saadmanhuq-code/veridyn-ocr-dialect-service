import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { requireApiKey } from "./auth";

const OLD_KEY = "old-secret-key-aaaaaaaaaaaa";
const NEXT_KEY = "next-secret-key-bbbbbbbbbbbbbbbbbbbb"; // intentionally different length from OLD_KEY
const mutableEnv = process.env as Record<string, string | undefined>;

function reqWith(token: string | null): Headers {
  return new Headers(token === null ? {} : { authorization: `Bearer ${token}` });
}

let savedKey: string | undefined;
let savedNext: string | undefined;
let savedAllowUnauthenticated: string | undefined;
let savedNodeEnv: string | undefined;
let savedVercelEnv: string | undefined;

beforeEach(() => {
  savedKey = process.env.VERIDYN_OCR_API_KEY;
  savedNext = process.env.VERIDYN_OCR_API_KEY_NEXT;
  savedAllowUnauthenticated = process.env.VERIDYN_OCR_ALLOW_UNAUTHENTICATED;
  savedNodeEnv = process.env.NODE_ENV;
  savedVercelEnv = process.env.VERCEL_ENV;
  delete process.env.VERIDYN_OCR_API_KEY;
  delete process.env.VERIDYN_OCR_API_KEY_NEXT;
  delete process.env.VERIDYN_OCR_ALLOW_UNAUTHENTICATED;
  delete mutableEnv.NODE_ENV;
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.VERIDYN_OCR_API_KEY;
  else process.env.VERIDYN_OCR_API_KEY = savedKey;
  if (savedNext === undefined) delete process.env.VERIDYN_OCR_API_KEY_NEXT;
  else process.env.VERIDYN_OCR_API_KEY_NEXT = savedNext;
  if (savedAllowUnauthenticated === undefined) delete process.env.VERIDYN_OCR_ALLOW_UNAUTHENTICATED;
  else process.env.VERIDYN_OCR_ALLOW_UNAUTHENTICATED = savedAllowUnauthenticated;
  if (savedNodeEnv === undefined) delete mutableEnv.NODE_ENV;
  else mutableEnv.NODE_ENV = savedNodeEnv;
  if (savedVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = savedVercelEnv;
});

test("rotation window: OLD key authorizes when both keys are set", () => {
  process.env.VERIDYN_OCR_API_KEY = OLD_KEY;
  process.env.VERIDYN_OCR_API_KEY_NEXT = NEXT_KEY;
  assert.equal(requireApiKey(reqWith(OLD_KEY)), null);
});

test("rotation window: NEXT key authorizes when both keys are set", () => {
  process.env.VERIDYN_OCR_API_KEY = OLD_KEY;
  process.env.VERIDYN_OCR_API_KEY_NEXT = NEXT_KEY;
  assert.equal(requireApiKey(reqWith(NEXT_KEY)), null);
});

test("OLD key alone authorizes (NEXT unset)", () => {
  process.env.VERIDYN_OCR_API_KEY = OLD_KEY;
  assert.equal(requireApiKey(reqWith(OLD_KEY)), null);
});

test("NEXT key alone authorizes (OLD unset)", () => {
  process.env.VERIDYN_OCR_API_KEY_NEXT = NEXT_KEY;
  assert.equal(requireApiKey(reqWith(NEXT_KEY)), null);
});

test("wrong key (different length) returns 401, not 500", () => {
  process.env.VERIDYN_OCR_API_KEY = OLD_KEY;
  process.env.VERIDYN_OCR_API_KEY_NEXT = NEXT_KEY;
  const res = requireApiKey(reqWith("totally-wrong"));
  assert.notEqual(res, null);
  assert.equal(res!.status, 401);
});

test("wrong key (same length as OLD) returns 401", () => {
  process.env.VERIDYN_OCR_API_KEY = OLD_KEY;
  const wrongSameLen = "x".repeat(OLD_KEY.length);
  const res = requireApiKey(reqWith(wrongSameLen));
  assert.notEqual(res, null);
  assert.equal(res!.status, 401);
});

test("missing Authorization header returns 401 when a key is set", () => {
  process.env.VERIDYN_OCR_API_KEY = OLD_KEY;
  const res = requireApiKey(reqWith(null));
  assert.notEqual(res, null);
  assert.equal(res!.status, 401);
});

test("both keys unset: fails closed by default", () => {
  const res = requireApiKey(reqWith(null));
  assert.notEqual(res, null);
  assert.equal(res!.status, 503);
});

test("both keys unset: explicit local/dev opt-out allows unauthenticated requests", () => {
  process.env.VERIDYN_OCR_ALLOW_UNAUTHENTICATED = "true";
  assert.equal(requireApiKey(reqWith(null)), null);
  assert.equal(requireApiKey(reqWith("anything")), null);
});

test("both keys unset: explicit opt-out is ignored in production", () => {
  process.env.VERIDYN_OCR_ALLOW_UNAUTHENTICATED = "true";
  process.env.VERCEL_ENV = "production";
  const res = requireApiKey(reqWith(null));
  assert.notEqual(res, null);
  assert.equal(res!.status, 503);
});

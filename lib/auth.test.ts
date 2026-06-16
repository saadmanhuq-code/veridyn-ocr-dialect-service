import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { requireApiKey } from "./auth";

// process.env.NODE_ENV is typed as a read-only literal union; cast to a mutable
// record so tests can simulate dev / production / preview postures.
const env = process.env as Record<string, string | undefined>;

function setNodeEnv(value: string | undefined): void {
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

const OLD_KEY = "old-secret-key-aaaaaaaaaaaa";
const NEXT_KEY = "next-secret-key-bbbbbbbbbbbbbbbbbbbb"; // intentionally different length from OLD_KEY

function reqWith(token: string | null): Headers {
  return new Headers(token === null ? {} : { authorization: `Bearer ${token}` });
}

let savedKey: string | undefined;
let savedNext: string | undefined;
let savedNodeEnv: string | undefined;
let savedVercel: string | undefined;

beforeEach(() => {
  savedKey = process.env.VERIDYN_OCR_API_KEY;
  savedNext = process.env.VERIDYN_OCR_API_KEY_NEXT;
  savedNodeEnv = process.env.NODE_ENV;
  savedVercel = process.env.VERCEL;
  delete process.env.VERIDYN_OCR_API_KEY;
  delete process.env.VERIDYN_OCR_API_KEY_NEXT;
  // Default to the local-dev posture (not on Vercel, not a production build) so
  // the existing "no key configured" tests exercise the dev-only bypass.
  delete process.env.VERCEL;
  setNodeEnv("test");
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.VERIDYN_OCR_API_KEY;
  else process.env.VERIDYN_OCR_API_KEY = savedKey;
  if (savedNext === undefined) delete process.env.VERIDYN_OCR_API_KEY_NEXT;
  else process.env.VERIDYN_OCR_API_KEY_NEXT = savedNext;
  setNodeEnv(savedNodeEnv);
  if (savedVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = savedVercel;
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

test("both keys unset in local dev: auth is optional (allow-all)", () => {
  // beforeEach already sets the local-dev posture (no VERCEL, NODE_ENV=test).
  assert.equal(requireApiKey(reqWith(null)), null);
  assert.equal(requireApiKey(reqWith("anything")), null);
});

test("both keys unset on Vercel (deployed): FAILS CLOSED with 403", () => {
  process.env.VERCEL = "1"; // set on every Vercel deployment (prod and preview)
  const res = requireApiKey(reqWith(null));
  assert.notEqual(res, null);
  assert.equal(res!.status, 403);
});

test("both keys unset with NODE_ENV=production: FAILS CLOSED with 403", () => {
  setNodeEnv("production");
  const res = requireApiKey(reqWith("anything"));
  assert.notEqual(res, null);
  assert.equal(res!.status, 403);
});

test("both keys unset on Vercel preview (NODE_ENV=production): FAILS CLOSED", () => {
  // `next build` sets NODE_ENV=production on preview too, and preview URLs are
  // internet-reachable — they must require a key, never fail open.
  process.env.VERCEL = "1";
  setNodeEnv("production");
  const res = requireApiKey(reqWith(null));
  assert.notEqual(res, null);
  assert.equal(res!.status, 403);
});

test("key configured on Vercel: valid key still authorizes", () => {
  process.env.VERCEL = "1";
  setNodeEnv("production");
  process.env.VERIDYN_OCR_API_KEY = OLD_KEY;
  assert.equal(requireApiKey(reqWith(OLD_KEY)), null);
});

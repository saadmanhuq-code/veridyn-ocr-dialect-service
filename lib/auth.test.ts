import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { requireApiKey } from "./auth";

const OLD_KEY = "old-secret-key-aaaaaaaaaaaa";
const NEXT_KEY = "next-secret-key-bbbbbbbbbbbbbbbbbbbb"; // intentionally different length from OLD_KEY

function reqWith(token: string | null): Headers {
  return new Headers(token === null ? {} : { authorization: `Bearer ${token}` });
}

let savedKey: string | undefined;
let savedNext: string | undefined;

beforeEach(() => {
  savedKey = process.env.VERIDYN_OCR_API_KEY;
  savedNext = process.env.VERIDYN_OCR_API_KEY_NEXT;
  delete process.env.VERIDYN_OCR_API_KEY;
  delete process.env.VERIDYN_OCR_API_KEY_NEXT;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env.VERIDYN_OCR_API_KEY;
  else process.env.VERIDYN_OCR_API_KEY = savedKey;
  if (savedNext === undefined) delete process.env.VERIDYN_OCR_API_KEY_NEXT;
  else process.env.VERIDYN_OCR_API_KEY_NEXT = savedNext;
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

test("both keys unset: auth is optional (allow-all)", () => {
  assert.equal(requireApiKey(reqWith(null)), null);
  assert.equal(requireApiKey(reqWith("anything")), null);
});

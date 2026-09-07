import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  requireApiKey,
  resolveConsumer,
  parseConsumerKeys,
  withConsumerHeader,
  LEGACY_CONSUMER,
  CONSUMER_HEADER,
} from "./auth";

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
let savedAllowUnauthed: string | undefined;
let savedConsumerKeys: string | undefined;

beforeEach(() => {
  savedKey = process.env.VERIDYN_OCR_API_KEY;
  savedNext = process.env.VERIDYN_OCR_API_KEY_NEXT;
  savedNodeEnv = process.env.NODE_ENV;
  savedVercel = process.env.VERCEL;
  savedAllowUnauthed = process.env.VERIDYN_OCR_ALLOW_UNAUTHENTICATED;
  savedConsumerKeys = process.env.VERIDYN_OCR_CONSUMER_KEYS;
  delete process.env.VERIDYN_OCR_API_KEY;
  delete process.env.VERIDYN_OCR_API_KEY_NEXT;
  delete process.env.VERIDYN_OCR_CONSUMER_KEYS;
  // Default to the local-dev posture (not on Vercel, not a production build).
  // VERIDYN_OCR_ALLOW_UNAUTHENTICATED is NOT set by default — bypass now
  // requires explicit opt-in, so tests must set it where they need bypass behavior.
  delete process.env.VERCEL;
  delete process.env.VERIDYN_OCR_ALLOW_UNAUTHENTICATED;
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
  if (savedAllowUnauthed === undefined)
    delete process.env.VERIDYN_OCR_ALLOW_UNAUTHENTICATED;
  else
    process.env.VERIDYN_OCR_ALLOW_UNAUTHENTICATED = savedAllowUnauthed;
  if (savedConsumerKeys === undefined) delete process.env.VERIDYN_OCR_CONSUMER_KEYS;
  else process.env.VERIDYN_OCR_CONSUMER_KEYS = savedConsumerKeys;
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

// --- authBypassAllowed tests: explicit opt-in required (Fix 1) ---

test("no key + no flag + non-Vercel + non-prod: FAILS CLOSED with 403 (default fail-closed)", () => {
  // beforeEach sets non-Vercel + NODE_ENV=test but does NOT set the flag.
  // This is the key new assertion: without the explicit flag, every environment
  // fails closed even if not on Vercel and not a production build.
  const res = requireApiKey(reqWith(null));
  assert.notEqual(res, null);
  assert.equal(res!.status, 403);
});

test("no key + flag set + non-Vercel + non-prod: bypass allowed (explicit opt-in)", () => {
  // Developer has deliberately set VERIDYN_OCR_ALLOW_UNAUTHENTICATED=true on a
  // genuine local/non-Vercel/non-prod box — the only valid allow-all path.
  process.env.VERIDYN_OCR_ALLOW_UNAUTHENTICATED = "true";
  assert.equal(requireApiKey(reqWith(null)), null);
  assert.equal(requireApiKey(reqWith("anything")), null);
});

test("no key + flag set + VERCEL set: FAILS CLOSED with 403 (Vercel overrides flag)", () => {
  process.env.VERIDYN_OCR_ALLOW_UNAUTHENTICATED = "true";
  process.env.VERCEL = "1";
  const res = requireApiKey(reqWith(null));
  assert.notEqual(res, null);
  assert.equal(res!.status, 403);
});

test("no key + flag set + NODE_ENV=production: FAILS CLOSED with 403 (prod overrides flag)", () => {
  process.env.VERIDYN_OCR_ALLOW_UNAUTHENTICATED = "true";
  setNodeEnv("production");
  const res = requireApiKey(reqWith(null));
  assert.notEqual(res, null);
  assert.equal(res!.status, 403);
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

// --- Per-consumer credentials (lane #23) ---

const PROTEINCHAIN_KEY = "pc-consumer-key-aaaaaaaaaaaaaaaa";
const DATAROOM_KEY = "dr-consumer-key-bbbbbbbbbbbbbbbb";

test("parseConsumerKeys: parses the JSON object form", () => {
  const parsed = parseConsumerKeys(
    JSON.stringify({ proteinchain: PROTEINCHAIN_KEY, dataroom: DATAROOM_KEY }),
  );
  assert.equal(parsed.get("proteinchain"), PROTEINCHAIN_KEY);
  assert.equal(parsed.get("dataroom"), DATAROOM_KEY);
  assert.equal(parsed.size, 2);
});

test("parseConsumerKeys: parses the comma-separated name:key list form", () => {
  const parsed = parseConsumerKeys(
    `proteinchain:${PROTEINCHAIN_KEY},dataroom:${DATAROOM_KEY}`,
  );
  assert.equal(parsed.get("proteinchain"), PROTEINCHAIN_KEY);
  assert.equal(parsed.get("dataroom"), DATAROOM_KEY);
  assert.equal(parsed.size, 2);
});

test("parseConsumerKeys: unset/blank input yields an empty map, never throws", () => {
  assert.equal(parseConsumerKeys(undefined).size, 0);
  assert.equal(parseConsumerKeys(null).size, 0);
  assert.equal(parseConsumerKeys("").size, 0);
  assert.equal(parseConsumerKeys("   ").size, 0);
});

test("parseConsumerKeys: malformed entries are skipped individually, not fatal", () => {
  const parsed = parseConsumerKeys(`not-a-pair,proteinchain:${PROTEINCHAIN_KEY},:orphan-key`);
  assert.equal(parsed.get("proteinchain"), PROTEINCHAIN_KEY);
  assert.equal(parsed.size, 1);
});

test("two named consumers with distinct keys both authenticate", () => {
  process.env.VERIDYN_OCR_CONSUMER_KEYS = JSON.stringify({
    proteinchain: PROTEINCHAIN_KEY,
    dataroom: DATAROOM_KEY,
  });
  assert.equal(requireApiKey(reqWith(PROTEINCHAIN_KEY)), null);
  assert.equal(requireApiKey(reqWith(DATAROOM_KEY)), null);
});

test("two named consumers are attributed correctly via resolveConsumer", () => {
  process.env.VERIDYN_OCR_CONSUMER_KEYS = JSON.stringify({
    proteinchain: PROTEINCHAIN_KEY,
    dataroom: DATAROOM_KEY,
  });
  assert.equal(resolveConsumer(reqWith(PROTEINCHAIN_KEY)), "proteinchain");
  assert.equal(resolveConsumer(reqWith(DATAROOM_KEY)), "dataroom");
});

test("revoking one consumer's key rejects only that consumer, others unaffected", () => {
  process.env.VERIDYN_OCR_CONSUMER_KEYS = JSON.stringify({
    proteinchain: PROTEINCHAIN_KEY,
    dataroom: DATAROOM_KEY,
  });
  assert.equal(requireApiKey(reqWith(PROTEINCHAIN_KEY)), null);
  assert.equal(requireApiKey(reqWith(DATAROOM_KEY)), null);

  // Operator revokes "dataroom" by removing its entry — proteinchain is untouched.
  process.env.VERIDYN_OCR_CONSUMER_KEYS = JSON.stringify({
    proteinchain: PROTEINCHAIN_KEY,
  });

  assert.equal(requireApiKey(reqWith(PROTEINCHAIN_KEY)), null);
  const revoked = requireApiKey(reqWith(DATAROOM_KEY));
  assert.notEqual(revoked, null);
  assert.equal(revoked!.status, 401);
});

test("legacy shared key still works alongside named consumer keys during migration", () => {
  process.env.VERIDYN_OCR_API_KEY = OLD_KEY;
  process.env.VERIDYN_OCR_CONSUMER_KEYS = JSON.stringify({
    proteinchain: PROTEINCHAIN_KEY,
  });
  assert.equal(requireApiKey(reqWith(OLD_KEY)), null);
  assert.equal(resolveConsumer(reqWith(OLD_KEY)), LEGACY_CONSUMER);
  assert.equal(requireApiKey(reqWith(PROTEINCHAIN_KEY)), null);
  assert.equal(resolveConsumer(reqWith(PROTEINCHAIN_KEY)), "proteinchain");
});

test("no key or a wrong key is rejected even when consumer keys are configured", () => {
  process.env.VERIDYN_OCR_CONSUMER_KEYS = JSON.stringify({
    proteinchain: PROTEINCHAIN_KEY,
  });
  const missing = requireApiKey(reqWith(null));
  assert.notEqual(missing, null);
  assert.equal(missing!.status, 401);

  const wrong = requireApiKey(reqWith("totally-wrong-key"));
  assert.notEqual(wrong, null);
  assert.equal(wrong!.status, 401);
});

test("only named consumer keys configured (no legacy key): fail-closed check is satisfied", () => {
  // Configuring only VERIDYN_OCR_CONSUMER_KEYS (no legacy VERIDYN_OCR_API_KEY)
  // must not trip the "no credentials configured" 403 fail-closed path.
  process.env.VERIDYN_OCR_CONSUMER_KEYS = JSON.stringify({
    proteinchain: PROTEINCHAIN_KEY,
  });
  const res = requireApiKey(reqWith(PROTEINCHAIN_KEY));
  assert.equal(res, null);
});

test("resolveConsumer: null when no bearer token, null when no match, never throws", () => {
  assert.equal(resolveConsumer(reqWith(null)), null);
  process.env.VERIDYN_OCR_API_KEY = OLD_KEY;
  assert.equal(resolveConsumer(reqWith("something-else")), null);
});

test("withConsumerHeader: adds the attribution header only when a consumer is resolved", () => {
  const base = { "Content-Type": "application/json" };
  assert.equal(withConsumerHeader(base, "proteinchain")[CONSUMER_HEADER], "proteinchain");
  assert.equal(withConsumerHeader(base, null)[CONSUMER_HEADER], undefined);
  // Original object is not mutated.
  assert.equal(CONSUMER_HEADER in base, false);
});

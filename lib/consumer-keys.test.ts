import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { requireApiKey, resolveConsumer, withConsumerHeader, CONSUMER_HEADER } from "./auth";
import {
  LEGACY_CONSUMER,
  constantTimeEqual,
  logUsageEvent,
  matchConsumerKey,
  parseConsumerKeys,
} from "./consumer-keys";

const env = process.env as Record<string, string | undefined>;

const LEGACY_KEY = "legacy-secret-key-cccccccccccc";
const PC_KEY = "proteinchain-secret-dddddddddd";
const DR_KEY = "dataroom-secret-eeeeeeeeeeeeeeee";

function reqWith(token: string | null): Headers {
  return new Headers(token === null ? {} : { authorization: `Bearer ${token}` });
}

const TOUCHED = [
  "VERIDYN_OCR_API_KEY",
  "VERIDYN_OCR_API_KEY_NEXT",
  "VERIDYN_OCR_API_KEYS",
  "VERIDYN_OCR_CONSUMER_KEYS",
  "VERIDYN_OCR_ALLOW_UNAUTHENTICATED",
  "VERCEL",
  "NODE_ENV",
] as const;

let saved: Record<string, string | undefined> = {};
let savedWrite: typeof process.stdout.write;
let writes: string[];

beforeEach(() => {
  saved = {};
  for (const name of TOUCHED) saved[name] = env[name];
  delete env.VERIDYN_OCR_API_KEY;
  delete env.VERIDYN_OCR_API_KEY_NEXT;
  delete env.VERIDYN_OCR_API_KEYS;
  delete env.VERIDYN_OCR_CONSUMER_KEYS;
  delete env.VERIDYN_OCR_ALLOW_UNAUTHENTICATED;
  delete env.VERCEL;
  env.NODE_ENV = "test";
  // Capture usage lines so they don't pollute TAP output; assert on them too.
  writes = [];
  savedWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = savedWrite;
  for (const name of TOUCHED) {
    if (saved[name] === undefined) delete env[name];
    else env[name] = saved[name];
  }
});

// --- parseConsumerKeys ---

test("parseConsumerKeys: name:key list format", () => {
  const parsed = parseConsumerKeys(`proteinchain:${PC_KEY},dataroom:${DR_KEY}`);
  assert.equal(parsed.get("proteinchain"), PC_KEY);
  assert.equal(parsed.get("dataroom"), DR_KEY);
  assert.equal(parsed.size, 2);
});

test("parseConsumerKeys: JSON object format", () => {
  const parsed = parseConsumerKeys(JSON.stringify({ proteinchain: PC_KEY }));
  assert.equal(parsed.get("proteinchain"), PC_KEY);
});

test("parseConsumerKeys: malformed entries skipped, empty/nullish -> empty map", () => {
  assert.equal(parseConsumerKeys(null).size, 0);
  assert.equal(parseConsumerKeys(undefined).size, 0);
  assert.equal(parseConsumerKeys("   ").size, 0);
  const parsed = parseConsumerKeys(`no-colon-here,:no-name,proteinchain:${PC_KEY}`);
  assert.equal(parsed.size, 1);
  assert.equal(parsed.get("proteinchain"), PC_KEY);
});

test("constantTimeEqual: equal true, different (any length) false, never throws", () => {
  assert.equal(constantTimeEqual(PC_KEY, PC_KEY), true);
  assert.equal(constantTimeEqual(PC_KEY, DR_KEY), false);
  assert.equal(constantTimeEqual(PC_KEY, "x"), false);
});

// --- scoped accept / reject through requireApiKey ---

test("scoped key authorizes and attributes to its consumer name", () => {
  env.VERIDYN_OCR_API_KEYS = `proteinchain:${PC_KEY},dataroom:${DR_KEY}`;
  assert.equal(requireApiKey(reqWith(PC_KEY)), null);
  assert.equal(resolveConsumer(reqWith(PC_KEY)), "proteinchain");
  assert.equal(resolveConsumer(reqWith(DR_KEY)), "dataroom");
  assert.equal(matchConsumerKey(PC_KEY), "proteinchain");
});

test("alt env name VERIDYN_OCR_CONSUMER_KEYS also authorizes (merged)", () => {
  env.VERIDYN_OCR_CONSUMER_KEYS = `dataroom:${DR_KEY}`;
  assert.equal(requireApiKey(reqWith(DR_KEY)), null);
  assert.equal(resolveConsumer(reqWith(DR_KEY)), "dataroom");
});

test("VERIDYN_OCR_API_KEYS wins over alt env on same consumer name", () => {
  env.VERIDYN_OCR_CONSUMER_KEYS = `proteinchain:${DR_KEY}`;
  env.VERIDYN_OCR_API_KEYS = `proteinchain:${PC_KEY}`;
  assert.equal(requireApiKey(reqWith(PC_KEY)), null);
  const res = requireApiKey(reqWith(DR_KEY));
  assert.notEqual(res, null);
  assert.equal(res!.status, 401);
});

test("revoking one consumer (env edit) rejects only that consumer", () => {
  env.VERIDYN_OCR_API_KEYS = `proteinchain:${PC_KEY},dataroom:${DR_KEY}`;
  assert.equal(requireApiKey(reqWith(PC_KEY)), null);
  env.VERIDYN_OCR_API_KEYS = `dataroom:${DR_KEY}`;
  const res = requireApiKey(reqWith(PC_KEY));
  assert.notEqual(res, null);
  assert.equal(res!.status, 401);
  assert.equal(requireApiKey(reqWith(DR_KEY)), null);
});

test("wrong token with only scoped keys configured returns 401, no header attribution", () => {
  env.VERIDYN_OCR_API_KEYS = `proteinchain:${PC_KEY}`;
  const res = requireApiKey(reqWith("totally-wrong"));
  assert.notEqual(res, null);
  assert.equal(res!.status, 401);
  assert.equal(resolveConsumer(reqWith("totally-wrong")), null);
});

// --- legacy compatibility ---

test("legacy keys still work alongside scoped keys, attributed as legacy", () => {
  env.VERIDYN_OCR_API_KEY = LEGACY_KEY;
  env.VERIDYN_OCR_API_KEYS = `proteinchain:${PC_KEY}`;
  assert.equal(requireApiKey(reqWith(LEGACY_KEY)), null);
  assert.equal(resolveConsumer(reqWith(LEGACY_KEY)), LEGACY_CONSUMER);
  assert.equal(requireApiKey(reqWith(PC_KEY)), null);
});

test("withConsumerHeader adds x-veridyn-consumer only when resolved", () => {
  assert.deepEqual(withConsumerHeader({}, null), {});
  assert.deepEqual(withConsumerHeader({}, "proteinchain"), {
    [CONSUMER_HEADER]: "proteinchain",
  });
});

// --- fail-closed matrix unchanged ---

test("no credentials at all (legacy + scoped unset) still fails closed 403", () => {
  const res = requireApiKey(reqWith(null));
  assert.notEqual(res, null);
  assert.equal(res!.status, 403);
});

test("scoped keys configured but no token presented returns 401 (not bypass)", () => {
  env.VERIDYN_OCR_API_KEYS = `proteinchain:${PC_KEY}`;
  const res = requireApiKey(reqWith(null));
  assert.notEqual(res, null);
  assert.equal(res!.status, 401);
});

test("malformed scoped map does not open the gate (counts as unconfigured -> 403)", () => {
  env.VERIDYN_OCR_API_KEYS = "garbage-without-colons";
  const res = requireApiKey(reqWith("anything"));
  assert.notEqual(res, null);
  assert.equal(res!.status, 403);
});

// --- usage metering line ---

test("successful scoped auth emits a usage line with consumer, never the token", () => {
  env.VERIDYN_OCR_API_KEYS = `proteinchain:${PC_KEY}`;
  assert.equal(requireApiKey(reqWith(PC_KEY)), null);
  const line = writes.find((w) => w.includes("veridyn_ocr_usage"));
  assert.ok(line, "usage line emitted");
  const record = JSON.parse(line!) as Record<string, unknown>;
  assert.equal(record.schema_version, "usage_event.v1");
  assert.equal(record.consumer, "proteinchain");
  assert.equal(record.ok, true);
  assert.ok(!line!.includes(PC_KEY), "token must never appear in the usage line");
});

test("logUsageEvent lines carry no PII-shaped fields", () => {
  logUsageEvent({ consumer: null, ok: false });
  const record = JSON.parse(writes[writes.length - 1]) as Record<string, unknown>;
  assert.deepEqual(Object.keys(record).sort(), ["consumer", "event", "ok", "schema_version", "ts"]);
});

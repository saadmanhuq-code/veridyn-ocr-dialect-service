/**
 * Per-consumer credential + response-header attribution regression test
 * (finding #23). Drives the real /api/dialect/analyze route end-to-end
 * (not just the lib/auth.ts unit) to prove the full request path:
 *   - two named consumers, each with their own key, both authenticate and
 *     get `x-veridyn-consumer` set to their own name in the response;
 *   - revoking one consumer's key (removing its entry from
 *     VERIDYN_OCR_CONSUMER_KEYS) rejects only that consumer — the other
 *     keeps working, unaffected;
 *   - the legacy shared key keeps working during the migration window,
 *     attributed as "legacy";
 *   - a request with no key, or the wrong key, is rejected (401).
 */

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { POST } from "../app/api/dialect/analyze/route.js";
import { CONSUMER_HEADER, LEGACY_CONSUMER } from "@/lib/auth";

const PROTEINCHAIN_KEY = "route-level-proteinchain-key-aaaa";
const DATAROOM_KEY = "route-level-dataroom-key-bbbb";
const LEGACY_KEY = "route-level-legacy-key-cccc";

let savedConsumerKeys: string | undefined;
let savedApiKey: string | undefined;
let savedApiKeyNext: string | undefined;

beforeEach(() => {
  savedConsumerKeys = process.env.VERIDYN_OCR_CONSUMER_KEYS;
  savedApiKey = process.env.VERIDYN_OCR_API_KEY;
  savedApiKeyNext = process.env.VERIDYN_OCR_API_KEY_NEXT;
  delete process.env.VERIDYN_OCR_CONSUMER_KEYS;
  delete process.env.VERIDYN_OCR_API_KEY;
  delete process.env.VERIDYN_OCR_API_KEY_NEXT;
});

afterEach(() => {
  if (savedConsumerKeys === undefined) delete process.env.VERIDYN_OCR_CONSUMER_KEYS;
  else process.env.VERIDYN_OCR_CONSUMER_KEYS = savedConsumerKeys;
  if (savedApiKey === undefined) delete process.env.VERIDYN_OCR_API_KEY;
  else process.env.VERIDYN_OCR_API_KEY = savedApiKey;
  if (savedApiKeyNext === undefined) delete process.env.VERIDYN_OCR_API_KEY_NEXT;
  else process.env.VERIDYN_OCR_API_KEY_NEXT = savedApiKeyNext;
});

function postWith(token: string | null): NextRequest {
  return new NextRequest("http://localhost/api/dialect/analyze", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text: "" }),
  });
}

test("two named consumers both authenticate and are attributed via x-veridyn-consumer", async () => {
  process.env.VERIDYN_OCR_CONSUMER_KEYS = JSON.stringify({
    proteinchain: PROTEINCHAIN_KEY,
    dataroom: DATAROOM_KEY,
  });

  const pcRes = await POST(postWith(PROTEINCHAIN_KEY));
  assert.equal(pcRes.status, 200);
  assert.equal(pcRes.headers.get(CONSUMER_HEADER), "proteinchain");

  const drRes = await POST(postWith(DATAROOM_KEY));
  assert.equal(drRes.status, 200);
  assert.equal(drRes.headers.get(CONSUMER_HEADER), "dataroom");
});

test("revoking one consumer's key (live) rejects only that consumer", async () => {
  process.env.VERIDYN_OCR_CONSUMER_KEYS = JSON.stringify({
    proteinchain: PROTEINCHAIN_KEY,
    dataroom: DATAROOM_KEY,
  });
  assert.equal((await POST(postWith(PROTEINCHAIN_KEY))).status, 200);
  assert.equal((await POST(postWith(DATAROOM_KEY))).status, 200);

  // Operator revokes "dataroom" — the entry is removed, "proteinchain" is untouched.
  process.env.VERIDYN_OCR_CONSUMER_KEYS = JSON.stringify({
    proteinchain: PROTEINCHAIN_KEY,
  });

  const stillWorks = await POST(postWith(PROTEINCHAIN_KEY));
  assert.equal(stillWorks.status, 200);
  assert.equal(stillWorks.headers.get(CONSUMER_HEADER), "proteinchain");

  const revoked = await POST(postWith(DATAROOM_KEY));
  assert.equal(revoked.status, 401);
});

test("legacy shared key keeps working during the migration window, attributed as 'legacy'", async () => {
  process.env.VERIDYN_OCR_API_KEY = LEGACY_KEY;
  process.env.VERIDYN_OCR_CONSUMER_KEYS = JSON.stringify({
    proteinchain: PROTEINCHAIN_KEY,
  });

  const res = await POST(postWith(LEGACY_KEY));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get(CONSUMER_HEADER), LEGACY_CONSUMER);
});

test("no key or wrong key is rejected (401) even with consumer keys configured", async () => {
  process.env.VERIDYN_OCR_CONSUMER_KEYS = JSON.stringify({
    proteinchain: PROTEINCHAIN_KEY,
  });

  const noKey = await POST(postWith(null));
  assert.equal(noKey.status, 401);
  assert.equal(noKey.headers.get(CONSUMER_HEADER), null);

  const wrongKey = await POST(postWith("not-a-real-key"));
  assert.equal(wrongKey.status, 401);
  assert.equal(wrongKey.headers.get(CONSUMER_HEADER), null);
});

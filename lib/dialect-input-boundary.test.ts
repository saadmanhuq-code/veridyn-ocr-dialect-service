import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { POST as analyze } from "../app/api/dialect/analyze/route.js";
import { POST as phraseEval } from "../app/api/phrase-eval/route.js";

const key = "test-dialect-boundary-key";
const previousKey = process.env.VERIDYN_OCR_API_KEY;

before(() => { process.env.VERIDYN_OCR_API_KEY = key; });
after(() => {
  if (previousKey === undefined) delete process.env.VERIDYN_OCR_API_KEY;
  else process.env.VERIDYN_OCR_API_KEY = previousKey;
});

function request(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("dialect analyze rejects oversized text before inference", async () => {
  const response = await analyze(request("/api/dialect/analyze", { text: "ক".repeat(8193) }));
  assert.equal(response.status, 413);
  assert.match((await response.json()).detail, /8192/);
});

test("phrase evaluation rejects an aggregate oversized text batch", async () => {
  const response = await phraseEval(request("/api/phrase-eval", { phrases: Array(50).fill("ক".repeat(200)) }));
  assert.equal(response.status, 413);
  const body = await response.json();
  assert.match(body.detail, /8192/);
  assert.equal(body.results, undefined);
});

test("ordinary dialect text still returns a cue inference", async () => {
  const response = await analyze(request("/api/dialect/analyze", { text: "আমি বরিশালে থাকি" }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.schema_version, "dialect_cue.v1");
  assert.equal(body.input_characters, "আমি বরিশালে থাকি".length);
  assert.ok(body.evidence);
});
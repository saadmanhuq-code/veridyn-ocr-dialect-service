import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { NextRequest } from "next/server";

import { POST } from "../app/api/dialect/analyze/route";
import { inferDialectFromText } from "./dialect";

const TEST_KEY = "dialect-analyze-route-test-key";
const SYLHET_CHIP = "আমি সিলেটি ভাষায় কথা কই";

const savedEnv: Record<string, string | undefined> = {};

function analyzeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/dialect/analyze", {
    method: "POST",
    headers: {
      authorization: `Bearer ${TEST_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const key of ["VERIDYN_OCR_API_KEY", "VERIDYN_OCR_API_KEY_NEXT", "GOOGLE_SERVICE_ACCOUNT_JSON"]) {
    savedEnv[key] = process.env[key];
  }
  process.env.VERIDYN_OCR_API_KEY = TEST_KEY;
  delete process.env.VERIDYN_OCR_API_KEY_NEXT;
  // No Vertex in tests: the classifier path must degrade to the cue
  // matcher with typed `not_configured` metadata instead of throwing.
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("POST /api/dialect/analyze", () => {
  test("default path (no flag) is the historic cue-only result plus additive script_mix", async () => {
    const res = await POST(analyzeRequest({ text: SYLHET_CHIP }));
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      schema_version: string;
      input_characters: number;
      evidence: ReturnType<typeof inferDialectFromText>;
    };
    assert.equal(payload.schema_version, "dialect_cue.v1");
    assert.equal(payload.input_characters, SYLHET_CHIP.length);

    const cueOnly = inferDialectFromText(SYLHET_CHIP);
    assert.equal(payload.evidence.status, cueOnly.status);
    assert.equal(payload.evidence.dialect_label, cueOnly.dialect_label);
    assert.equal(payload.evidence.match_score, cueOnly.match_score);
    assert.equal(payload.evidence.method, "cue_match");
    assert.equal(payload.evidence.script_mix, "bn");
    assert.equal(payload.evidence.classifier_status, undefined);
  });

  test("use_classifier: true wires the classifier-primary resolver", async () => {
    const res = await POST(analyzeRequest({ text: SYLHET_CHIP, use_classifier: true }));
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      schema_version: string;
      evidence: ReturnType<typeof inferDialectFromText>;
    };
    assert.equal(payload.schema_version, "dialect_cue.v1");
    assert.equal(payload.evidence.classifier_status, "not_configured");
    assert.equal(payload.evidence.dialect_label, "sylhet");
    assert.equal(payload.evidence.script_mix, "bn");
    assert.equal(payload.evidence.detail?.classifier?.status, "not_configured");
  });

  test("non-boolean use_classifier values keep the default cue path", async () => {
    const res = await POST(analyzeRequest({ text: SYLHET_CHIP, use_classifier: "true" }));
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      evidence: ReturnType<typeof inferDialectFromText>;
    };
    assert.equal(payload.evidence.classifier_status, undefined);
    assert.equal(payload.evidence.dialect_label, "sylhet");
  });

  test("Banglish input resolves through the default path with script_mix banglish", async () => {
    const res = await POST(analyzeRequest({ text: "ami sylheti bhashay kotha koi" }));
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      evidence: ReturnType<typeof inferDialectFromText>;
    };
    assert.equal(payload.evidence.dialect_label, "sylhet");
    assert.equal(payload.evidence.script_mix, "banglish");
  });

  test("unauthenticated requests still fail closed", async () => {
    const req = new NextRequest("http://localhost/api/dialect/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: SYLHET_CHIP }),
    });
    const res = await POST(req);
    assert.equal(res.status, 401);
  });
});

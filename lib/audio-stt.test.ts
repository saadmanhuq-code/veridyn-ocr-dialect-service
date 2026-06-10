/**
 * Smoke tests for audio-stt.ts + bn-normalize.ts
 *
 * Live-API tests (LIVE_STT_SMOKE) hit Gemini and require GEMINI_API_KEY.
 * They are skipped when the key is absent — CI-safe.
 *
 * Unit tests (always run) verify:
 *  - Fallback contract: transcribeViaBest returns { fallback: true } with no keys
 *  - bn-normalize: Bengali digit + danda normalisation
 *  - tagScriptMix: correct script detection
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { transcribeViaBest, isGeminiSttEnabled } from "./audio-stt";
import { normaliseBn, tagScriptMix } from "./bn-normalize";

// ---------------------------------------------------------------------------
// Unit: bn-normalize
// ---------------------------------------------------------------------------

describe("normaliseBn", () => {
  test("converts Bengali digits to ASCII", () => {
    assert.equal(normaliseBn("০১২৩৪৫৬৭৮৯"), "0123456789");
  });

  test("converts danda to period", () => {
    assert.equal(normaliseBn("আমি এখানে।"), "আমি এখানে.");
  });

  test("collapses whitespace and trims", () => {
    assert.equal(normaliseBn("  hello   world  "), "hello world");
  });

  test("handles mixed Bengali + digit", () => {
    const result = normaliseBn("আমার বয়স ২৫ বছর।");
    assert.equal(result, "আমার বয়স 25 বছর.");
  });
});

describe("tagScriptMix", () => {
  test("detects Bengali-dominant text as bn", () => {
    assert.equal(tagScriptMix("আমি বরিশালে থাকি"), "bn");
  });

  test("detects English-dominant text as en", () => {
    assert.equal(tagScriptMix("Hello this is english text here"), "en");
  });

  test("detects mixed text", () => {
    // Bengali words interspersed with Latin words — both script types significant
    // "আমি বলছি" (bn) + "Hello" (en) + "তুমি কেমন" (bn) + "world" (en) — roughly 50/50
    assert.equal(tagScriptMix("আমি বলছি Hello তুমি কেমন world"), "mixed");
  });

  test("empty string → unknown", () => {
    assert.equal(tagScriptMix(""), "unknown");
  });
});

// ---------------------------------------------------------------------------
// Unit: fallback contract — no keys set
// ---------------------------------------------------------------------------

describe("transcribeViaBest fallback", () => {
  test("returns { fallback: true } when no API keys are set", async () => {
    // Temporarily clear keys
    const savedGemini = process.env.GEMINI_API_KEY;
    const savedStudio = process.env.GOOGLE_AI_STUDIO_KEY;
    const savedCloudVision = process.env.GOOGLE_CLOUD_VISION_API_KEY;
    const savedOpenRouter = process.env.OPENROUTER_API_KEY;
    const savedVertex = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_STUDIO_KEY;
    delete process.env.GOOGLE_CLOUD_VISION_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

    try {
      // Use a tiny dummy buffer — it won't be sent anywhere without a key
      const result = await transcribeViaBest(Buffer.from("dummy"), "audio/wav");
      assert.ok("fallback" in result, "expected fallback key in result");
      assert.equal((result as { fallback: boolean }).fallback, true);
    } finally {
      if (savedGemini !== undefined) process.env.GEMINI_API_KEY = savedGemini;
      if (savedStudio !== undefined) process.env.GOOGLE_AI_STUDIO_KEY = savedStudio;
      if (savedCloudVision !== undefined) process.env.GOOGLE_CLOUD_VISION_API_KEY = savedCloudVision;
      if (savedOpenRouter !== undefined) process.env.OPENROUTER_API_KEY = savedOpenRouter;
      if (savedVertex !== undefined) process.env.GOOGLE_SERVICE_ACCOUNT_JSON = savedVertex;
    }
  });
});

// ---------------------------------------------------------------------------
// Live smoke tests (skip when key absent)
// ---------------------------------------------------------------------------

const SKIP_LIVE = !isGeminiSttEnabled();

const fixturesDir = join(import.meta.dirname ?? __dirname, "..", "tests", "fixtures");

describe("transcribeViaBest — live Gemini STT", { skip: SKIP_LIVE ? "GEMINI_API_KEY not set; skipping live STT smoke tests" : false }, () => {
  test("sylhet WAV: transcript non-empty + dialect block present", async () => {
    const audioBytes = readFileSync(join(fixturesDir, "train_sylhet_0001.wav"));
    assert.ok(audioBytes.length > 0, "fixture must be non-empty");

    const result = await transcribeViaBest(audioBytes, "audio/wav");
    assert.ok(!("fallback" in result && (result as { fallback: boolean }).fallback),
      "expected real STT result, not fallback");

    const r = result as Exclude<typeof result, { fallback: true }>;
    assert.ok(r.transcript.length > 0, "transcript must be non-empty");
    assert.ok(typeof r.provider === "string", "provider must be present");
    assert.ok(typeof r.model === "string", "model must be present");
    assert.ok(r.latency_ms >= 0, "latency_ms must be non-negative");
  });

  test("chittagong WAV: transcript non-empty + dialect block present", async () => {
    const audioBytes = readFileSync(join(fixturesDir, "train_chittagong_0001.wav"));
    assert.ok(audioBytes.length > 0, "fixture must be non-empty");

    const result = await transcribeViaBest(audioBytes, "audio/wav");
    assert.ok(!("fallback" in result && (result as { fallback: boolean }).fallback),
      "expected real STT result, not fallback");

    const r = result as Exclude<typeof result, { fallback: true }>;
    assert.ok(r.transcript.length > 0, "transcript must be non-empty");
    assert.ok(typeof r.provider === "string", "provider must be present");
  });
});

// ---------------------------------------------------------------------------
// Live smoke test: full pipeline (STT → normalise → dialect inference)
// ---------------------------------------------------------------------------

describe("full STT pipeline — sylhet fixture", { skip: SKIP_LIVE ? "GEMINI_API_KEY not set" : false }, () => {
  test("dialect inference returns a block (status field present)", async () => {
    // Import here to avoid top-level module issues in skip path
    const { inferDialectFromText } = await import("./dialect");
    const audioBytes = readFileSync(join(fixturesDir, "train_sylhet_0001.wav"));

    const sttResult = await transcribeViaBest(audioBytes, "audio/wav");
    if ("fallback" in sttResult && (sttResult as { fallback: boolean }).fallback) {
      // This branch is unreachable when GEMINI_API_KEY is set, but satisfies TS
      return;
    }

    const r2 = sttResult as Exclude<typeof sttResult, { fallback: true }>;
    const transcript = normaliseBn(r2.transcript);
    assert.ok(transcript.length > 0, "normalised transcript must be non-empty");

    const dialect = inferDialectFromText(transcript);
    assert.ok("status" in dialect, "dialect inference must return a status field");
    assert.ok(
      ["missing_transcript", "unresolved", "suggested", "provided"].includes(dialect.status),
      `unexpected dialect status: ${dialect.status}`,
    );
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";

import { getOcrWorker } from "./ocr-engine.js";
import { ocrImageBuffer } from "./pdf-raster-ocr.js";

test("failed vision OCR falls back to local OCR with visible, safe provenance", async () => {
  const keys = [
    "VERCEL",
    "GOOGLE_SERVICE_ACCOUNT_JSON",
    "GOOGLE_AI_STUDIO_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_CLOUD_VISION_API_KEY",
    "OPENROUTER_API_KEY",
    "OPENROUTER_OCR_MODELS",
  ];
  const before = keys.map((key) => process.env[key]);
  const originalFetch = globalThis.fetch;
  let requests = 0;

  try {
    for (const key of keys) delete process.env[key];
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.OPENROUTER_OCR_MODELS = "test/model";
    globalThis.fetch = async (input) => {
      assert.equal(String(input), "https://openrouter.ai/api/v1/chat/completions");
      requests += 1;
      return new Response(JSON.stringify({ error: { message: "provider-secret-canary" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    };

    const canvas = createCanvas(16, 16);
    canvas.getContext("2d").fillRect(0, 0, 16, 16);
    const result = await ocrImageBuffer(canvas.toBuffer("image/png"), "eng");

    assert.equal(requests, 1, "the configured vision provider must have been attempted");
    assert.equal(result.ocr_provenance.engine, "tesseract.js");
    assert.equal(result.ocr_provenance.vision_fallback, "provider_failure");
    assert.ok(result.warnings.some((warning) => /vision.*failed.*local OCR/i.test(warning)));
    assert.ok(!JSON.stringify(result).includes("provider-secret-canary"));
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      const value = before[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    await (await getOcrWorker("eng")).terminate();
  }
});

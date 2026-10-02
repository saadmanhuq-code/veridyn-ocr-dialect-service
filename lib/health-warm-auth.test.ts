import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import tesseract, { type Worker } from "tesseract.js";

import { GET } from "../app/api/health/route.js";

const envNames = [
  "VERIDYN_OCR_API_KEY",
  "VERIDYN_OCR_API_KEY_NEXT",
  "VERIDYN_OCR_CONSUMER_KEYS",
  "VERIDYN_OCR_ALLOW_UNAUTHENTICATED",
  "OCR_CORS_ORIGINS",
  "VERCEL",
  "GOOGLE_AI_STUDIO_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_CLOUD_VISION_API_KEY",
  "OPENROUTER_API_KEY",
] as const;
const origin = "https://consumer.example";

async function withWarmEnvironment(run: () => Promise<void>) {
  const saved = envNames.map((name) => process.env[name]);
  for (const name of envNames) delete process.env[name];
  process.env.OCR_CORS_ORIGINS = origin;
  try {
    await run();
  } finally {
    envNames.forEach((name, index) => {
      const value = saved[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
}

function request(warm: boolean, authorization?: string) {
  return new NextRequest(`http://localhost/api/health${warm ? "?warm=ocr" : ""}`, {
    headers: { origin, ...(authorization ? { authorization } : {}) },
  });
}

test("public health stays available while missing or invalid warm credentials cannot initialize OCR", async () => {
  await withWarmEnvironment(async () => {
    process.env.VERIDYN_OCR_API_KEY = "warm-fixture";
    const worker = mock.method(tesseract, "createWorker", async () => {
      throw new Error("Unexpected OCR initialization");
    });
    try {
      const health = await GET(request(false));
      assert.equal(health.status, 200);
      assert.equal((await health.json()).ok, true);
      for (const authorization of [undefined, "Bearer wrong-fixture"]) {
        const denied = await GET(request(true, authorization));
        assert.equal(denied.status, 401);
        assert.deepEqual(await denied.json(), { detail: "Unauthorized" });
        assert.equal(denied.headers.get("access-control-allow-origin"), origin);
        assert.equal(denied.headers.get("vary"), "Origin");
        assert.equal(worker.mock.callCount(), 0);
      }
    } finally {
      worker.mock.restore();
    }
  });
});

test("warm requests fail closed when no API credentials are configured", async () => {
  await withWarmEnvironment(async () => {
    const worker = mock.method(tesseract, "createWorker", async () => {
      throw new Error("Unexpected OCR initialization");
    });
    try {
      assert.equal((await GET(request(false))).status, 200);
      const denied = await GET(request(true));
      assert.equal(denied.status, 403);
      assert.deepEqual(await denied.json(), { detail: "Forbidden: API key not configured." });
      assert.equal(denied.headers.get("access-control-allow-origin"), origin);
      assert.equal(worker.mock.callCount(), 0);
    } finally {
      worker.mock.restore();
    }
  });
});

test("authenticated warm requests initialize local OCR and accept rotation and consumer keys", async () => {
  await withWarmEnvironment(async () => {
    process.env.VERIDYN_OCR_API_KEY = "warm-fixture";
    const worker = mock.method(tesseract, "createWorker", async () => ({}) as Worker);
    try {
      const warmed = await GET(request(true, "Bearer warm-fixture"));
      assert.equal(warmed.status, 200);
      assert.equal((await warmed.json()).ocr_warm, "ready");
      assert.equal(worker.mock.callCount(), 1);

      process.env.VERCEL = "1";
      delete process.env.VERIDYN_OCR_API_KEY;
      process.env.VERIDYN_OCR_API_KEY_NEXT = "rotation-fixture";
      process.env.VERIDYN_OCR_CONSUMER_KEYS = JSON.stringify({ consumer: "consumer-fixture" });
      for (const token of ["rotation-fixture", "consumer-fixture"]) {
        const ready = await GET(request(true, `Bearer ${token}`));
        assert.equal(ready.status, 200);
        assert.equal((await ready.json()).ocr_warm, "vision_keys_required");
      }
      assert.equal(worker.mock.callCount(), 1);
    } finally {
      worker.mock.restore();
    }
  });
});

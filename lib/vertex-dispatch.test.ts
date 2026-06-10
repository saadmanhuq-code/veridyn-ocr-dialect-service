import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import { transcribeViaBest } from "./audio-stt";
import { analyzeImageIntent } from "./image-intent";
import { ocrImageViaBestVision } from "./vision-ocr";
import { clearVertexAuthTokenCache } from "./vertex-auth";

const envKeys = [
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_AI_STUDIO_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_CLOUD_VISION_API_KEY",
  "OPENROUTER_API_KEY",
  "VERTEX_PROJECT",
  "VERTEX_LOCATION",
  "VERTEX_MODEL",
] as const;

const savedEnv: Partial<Record<(typeof envKeys)[number], string>> = {};
let savedFetch: typeof globalThis.fetch;

function fakeServiceAccountJson(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return JSON.stringify({
    client_email: "vertex-dispatch@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  });
}

function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clearProviderEnv(): void {
  for (const key of envKeys) delete process.env[key];
}

function requireGeneratedBody(value: Record<string, unknown> | null): Record<string, unknown> {
  assert.ok(value, "expected Vertex generateContent request body to be captured");
  return value;
}

beforeEach(() => {
  for (const key of envKeys) savedEnv[key] = process.env[key];
  savedFetch = globalThis.fetch;
  clearProviderEnv();
  clearVertexAuthTokenCache();
});

afterEach(() => {
  clearProviderEnv();
  for (const key of envKeys) {
    if (savedEnv[key] !== undefined) process.env[key] = savedEnv[key];
  }
  globalThis.fetch = savedFetch;
  clearVertexAuthTokenCache();
});

describe("Vertex dispatcher priority", () => {
  test("transcribeViaBest uses Vertex before Gemini Studio when a service account is configured", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = fakeServiceAccountJson();
    process.env.GEMINI_API_KEY = "studio-key-that-should-not-be-used";

    const seenUrls: string[] = [];
    let generateBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (url, init) => {
      seenUrls.push(String(url));
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "vertex-token", expires_in: 3600, token_type: "Bearer" });
      }
      generateBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: "আমি সিলেটি বলি" }] }, finishReason: "STOP" }],
      });
    }) as typeof fetch;

    const result = await transcribeViaBest(Buffer.from("audio"), "audio/wav");

    assert.ok(!("fallback" in result), "expected a real STT result");
    assert.equal(result.provider, "vertex");
    assert.equal(result.model, "gemini-2.5-flash");
    assert.equal(result.transcript, "আমি সিলেটি বলি");
    assert.ok(result.latency_ms >= 0);
    assert.ok(seenUrls[1]?.includes("aiplatform.googleapis.com/v1/projects/gen-lang-client-0305450104/locations/global/publishers/google/models/gemini-2.5-flash:generateContent"));
    assert.equal(seenUrls.some((url) => url.includes("generativelanguage.googleapis.com")), false);

    const body = requireGeneratedBody(generateBody);
    const parts = ((body.contents as Array<Record<string, unknown>>)[0].parts) as Array<Record<string, unknown>>;
    assert.deepEqual(parts[1], {
      inline_data: { mime_type: "audio/wav", data: Buffer.from("audio").toString("base64") },
    });
  });

  test("ocrImageViaBestVision uses Vertex image inline_data before Gemini Studio", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = fakeServiceAccountJson();
    process.env.GEMINI_API_KEY = "studio-key-that-should-not-be-used";

    let generateBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (url, init) => {
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "vertex-token", expires_in: 3600, token_type: "Bearer" });
      }
      generateBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: "ট্রেড লাইসেন্স 123" }] }, finishReason: "STOP" }],
      });
    }) as typeof fetch;

    const result = await ocrImageViaBestVision(pngBytes(), "bn");

    assert.equal(result.engine, "vertex_vision");
    assert.equal(result.text, "ট্রেড লাইসেন্স 123");
    assert.ok(result.confidence > 0);
    const body = requireGeneratedBody(generateBody);
    const parts = ((body.contents as Array<Record<string, unknown>>)[0].parts) as Array<Record<string, unknown>>;
    assert.deepEqual(parts[1], {
      inline_data: { mime_type: "image/png", data: pngBytes().toString("base64") },
    });
  });

  test("analyzeImageIntent reports Vertex provenance when service account auth is available", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = fakeServiceAccountJson();
    process.env.GEMINI_API_KEY = "studio-key-that-should-not-be-used";

    globalThis.fetch = (async (url) => {
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "vertex-token", expires_in: 3600, token_type: "Bearer" });
      }
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    object_label: "trade licence",
                    scene: "document scan",
                    intent_guess: "extract document text",
                    text_in_image: "ট্রেড লাইসেন্স",
                    language: "bn",
                    category_hints: ["document"],
                    condition_hints: ["scan"],
                    confidence: 0.84,
                  }),
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
      });
    }) as typeof fetch;

    const result = await analyzeImageIntent(pngBytes());

    assert.ok(result);
    assert.equal(result.provenance.provider, "vertex");
    assert.equal(result.provenance.model, "gemini-2.5-flash");
    assert.equal(result.provenance.schema_version, "image_intent.v1");
  });
});

describe("dispatcher fallback without Vertex service account", () => {
  test("transcribeViaBest keeps the Gemini Studio path when service-account auth is absent", async () => {
    process.env.GEMINI_API_KEY = "studio-key";

    const seenUrls: string[] = [];
    globalThis.fetch = (async (url) => {
      seenUrls.push(String(url));
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: "studio transcript" }] }, finishReason: "STOP" }],
      });
    }) as typeof fetch;

    const result = await transcribeViaBest(Buffer.from("audio"), "audio/wav");

    assert.ok(!("fallback" in result), "expected Gemini Studio result");
    assert.equal(result.provider, "gemini");
    assert.equal(result.transcript, "studio transcript");
    assert.equal(seenUrls.some((url) => url.includes("oauth2.googleapis.com")), false);
    assert.equal(seenUrls[0]?.includes("generativelanguage.googleapis.com"), true);
  });

  test("transcribeViaBest still returns fallback true when no provider credentials are set", async () => {
    globalThis.fetch = (async () => {
      throw new Error("fetch should not be called without provider credentials");
    }) as typeof fetch;

    const result = await transcribeViaBest(Buffer.from("audio"), "audio/wav");

    assert.deepEqual(result, { fallback: true });
  });
});

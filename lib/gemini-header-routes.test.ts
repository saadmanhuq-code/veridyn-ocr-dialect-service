import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createCanvas } from "@napi-rs/canvas";

import { POST as transcribe } from "../app/api/voice/transcribe/route.js";
import { POST as imageIntent } from "../app/api/image-intent/route.js";
import { POST as documents } from "../app/api/documents/extract/route.js";

const providerKey = "header-fixture/+?=";
const bearer = "route-fixture";
const envNames = [
  "VERIDYN_OCR_API_KEY",
  "VERIDYN_OCR_API_KEY_NEXT",
  "VERIDYN_OCR_CONSUMER_KEYS",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_AI_STUDIO_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_CLOUD_VISION_API_KEY",
  "OPENROUTER_API_KEY",
  "VERIDYN_STT_MODEL",
  "GEMINI_OCR_MODEL",
  "VERIDYN_IMAGE_INTENT_MODEL",
  "VERCEL",
] as const;

interface ProviderRequest {
  url: string;
  method: string | undefined;
  headers: Headers;
  body: string;
}

async function withGemini(text: string, run: (requests: ProviderRequest[]) => Promise<void>) {
  const saved = envNames.map((name) => process.env[name]);
  const savedFetch = globalThis.fetch;
  const requests: ProviderRequest[] = [];
  for (const name of envNames) delete process.env[name];
  process.env.VERIDYN_OCR_API_KEY = bearer;
  process.env.GOOGLE_AI_STUDIO_KEY = providerKey;
  process.env.VERCEL = "1";
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), method: init?.method, headers: new Headers(init?.headers), body: String(init?.body) });
    return Response.json({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] });
  };
  try {
    await run(requests);
  } finally {
    globalThis.fetch = savedFetch;
    envNames.forEach((name, index) => {
      const value = saved[index];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
}

function assertHeaderAuthentication(requests: ProviderRequest[], mime: string) {
  assert.equal(requests.length, 1, "the route must reach the Gemini provider");
  const request = requests[0]!;
  const url = new URL(request.url);
  assert.equal(url.origin, "https://generativelanguage.googleapis.com");
  assert.equal(url.pathname, "/v1beta/models/gemini-2.0-flash:generateContent");
  assert.equal(request.headers.get("x-goog-api-key"), providerKey);
  assert.equal(url.search, "", "Gemini credentials must not appear in request URLs");
  assert.ok(!request.url.includes(providerKey));
  assert.ok(!request.url.includes(encodeURIComponent(providerKey)));
  assert.ok(!request.body.includes(providerKey));
  assert.equal(request.method, "POST");
  assert.equal(request.headers.get("content-type"), "application/json");
  const body = JSON.parse(request.body);
  assert.equal(body.contents[0].parts[1].inline_data.mime_type, mime);
  assert.ok(body.contents[0].parts[1].inline_data.data.length > 0);
}

function imageForm(field: string) {
  const png = createCanvas(16, 16).toBuffer("image/png");
  const form = new FormData();
  form.set(field, new File([new Uint8Array(png)], "sample.png", { type: "image/png" }));
  return form;
}

test("voice API sends the Gemini credential in a header and returns the transcript", async () => {
  await withGemini("আমি বাংলায় কথা বলি", async (requests) => {
    const response = await transcribe(new NextRequest("http://localhost/api/voice/transcribe", {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify({ audio_base64: Buffer.from("audio fixture").toString("base64"), mime_type: "audio/wav" }),
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.transcript_raw, "আমি বাংলায় কথা বলি");
    assert.equal(body.stt_provenance.provider, "gemini");
    assertHeaderAuthentication(requests, "audio/wav");
  });
});

test("image-intent API sends the Gemini credential in a header and returns the analysis", async () => {
  await withGemini(JSON.stringify({ object_label: "book", confidence: 0.9 }), async (requests) => {
    const response = await imageIntent(new NextRequest("http://localhost/api/image-intent", {
      method: "POST", headers: { authorization: `Bearer ${bearer}` }, body: imageForm("image"),
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.object_label, "book");
    assert.equal(body.provenance.provider, "gemini");
    assertHeaderAuthentication(requests, "image/png");
  });
});

test("document API sends the Gemini credential in a header and returns image OCR", async () => {
  await withGemini("48 hours weekly", async (requests) => {
    const response = await documents(new NextRequest("http://localhost/api/documents/extract", {
      method: "POST", headers: { authorization: `Bearer ${bearer}` }, body: imageForm("file"),
    }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.full_text_normalized, "48 hours weekly");
    assert.equal(body.ocr_provenance.engine, "gemini_vision");
    assertHeaderAuthentication(requests, "image/png");
  });
});

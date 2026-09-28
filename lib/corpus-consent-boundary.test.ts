import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

import { POST as imageIntent } from "../app/api/image-intent/route.js";
import { POST as transcribe } from "../app/api/voice/transcribe/route.js";
import { appendCorpusEvent } from "./corpus-log.js";

const key = "test-consent-boundary-key";
const envNames = [
  "VERIDYN_CORPUS_LOG",
  "VERIDYN_OCR_API_KEY",
  "GOOGLE_AI_STUDIO_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_CLOUD_VISION_API_KEY",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "OPENROUTER_API_KEY",
] as const;

async function withEnabledCorpus<T>(modelText: string, run: () => Promise<T>) {
  const saved = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const savedFetch = globalThis.fetch;
  const savedWrite = process.stdout.write;
  const writes: string[] = [];
  process.env.VERIDYN_CORPUS_LOG = "enabled";
  process.env.VERIDYN_OCR_API_KEY = key;
  process.env.GOOGLE_AI_STUDIO_KEY = "test-provider-key";
  for (const name of ["GEMINI_API_KEY", "GOOGLE_CLOUD_VISION_API_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON", "OPENROUTER_API_KEY"]) {
    delete process.env[name];
  }
  globalThis.fetch = (async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: modelText }] } }],
  }), { status: 200 })) as typeof fetch;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const value = await run();
    return { value, corpusWrites: writes.filter((line) => line.includes('"schema_version":"corpus_event.v1"')) };
  } finally {
    globalThis.fetch = savedFetch;
    process.stdout.write = savedWrite;
    for (const name of envNames) {
      const old = saved[name];
      if (old === undefined) delete process.env[name];
      else process.env[name] = old;
    }
  }
}

test("successful voice transcription does not persist a corpus event without user consent", async () => {
  const { value: response, corpusWrites } = await withEnabledCorpus("আফনের কিতা খবর?", () =>
    transcribe(new NextRequest("http://localhost/api/voice/transcribe", {
      method: "POST",
      headers: { authorization: "Bearer " + key, "content-type": "application/json" },
      body: JSON.stringify({ audio_base64: Buffer.from([1, 2, 3]).toString("base64"), mime_type: "audio/wav" }),
    })),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).transcript_raw, "আফনের কিতা খবর?");
  assert.deepEqual(corpusWrites, []);
});

test("successful image intent does not persist an image hash without user consent", async () => {
  const form = new FormData();
  form.set("image", new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "sample.png", { type: "image/png" }));
  const modelText = JSON.stringify({
    object_label: "document", scene: "paper", intent_guess: "read",
    text_in_image: "private", language: "en", category_hints: ["document"],
    condition_hints: [], confidence: 0.9,
  });
  const { value: response, corpusWrites } = await withEnabledCorpus(modelText, () =>
    imageIntent(new NextRequest("http://localhost/api/image-intent", {
      method: "POST",
      headers: { authorization: "Bearer " + key },
      body: form,
    })),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).object_label, "document");
  assert.deepEqual(corpusWrites, []);
});

test("corpus helper refuses an event without explicit consent", async () => {
  const { corpusWrites } = await withEnabledCorpus("unused", async () => {
    appendCorpusEvent({ event_type: "transcribe", transcript: "private", consent: false });
  });
  assert.deepEqual(corpusWrites, []);
});

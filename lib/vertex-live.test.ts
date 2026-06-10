import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { transcribeViaVertex } from "./audio-stt";
import { resolveDialectFromText } from "./dialect-classifier";
import { generateViaVertex } from "./vertex-gemini";

const SKIP_LIVE_VERTEX = !process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
const fixturesDir = join(import.meta.dirname ?? __dirname, "..", "tests", "fixtures");

describe(
  "Vertex live smoke",
  { skip: SKIP_LIVE_VERTEX ? "GOOGLE_SERVICE_ACCOUNT_JSON not set; skipping Vertex live smoke tests" : false },
  () => {
    test("text generateContent returns model text", async () => {
      const { data, model, latency_ms } = await generateViaVertex([
        { text: "Reply with exactly these two words: vertex ok" },
      ]);
      const text = (
        data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join(" ") ?? ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

      assert.equal(model, process.env.VERTEX_MODEL?.trim() || "gemini-2.5-flash");
      assert.ok(latency_ms >= 0, "latency_ms must be non-negative");
      assert.ok(text.includes("vertex ok"), `unexpected Vertex text response: ${text}`);
    });

    test("Bengali WAV transcription returns Vertex provenance fields", async () => {
      const audioBytes = readFileSync(join(fixturesDir, "train_sylhet_0001.wav"));
      const result = await transcribeViaVertex(audioBytes, "audio/wav");

      assert.equal(result.provider, "vertex");
      assert.equal(result.model, process.env.VERTEX_MODEL?.trim() || "gemini-2.5-flash");
      assert.ok(result.latency_ms >= 0, "latency_ms must be non-negative");
      assert.ok(result.transcript.length > 0, "transcript must be non-empty");
    });

    test("dialect classifier resolves drift Sylheti through Vertex, not cue fallback", async () => {
      const result = await resolveDialectFromText("আফনের কিতা খবর? আমি ভালা আছি, কাজকাম যাইতাছে.");

      assert.equal(result.classifier_status, "ok");
      assert.ok(
        result.method === "vertex_classifier" || result.method === "combined",
        `expected live classifier path, got ${result.method ?? "unknown"}`,
      );
      assert.notEqual(result.method, "cue_match");
      assert.notEqual(result.classifier_status, "parse_error");
      assert.notEqual(result.classifier_status, "provider_error");
    });
  },
);

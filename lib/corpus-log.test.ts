import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { appendCorpusEvent, dialectCorpusFields, parseConsent } from "./corpus-log";
import type { DialectInference } from "./dialect";

const savedCorpusLog = process.env.VERIDYN_CORPUS_LOG;
let savedWrite: typeof process.stdout.write;

beforeEach(() => {
  savedWrite = process.stdout.write;
  process.env.VERIDYN_CORPUS_LOG = "enabled";
});

afterEach(() => {
  process.stdout.write = savedWrite;
  if (savedCorpusLog === undefined) {
    delete process.env.VERIDYN_CORPUS_LOG;
  } else {
    process.env.VERIDYN_CORPUS_LOG = savedCorpusLog;
  }
});

describe("corpus log dialect provenance", () => {
  test("maps resolver provenance into additive corpus fields", () => {
    const dialect: DialectInference = {
      status: "suggested",
      source: "combined",
      dialect_label: "sylhet",
      speaker_region: "Sylhet",
      match_score: 0.8,
      candidate_label: "Vertex classifier Sylhet",
      candidate_dialect_label: "sylhet",
      method: "combined",
      confidence: 0.8,
      classifier_confidence: 0.72,
      classifier_dialect: "sylhet",
      classifier_status: "ok",
      resolve_threshold: 0.72,
    };

    assert.deepEqual(dialectCorpusFields(dialect), {
      dialect_label: "sylhet",
      dialect_match_score: 0.8,
      method: "combined",
      classifier_status: "ok",
      classifier_confidence: 0.72,
    });
  });

  test("appendCorpusEvent persists classifier method, status, and raw confidence", () => {
    const writes: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    appendCorpusEvent({
      event_type: "transcribe",
      transcript: "আফনের কিতা খবর?",
      language: "bn",
      dialect_label: "sylhet",
      dialect_match_score: 0.8,
      method: "combined",
      classifier_status: "ok",
      classifier_confidence: 0.72,
      consent: true,
    });

    assert.equal(writes.length, 1);
    const record = JSON.parse(writes[0]) as Record<string, unknown>;
    assert.equal(record.method, "combined");
    assert.equal(record.classifier_status, "ok");
    assert.equal(record.classifier_confidence, 0.72);
  });
});

describe("corpus log consent gate (W4)", () => {
  function capture(): string[] {
    const writes: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    return writes;
  }

  // Merged gate: main's consent stop (lib/corpus-consent-boundary.test.ts)
  // is stricter than the integrated strip-on-emit behaviour — without
  // explicit consent NO event is emitted, not even aggregate metadata.
  // The strip in appendCorpusEvent remains as defense in depth.
  test("consent false emits no corpus event at all (merged consent stop)", () => {
    const writes = capture();
    appendCorpusEvent({
      event_type: "transcribe",
      audio_sha256: "deadbeef".repeat(8),
      transcript: "আফনের কিতা খবর?",
      language: "bn",
      dialect_label: "sylhet",
      consent: false,
    });
    assert.equal(writes.length, 0, "no corpus event may be persisted without consent");
  });

  test("consent omitted defaults to false and emits no corpus event", () => {
    const writes = capture();
    appendCorpusEvent({
      event_type: "image_intent",
      image_sha256: "cafe".repeat(16),
      intent_category: "receipt",
    });
    assert.equal(writes.length, 0, "no corpus event may be persisted by default");
  });

  test("consent true retains persistence-shaped fields", () => {
    const writes = capture();
    appendCorpusEvent({
      event_type: "transcribe",
      audio_sha256: "deadbeef".repeat(8),
      transcript: "আফনের কিতা খবর?",
      consent: true,
    });
    const record = JSON.parse(writes[0]) as Record<string, unknown>;
    assert.equal(record.consent, true);
    assert.equal(record.transcript, "আফনের কিতা খবর?");
    assert.equal(record.audio_sha256, "deadbeef".repeat(8));
  });

  test("parseConsent: only an explicit affirmative counts", () => {
    assert.equal(parseConsent(true), true);
    assert.equal(parseConsent("true"), true);
    assert.equal(parseConsent(" TRUE "), true);
    assert.equal(parseConsent("1"), true);
    assert.equal(parseConsent("yes"), true);
    assert.equal(parseConsent(false), false);
    assert.equal(parseConsent("false"), false);
    assert.equal(parseConsent(""), false);
    assert.equal(parseConsent(undefined), false);
    assert.equal(parseConsent(null), false);
    assert.equal(parseConsent(1), false, "numbers are not consent (JSON must send boolean)");
    assert.equal(parseConsent(0), false);
  });
});

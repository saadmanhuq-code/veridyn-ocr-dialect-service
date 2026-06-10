import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { appendCorpusEvent, dialectCorpusFields } from "./corpus-log";
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

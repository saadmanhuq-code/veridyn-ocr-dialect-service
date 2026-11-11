/**
 * Offline self-tests for the eval harness: scoring logic, regression
 * thresholds, gold-set integrity, and fixture generation. No network.
 *
 * Run: node --test tests/eval/scoring.test.mjs
 * (Deliberately outside `npm test`, which runs lib/** only; this file keeps
 * the harness honest without making unit CI depend on a deployment.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  normalizeForCompare,
  tokenF1,
  scoreDialectEntries,
  scoreOcrEntry,
  scoreSttEntry,
  checkSttShape,
  summarizeLatency,
  evaluateThresholds,
} from "./scoring.mjs";
import { fixtureForEntry, renderPng } from "./generate-fixtures.mjs";

const GOLD = join(dirname(fileURLToPath(import.meta.url)), "gold");
const dialectGold = JSON.parse(readFileSync(join(GOLD, "dialect-gold.json"), "utf8"));
const ocrGold = JSON.parse(readFileSync(join(GOLD, "ocr-gold.json"), "utf8"));
const sttGold = JSON.parse(readFileSync(join(GOLD, "stt-gold.json"), "utf8"));

test("normalizeForCompare folds Bengali digits and whitespace", () => {
  assert.equal(normalizeForCompare("মোট  টাকা\n৫০০০"), "মোট টাকা 5000");
  assert.equal(normalizeForCompare("  Invoice   No 1042 "), "Invoice No 1042");
});

test("tokenF1: exact=1, disjoint=0, punctuation token lowers but does not zero", () => {
  assert.equal(tokenF1("a b c", "a b c"), 1);
  assert.equal(tokenF1("a b", "x y"), 0);
  assert.equal(tokenF1("", "a"), 0);
  const partial = tokenF1("Invoice No 1042", "Invoice No: 1042");
  assert.ok(partial > 0.5 && partial < 1, `partial=${partial}`);
});

test("dialect gold: >=3 gate phrases per catalog label + banglish/english negatives", () => {
  const labels = ["sylhet", "barishal", "chittagong", "noakhali", "rangpur", "sandwip", "dhaka", "rajshahi", "khulna", "mymensingh", "cumilla"];
  for (const label of labels) {
    const n = dialectGold.entries.filter((e) => e.gate && e.expected_dialect_label === label).length;
    assert.ok(n >= 3, `${label} has only ${n} gate entries`);
  }
  for (const script of ["banglish", "en"]) {
    const negs = dialectGold.entries.filter(
      (e) => e.gate && e.script === script && e.expected_status === "unresolved" && e.expected_dialect_label === null,
    );
    assert.ok(negs.length >= 3, `${script} negatives: ${negs.length}`);
  }
  const ids = dialectGold.entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "gold ids must be unique");
});

test("dialect gold baselines agree with expectations on gate entries", () => {
  // Baselines were measured against the real matcher (see gold header). A gate
  // entry whose baseline disagrees with its expectation would fail every live
  // run by construction — catch that here, offline.
  for (const e of dialectGold.entries.filter((x) => x.gate)) {
    assert.equal(e.baseline.status, e.expected_status, `${e.id} baseline status`);
    assert.equal(e.baseline.dialect_label, e.expected_dialect_label, `${e.id} baseline label`);
  }
});

test("scoreDialectEntries: per-label accuracy, probes reported not gated", () => {
  const entries = [
    { id: "a", gate: true, expected_status: "suggested", expected_dialect_label: "sylhet" },
    { id: "b", gate: true, expected_status: "suggested", expected_dialect_label: "sylhet" },
    { id: "c", gate: true, expected_status: "unresolved", expected_dialect_label: null, script: "en" },
    { id: "p", gate: false, expected_status: "suggested", expected_dialect_label: "dhaka" },
  ];
  const evidence = new Map([
    ["a", { status: "suggested", dialect_label: "sylhet", match_score: 1 }],
    ["b", { status: "unresolved", dialect_label: null, match_score: 0.3 }],
    ["c", { status: "unresolved", dialect_label: null, match_score: 0.1 }],
    ["p", { status: "unresolved", dialect_label: null, match_score: 0.2 }],
  ]);
  const scored = scoreDialectEntries(entries, evidence);
  assert.equal(scored.gate_passed, 2);
  assert.equal(scored.gate_total, 3);
  assert.equal(scored.probe_matched, 0);
  assert.equal(scored.per_label.find((r) => r.label === "sylhet").accuracy, 0.5);
  const failures = evaluateThresholds({ dialect: scored });
  assert.ok(failures.some((f) => f.includes("dialect gate accuracy")), failures.join());
  assert.ok(failures.some((f) => f.includes('"sylhet"')), failures.join());
});

test("scoreDialectEntries: missing evidence is a failure, not a skip", () => {
  const scored = scoreDialectEntries(
    [{ id: "x", gate: true, expected_status: "suggested", expected_dialect_label: "dhaka" }],
    new Map(),
  );
  assert.equal(scored.gate_passed, 0);
});

test("scoreOcrEntry: txt exact gate uses service normalisation", () => {
  const entry = ocrGold.entries.find((e) => e.id === "txt-bn-intro");
  const ok = scoreOcrEntry(entry, { full_text_normalized: entry.expected_full_text_normalized });
  assert.equal(ok.pass, true);
  const bad = scoreOcrEntry(entry, { full_text_normalized: "আমার নাম রফিক।" });
  assert.equal(bad.pass, false);
  assert.equal(bad.metric, "exact");
});

test("scoreOcrEntry: png token-F1 gate at 0.9 tolerates one token drift in nine", () => {
  const entry = ocrGold.entries.find((e) => e.id === "png-en-print");
  assert.equal(scoreOcrEntry(entry, { full_text_normalized: entry.expected_text }).pass, true);
  assert.equal(scoreOcrEntry(entry, { full_text_normalized: "Invoice No 1042 Total 5000" }).pass, false);
  assert.equal(scoreOcrEntry(entry, { full_text_normalized: "" }).pass, false);
});

test("STT shape: fallback contract and required success fields", () => {
  assert.deepEqual(checkSttShape({ fallback: true }), ["fallback:true (no STT vendor served the request)"]);
  const good = {
    fallback: false,
    transcript_raw: "আমি",
    transcript_bn: "আমি",
    dialect: { status: "unresolved" },
    stt_provenance: { provider: "vertex", model: "m", latency_ms: 1 },
  };
  assert.deepEqual(checkSttShape(good), []);
  const entry = sttGold.entries[0];
  assert.equal(scoreSttEntry(entry, good).pass, true);
  assert.equal(scoreSttEntry(entry, { fallback: true }).pass, false);
  const downgraded = scoreSttEntry(entry, { fallback: true }, { allowFallback: true });
  assert.equal(downgraded.pass, true);
  assert.equal(downgraded.downgraded, true);
});

test("STT gold transcript scoring only applies when a transcript is committed", () => {
  const entry = { id: "t", gold_transcript: "আমি ঢাকায় থাকি", dialect_label_hint: "dhaka" };
  const okPayload = {
    fallback: false, transcript_raw: "আমি ঢাকায় থাকি", transcript_bn: "আমি ঢাকায় থাকি",
    dialect: { status: "suggested" }, stt_provenance: { provider: "p", model: "m" },
  };
  assert.equal(scoreSttEntry(entry, okPayload).pass, true);
  assert.equal(scoreSttEntry(entry, { ...okPayload, transcript_bn: "সম্পূর্ণ আলাদা বাক্য এখানে" }).pass, false);
});

test("summarizeLatency groups per route", () => {
  const rows = summarizeLatency([
    { route: "/api/health", ms: 10 }, { route: "/api/health", ms: 30 }, { route: "/x", ms: 5 },
  ]);
  assert.deepEqual(rows.find((r) => r.route === "/api/health"), { route: "/api/health", count: 2, avg_ms: 20, max_ms: 30 });
});

test("evaluateThresholds: clean summary passes, each suite can fail it", () => {
  assert.deepEqual(evaluateThresholds({ health: { pass: true } }), []);
  assert.ok(evaluateThresholds({ health: { pass: false, problem: "down" } }).length === 1);
  assert.ok(evaluateThresholds({ negatives: { total: 2, passed: 1, results: [{ id: "n", pass: false, expected: [401], observed: 200 }] } }).length >= 1);
  assert.ok(evaluateThresholds({ ocr: { results: [{ id: "o", kind: "png", metric: "token_f1", score: 0.1, gate: true, pass: false }] } }).length === 1);
});

test("fixture generator emits real PNG/PDF bytes for every ocr gold kind", async () => {
  const png = renderPng(["Invoice No 1042"]);
  assert.equal(png.subarray(0, 4).toString("hex"), "89504e47"); // PNG magic
  for (const entry of ocrGold.entries) {
    const { bytes, mime } = await fixtureForEntry(entry);
    assert.ok(bytes.length > (entry.kind === "txt" ? 10 : 200), `${entry.id} bytes=${bytes.length}`);
    if (mime === "application/pdf") assert.equal(bytes.subarray(0, 4).toString(), "%PDF", entry.id);
    if (entry.kind === "txt") assert.equal(bytes.toString("utf8"), entry.content);
  }
});

test("gold files carry the documented schema versions", () => {
  assert.equal(dialectGold.schema_version, "dialect_gold.v1");
  assert.equal(ocrGold.schema_version, "ocr_gold.v1");
  assert.equal(sttGold.schema_version, "stt_gold.v1");
});

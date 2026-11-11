/**
 * Live eval runner for veridyn-ocr-dialect-service (W6).
 *
 * Runs the committed gold sets (tests/eval/gold/*.json) against a deployed
 * base URL and fails loudly (exit 1) when a regression threshold is crossed.
 * Exit 2 = configuration/usage error. Exit 0 = all gates passed.
 *
 * Env (secrets are read, never printed):
 *   EVAL_BASE_URL           e.g. https://veridyn-ocr-dialect-service.vercel.app
 *                           (falls back to SMOKE_BASE, the scripts/smoke.mjs var)
 *   VERIDYN_OCR_API_KEY     bearer key for the protected routes
 *                           (EVAL_API_KEY accepted as an alias)
 *   EVAL_DIALECT_GATE_MIN   default 1.0   EVAL_OCR_TOKEN_F1_MIN  default 0.9
 *   EVAL_STT_TOKEN_F1_MIN   default 0.6   EVAL_STT_ALLOW_FALLBACK=1 downgrades
 *                           an STT {fallback:true} to a reported warning
 *   EVAL_TIMEOUT_MS         default 65000 (service maxDuration is 60s)
 *
 * Flags:
 *   --suite health|dialect|ocr|stt|negatives|all   (default all, repeatable comma list)
 *   --dry-run     print the planned checks from the gold files; no network
 *   --output f    also write the JSON report to f
 *
 * What it covers: per-label dialect gate accuracy (phrase-eval + one
 * dialect/analyze spot check), OCR exact/token-F1 on generated fixtures,
 * STT shape smoke on tests/fixtures wavs, negative paths (auth fail-closed,
 * malformed bodies), and per-route latency. See docs/EVAL.md.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  scoreDialectEntries,
  scoreOcrEntry,
  scoreSttEntry,
  summarizeLatency,
  evaluateThresholds,
} from "../tests/eval/scoring.mjs";
import { fixtureForEntry, bengaliFontRegistered, registerBengaliFont } from "../tests/eval/generate-fixtures.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GOLD_DIR = join(REPO_ROOT, "tests/eval/gold");

const BASE = (process.env.EVAL_BASE_URL || process.env.SMOKE_BASE || "").replace(/\/$/, "");
const API_KEY = process.env.EVAL_API_KEY || process.env.VERIDYN_OCR_API_KEY || "";
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS || 65000);
const THRESHOLDS = {
  dialectGateMin: Number(process.env.EVAL_DIALECT_GATE_MIN || 1.0),
  ocrTokenF1Min: Number(process.env.EVAL_OCR_TOKEN_F1_MIN || 0.9),
};
const STT_TOKEN_F1_MIN = Number(process.env.EVAL_STT_TOKEN_F1_MIN || 0.6);
const STT_ALLOW_FALLBACK = process.env.EVAL_STT_ALLOW_FALLBACK === "1";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const suiteArg = args[args.indexOf("--suite") + 1] && args.includes("--suite") ? args[args.indexOf("--suite") + 1] : "all";
const suites = new Set(suiteArg.split(",").map((s) => s.trim()).filter(Boolean));
const want = (name) => suites.has("all") || suites.has(name);
const outputPath = args.includes("--output") ? args[args.indexOf("--output") + 1] : null;

const loadGold = (name) => JSON.parse(readFileSync(join(GOLD_DIR, name), "utf8"));
const dialectGold = loadGold("dialect-gold.json");
const ocrGold = loadGold("ocr-gold.json");
const sttGold = loadGold("stt-gold.json");

const latency = [];
const timed = async (route, fn) => {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    latency.push({ route, ms: performance.now() - t0 });
  }
};

async function call(route, init = {}, { auth = true } = {}) {
  const headers = { ...(init.headers || {}) };
  if (auth && API_KEY) headers.Authorization = `Bearer ${API_KEY}`;
  const res = await timed(route, () =>
    fetch(`${BASE}${route}`, { ...init, headers, signal: AbortSignal.timeout(TIMEOUT_MS) }),
  );
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body: reported via status */ }
  return { status: res.status, json, text: text.slice(0, 500) };
}

const jsonPost = (route, body, opts) =>
  call(route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, opts);

async function runHealth() {
  const { status, json } = await call("/api/health", {}, { auth: false });
  const problem =
    status !== 200 ? `expected 200, got ${status}` :
    json?.ok !== true ? "health payload ok !== true" : null;
  return { pass: !problem, problem, status, runtime_sha: json?.runtime_sha ?? null, contract_version: json?.contract_version ?? null };
}

async function runDialect() {
  const entries = dialectGold.entries;
  const evidenceById = new Map();
  // phrase-eval accepts up to 50 phrases per call (route MAX_PHRASES).
  for (let i = 0; i < entries.length; i += 50) {
    const batch = entries.slice(i, i + 50);
    const { status, json } = await jsonPost("/api/phrase-eval", { phrases: batch.map((e) => e.text) });
    if (status !== 200 || !Array.isArray(json?.results)) {
      throw new Error(`phrase-eval returned HTTP ${status} without results[]`);
    }
    batch.forEach((entry, j) => evidenceById.set(entry.id, json.results[j]?.evidence));
  }
  const scored = scoreDialectEntries(entries, evidenceById);
  // Spot-check the sibling route returns the same evidence shape + verdict.
  const spot = entries.find((e) => e.id === "sylhet-catalog-short") ?? entries[0];
  const { status, json } = await jsonPost("/api/dialect/analyze", { text: spot.text });
  scored.analyze_spot_check = {
    id: spot.id,
    status,
    schema_version: json?.schema_version ?? null,
    matches_phrase_eval:
      json?.evidence?.status === evidenceById.get(spot.id)?.status &&
      (json?.evidence?.dialect_label ?? null) === (evidenceById.get(spot.id)?.dialect_label ?? null),
  };
  return scored;
}

async function runOcr() {
  registerBengaliFont();
  const results = [];
  for (const entry of ocrGold.entries) {
    const { bytes, mime } = await fixtureForEntry(entry);
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: mime }), entry.file_name);
    const { status, json, text } = await call("/api/documents/extract", { method: "POST", body: form });
    if (status !== 200) {
      results.push({ id: entry.id, kind: entry.kind, gate: Boolean(entry.gate), metric: "http", score: 0, pass: false, http_status: status, detail: text.slice(0, 200) });
      continue;
    }
    results.push({ ...scoreOcrEntry(entry, json, { tokenF1Min: THRESHOLDS.ocrTokenF1Min }), http_status: status });
  }
  return { results, bengali_font_registered: bengaliFontRegistered() };
}

async function runStt() {
  const results = [];
  for (const entry of sttGold.entries) {
    const path = join(REPO_ROOT, entry.file);
    if (!existsSync(path)) {
      results.push({ id: entry.id, hint: entry.dialect_label_hint ?? null, fallback: false, score: null, problems: [`fixture missing: ${entry.file}`], pass: false, downgraded: false });
      continue;
    }
    const form = new FormData();
    form.set("audio", new Blob([readFileSync(path)], { type: entry.mime_type }), entry.file.split("/").pop());
    form.set("product", "eval-harness");
    const { status, json, text } = await call("/api/voice/transcribe", { method: "POST", body: form });
    if (status !== 200) {
      results.push({ id: entry.id, hint: entry.dialect_label_hint ?? null, fallback: false, score: null, problems: [`HTTP ${status}: ${text.slice(0, 200)}`], pass: false, downgraded: false });
      continue;
    }
    results.push(scoreSttEntry(entry, json, { tokenF1Min: STT_TOKEN_F1_MIN, allowFallback: STT_ALLOW_FALLBACK }));
  }
  return { results };
}

async function runNegatives() {
  // 401 = key configured, wrong/missing bearer; 403 = no key configured on the
  // deployment (fail-closed). Both prove the route did not serve the request.
  const checks = [
    { id: "dialect-no-key", expected: [401, 403], run: () => jsonPost("/api/dialect/analyze", { text: "test" }, { auth: false }) },
    { id: "dialect-wrong-key", expected: [401, 403], run: () => call("/api/dialect/analyze", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer eval-harness-wrong-key" }, body: JSON.stringify({ text: "test" }) }, { auth: false }) },
    { id: "extract-no-key", expected: [401, 403], run: () => call("/api/documents/extract", { method: "POST", body: new FormData() }, { auth: false }) },
    // A revoked per-consumer key is behaviorally a wrong key: 401, never served.
    { id: "extract-revoked-or-wrong-key", expected: [401, 403], run: () => call("/api/documents/extract", { method: "POST", headers: { Authorization: "Bearer [REDACTED]" }, body: new FormData() }, { auth: false }) },
    { id: "voice-no-key", expected: [401, 403], run: () => call("/api/voice/transcribe", { method: "POST", body: new FormData() }, { auth: false }) },
    { id: "phrase-eval-empty-body", expected: [400], run: () => jsonPost("/api/phrase-eval", {}) },
    { id: "phrase-eval-too-many", expected: [400], run: () => jsonPost("/api/phrase-eval", { phrases: Array(51).fill("x") }) },
    { id: "extract-missing-file", expected: [400], run: () => call("/api/documents/extract", { method: "POST", body: new FormData() }) },
    { id: "voice-bad-mime", expected: [415], run: () => jsonPost("/api/voice/transcribe", { audio_base64: Buffer.from("x").toString("base64"), mime_type: "text/plain" }) },
    { id: "voice-missing-audio-json", expected: [400], run: () => jsonPost("/api/voice/transcribe", { mime_type: "audio/wav" }) },
  ];
  const results = [];
  for (const check of checks) {
    const { status } = await check.run();
    results.push({ id: check.id, expected: check.expected, observed: status, pass: check.expected.includes(status) });
  }
  return { results, total: results.length, passed: results.filter((r) => r.pass).length };
}

function printReport(report, failures, partial = false) {
  const line = (s = "") => console.log(s);
  line(`eval target: ${BASE}  (api key: ${API_KEY ? "set" : "UNSET"})`);
  if (report.health) line(`health: ${report.health.pass ? "PASS" : "FAIL " + report.health.problem} runtime_sha=${report.health.runtime_sha ?? "null"} contract=${report.health.contract_version ?? "?"}`);
  if (report.dialect) {
    const d = report.dialect;
    line(`\ndialect gate: ${d.gate_passed}/${d.gate_total} (accuracy ${d.gate_accuracy.toFixed(3)}, threshold ${THRESHOLDS.dialectGateMin})`);
    for (const row of d.per_label) line(`  ${row.label.padEnd(12)} ${row.passed}/${row.total}  ${row.accuracy.toFixed(3)}`);
    line(`  probes (reported, never gated): ${d.probe_matched}/${d.probe_total} already match truth`);
    for (const r of d.results.filter((x) => x.gate && !x.pass)) {
      line(`  FAIL ${r.id}: expected ${r.expected_status}/${r.expected_dialect_label}, got ${r.observed?.status}/${r.observed?.dialect_label} (score ${r.observed?.match_score})`);
    }
    line(`  dialect/analyze spot check: ${d.analyze_spot_check.matches_phrase_eval ? "matches phrase-eval" : "MISMATCH"} (schema ${d.analyze_spot_check.schema_version})`);
  }
  if (report.ocr) {
    line(`\nocr (bengali font registered: ${report.ocr.bengali_font_registered}):`);
    for (const r of report.ocr.results) line(`  ${r.pass ? "PASS" : "FAIL"} ${r.id} ${r.kind}/${r.metric} score=${Number(r.score).toFixed(3)}${r.detail ? " " + r.detail : ""}`);
  }
  if (report.stt) {
    line(`\nstt smoke (hints are unverified file-name labels):`);
    for (const r of report.stt.results) line(`  ${r.pass ? "PASS" : "FAIL"} ${r.id} hint=${r.hint}${r.downgraded ? " fallback allowed by env" : ""}${r.problems.length ? " — " + r.problems.join("; ") : ""}`);
  }
  if (report.negatives) {
    line(`\nnegative paths: ${report.negatives.passed}/${report.negatives.total}`);
    for (const r of report.negatives.results.filter((x) => !x.pass)) line(`  FAIL ${r.id}: expected ${r.expected.join("|")}, got ${r.observed}`);
  }
  line(`\nlatency per route:`);
  for (const row of report.latency) line(`  ${row.route.padEnd(28)} n=${row.count} avg=${row.avg_ms}ms max=${row.max_ms}ms`);
  // A subset run must never read as a full pass (critic must-fix).
  line(
    failures.length
      ? `\nEVAL FAILED (${failures.length}):\n- ${failures.join("\n- ")}`
      : partial
        ? `\nEVAL PARTIAL — selected suites passed; unrun suites were NOT evaluated`
        : `\nEVAL PASSED`,
  );
}

async function main() {
  if (dryRun) {
    console.log("planned checks (no network):");
    console.log(`  health: GET /api/health`);
    console.log(`  dialect: ${dialectGold.entries.length} gold entries (${dialectGold.entries.filter((e) => e.gate).length} gate) via /api/phrase-eval + /api/dialect/analyze spot check`);
    console.log(`  ocr: ${ocrGold.entries.length} gold entries via /api/documents/extract (fixtures generated in-memory)`);
    console.log(`  stt: ${sttGold.entries.length} wav fixtures via /api/voice/transcribe`);
    console.log(`  negatives: 10 auth/malformed checks`);
    return;
  }
  if (!BASE) {
    console.error("EVAL_BASE_URL (or SMOKE_BASE) is not set. See docs/EVAL.md. Use --dry-run to list planned checks offline.");
    process.exit(2);
  }
  if (!API_KEY) {
    console.error("VERIDYN_OCR_API_KEY (or EVAL_API_KEY) is not set; protected routes will 401. See docs/EVAL.md.");
    process.exit(2);
  }

  const report = { base: BASE, thresholds: THRESHOLDS };
  if (want("health")) report.health = await runHealth();
  if (want("dialect")) report.dialect = await runDialect();
  if (want("ocr")) report.ocr = await runOcr();
  if (want("stt")) report.stt = await runStt();
  if (want("negatives")) report.negatives = await runNegatives();
  report.latency = summarizeLatency(latency);

  const failures = evaluateThresholds(report, THRESHOLDS);
  if (report.dialect && !report.dialect.analyze_spot_check.matches_phrase_eval) {
    failures.push("dialect/analyze spot check disagrees with phrase-eval evidence");
  }
  report.failures = failures;
  const partial = !suites.has("all");
  report.partial = partial;
  report.suites_run = ["health", "dialect", "ocr", "stt", "negatives"].filter((s) => report[s]);
  printReport(report, failures, partial);
  if (outputPath) writeFileSync(outputPath, JSON.stringify(report, null, 2));
  // exitCode (not process.exit): hard-exiting with fetch sockets still
  // closing trips a libuv assertion on Windows and mangles the code.
  if (failures.length) process.exitCode = 1;
}

main().catch((e) => {
  // Configuration errors exit 2 inside main() before any suite runs. Anything
  // reaching here is a live-eval failure (e.g. a route 500), not a usage
  // error — report it as FAILED with exit 1 (critic must-fix).
  console.error(`EVAL FAILED (runner error): ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

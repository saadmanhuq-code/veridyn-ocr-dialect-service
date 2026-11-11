/**
 * Pure scoring logic for the W6 eval harness.
 *
 * No network, no env, no file I/O: `scripts/eval-live.mjs` feeds it API
 * responses, `tests/eval/scoring.test.mjs` feeds it fabricated ones, so the
 * regression gates are unit-testable offline (npm test stays network-free).
 *
 * Honesty rules carried over from the service:
 *  - Dialect evidence is candidate evidence only. A "pass" means the cue
 *    matcher reproduced the gold expectation, not that a dialect was verified.
 *  - Probe entries (gate:false) record true labels the current catalog cannot
 *    resolve yet. They are reported, never failed.
 *  - STT fixture file-name hints are unverified labels, never accuracy truth.
 */

const BENGALI_DIGITS = new Map([
  ["০", "0"], ["১", "1"], ["২", "2"], ["৩", "3"], ["৪", "4"],
  ["৫", "5"], ["৬", "6"], ["৭", "7"], ["৮", "8"], ["৯", "9"],
]);

/** Mirror of the service normalisation relevant to gold comparison. */
export function normalizeForCompare(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[০-৯]/gu, (ch) => BENGALI_DIGITS.get(ch) ?? ch);
}

function tokens(text) {
  return [...new Set(normalizeForCompare(text).split(/\s+/u).filter(Boolean))];
}

/** Set-based token F1 — same definition as lib/dialect.ts tokenF1. */
export function tokenF1(expected, observed) {
  const exp = tokens(expected);
  const obs = tokens(observed);
  if (!exp.length || !obs.length) return 0;
  const obsSet = new Set(obs);
  let overlap = 0;
  for (const tok of exp) if (obsSet.has(tok)) overlap++;
  if (!overlap) return 0;
  const precision = overlap / obs.length;
  const recall = overlap / exp.length;
  return (2 * precision * recall) / (precision + recall);
}

/**
 * Score dialect gold entries against phrase-eval-style evidence objects
 * (DialectInference: { status, dialect_label, match_score }).
 * `evidenceById` maps gold entry id -> evidence (or undefined if missing).
 */
export function scoreDialectEntries(entries, evidenceById) {
  const results = entries.map((entry) => {
    const ev = evidenceById.get(entry.id);
    const observed = ev
      ? { status: ev.status ?? null, dialect_label: ev.dialect_label ?? null, match_score: ev.match_score ?? null }
      : null;
    const pass = Boolean(
      ev &&
      ev.status === entry.expected_status &&
      (ev.dialect_label ?? null) === (entry.expected_dialect_label ?? null),
    );
    return {
      id: entry.id,
      gate: Boolean(entry.gate),
      label: entry.expected_dialect_label ?? "(none)",
      script: entry.script ?? null,
      tier: entry.tier ?? null,
      expected_status: entry.expected_status,
      expected_dialect_label: entry.expected_dialect_label ?? null,
      observed,
      pass,
    };
  });

  const byLabel = new Map();
  for (const r of results.filter((x) => x.gate)) {
    const agg = byLabel.get(r.label) ?? { label: r.label, total: 0, passed: 0 };
    agg.total++;
    if (r.pass) agg.passed++;
    byLabel.set(r.label, agg);
  }
  for (const agg of byLabel.values()) agg.accuracy = agg.total ? agg.passed / agg.total : 0;

  const gate = results.filter((x) => x.gate);
  const probes = results.filter((x) => !x.gate);
  return {
    results,
    per_label: [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label)),
    gate_total: gate.length,
    gate_passed: gate.filter((x) => x.pass).length,
    gate_accuracy: gate.length ? gate.filter((x) => x.pass).length / gate.length : 0,
    probe_total: probes.length,
    probe_matched: probes.filter((x) => x.pass).length,
  };
}

/**
 * Score one OCR gold entry against an /api/documents/extract payload.
 * txt entries are an exact-match gate on full_text_normalized; png/pdf
 * entries are a token-F1 gate (engine punctuation/spacing legitimately vary).
 */
export function scoreOcrEntry(entry, payload, { tokenF1Min = 0.9 } = {}) {
  const observedText = payload?.full_text_normalized ?? payload?.text_preview ?? "";
  const base = {
    id: entry.id,
    kind: entry.kind,
    gate: Boolean(entry.gate),
    observed_chars: String(observedText).length,
    extractable: payload?.extractable ?? null,
  };
  // Additive structural checks (integration): page count for multi-page PDF
  // gold and bd_extract.v1 schema detection, when the entry declares them.
  const problems = [];
  if (typeof entry.expected_pages === "number") {
    const observedPages = Array.isArray(payload?.pages) ? payload.pages.length : null;
    if (observedPages !== entry.expected_pages) {
      problems.push(`pages: expected ${entry.expected_pages}, got ${observedPages}`);
    }
  }
  if (Array.isArray(entry.expected_schemas)) {
    const observed = new Set((payload?.structured_fields?.extractions ?? []).map((e) => e.schema));
    for (const schema of entry.expected_schemas) {
      if (!observed.has(schema)) problems.push(`structured_fields missing schema ${schema}`);
    }
  }
  const detail = problems.length ? problems.join("; ") : undefined;
  if (entry.kind === "txt") {
    const exact = normalizeForCompare(observedText) === normalizeForCompare(entry.expected_full_text_normalized);
    return { ...base, metric: "exact", score: exact ? 1 : 0, pass: exact && !problems.length, detail };
  }
  const score = tokenF1(entry.expected_text, observedText);
  return { ...base, metric: "token_f1", score, pass: score >= tokenF1Min && !problems.length, detail };
}

/** Shape contract for a /api/voice/transcribe success payload (see route docblock). */
export function checkSttShape(payload) {
  const problems = [];
  if (!payload || typeof payload !== "object") return ["payload is not an object"];
  if (payload.fallback === true) return ["fallback:true (no STT vendor served the request)"];
  if (payload.fallback !== false) problems.push("fallback must be false on success");
  if (typeof payload.transcript_bn !== "string" || !payload.transcript_bn.trim()) {
    problems.push("transcript_bn missing or empty");
  }
  if (typeof payload.transcript_raw !== "string") problems.push("transcript_raw missing");
  if (!payload.dialect || typeof payload.dialect !== "object" || typeof payload.dialect.status !== "string") {
    problems.push("dialect evidence missing (expected DialectInference with status)");
  }
  if (!payload.stt_provenance?.provider || !payload.stt_provenance?.model) {
    problems.push("stt_provenance.provider/model missing");
  }
  return problems;
}

export function scoreSttEntry(entry, payload, { tokenF1Min = 0.6, allowFallback = false } = {}) {
  const problems = checkSttShape(payload);
  const isFallback = payload?.fallback === true;
  let score = null;
  if (entry.gold_transcript) {
    score = tokenF1(entry.gold_transcript, payload?.transcript_bn ?? "");
    if (!isFallback && score < tokenF1Min) problems.push(`transcript token-F1 ${score.toFixed(3)} < ${tokenF1Min}`);
  }
  return {
    id: entry.id,
    hint: entry.dialect_label_hint ?? null, // unverified file-name hint, reported only
    fallback: isFallback,
    score,
    problems,
    // Fallback is a gate failure unless the operator explicitly allows it
    // (e.g. preview without vendor keys) — then it is reported, not hidden.
    pass: problems.length === 0 || (allowFallback && isFallback && problems.every((p) => p.startsWith("fallback:true"))),
    downgraded: Boolean(allowFallback && isFallback),
  };
}

/** Latency rollup per route from [{ route, ms }] samples. */
export function summarizeLatency(samples) {
  const byRoute = new Map();
  for (const s of samples) {
    const arr = byRoute.get(s.route) ?? [];
    arr.push(s.ms);
    byRoute.set(s.route, arr);
  }
  return [...byRoute.entries()]
    .map(([route, arr]) => ({
      route,
      count: arr.length,
      avg_ms: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
      max_ms: Math.round(Math.max(...arr)),
    }))
    .sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * Apply regression thresholds to suite summaries. Returns failure strings;
 * empty array = run passes. Defaults are the W6 design thresholds and are
 * env-overridable in the runner (see docs/EVAL.md).
 */
export function evaluateThresholds(summary, thresholds = {}) {
  const t = {
    dialectGateMin: 1.0,
    ocrTxtExactMin: 1.0,
    ocrTokenF1Min: 0.9,
    negativesMin: 1.0,
    ...thresholds,
  };
  const failures = [];
  if (summary.dialect) {
    if (summary.dialect.gate_accuracy < t.dialectGateMin) {
      failures.push(
        `dialect gate accuracy ${summary.dialect.gate_accuracy.toFixed(3)} < ${t.dialectGateMin} ` +
          `(${summary.dialect.gate_passed}/${summary.dialect.gate_total})`,
      );
    }
    for (const row of summary.dialect.per_label) {
      if (row.accuracy < t.dialectGateMin) {
        failures.push(`dialect label "${row.label}" accuracy ${row.accuracy.toFixed(3)} < ${t.dialectGateMin} (${row.passed}/${row.total})`);
      }
    }
  }
  if (summary.ocr) {
    for (const r of summary.ocr.results.filter((x) => x.gate && !x.pass)) {
      failures.push(`ocr ${r.id} (${r.kind}/${r.metric}) score ${Number(r.score).toFixed(3)} failed its gate`);
    }
  }
  if (summary.stt) {
    for (const r of summary.stt.results.filter((x) => !x.pass)) {
      failures.push(`stt ${r.id}: ${r.problems.join("; ")}`);
    }
  }
  if (summary.negatives) {
    const acc = summary.negatives.total ? summary.negatives.passed / summary.negatives.total : 0;
    if (acc < t.negativesMin) {
      failures.push(`negative-path checks ${summary.negatives.passed}/${summary.negatives.total} < ${t.negativesMin}`);
    }
    for (const r of summary.negatives.results.filter((x) => !x.pass)) {
      failures.push(`negative ${r.id}: expected HTTP ${r.expected.join("|")}, got ${r.observed}`);
    }
  }
  if (summary.health && !summary.health.pass) failures.push(`health: ${summary.health.problem}`);
  return failures;
}

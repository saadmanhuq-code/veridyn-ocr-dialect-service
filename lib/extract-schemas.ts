/**
 * Deterministic structured field extraction for Bangladeshi documents (W2).
 *
 * Pure, regex-only extractors over OCR/text-layer text. Everything produced
 * here is a *candidate* for human review: `verification_status` is always
 * "candidate_only" and `review_required` is always true. Pattern matches —
 * including MRZ check-digit and NID/DOB consistency checks — are structural
 * signals, never proof that a document or identity is genuine.
 *
 * Source spans are [start, end) string indices into the ORIGINAL input text.
 * Bengali digits are normalised with a length-preserving substitution (same
 * map as lib/bn-normalize.ts) instead of `normaliseBn`, whose whitespace
 * collapse would invalidate span offsets.
 */

export const EXTRACT_SCHEMA_VERSION = "bd_extract.v1" as const;

export type ExtractSchemaName = "bd_nid" | "bd_trade_licence" | "bd_passport" | "generic_invoice";

export interface SourceSpan {
  start: number;
  end: number;
}

export interface ExtractedField {
  field: string;
  /** Normalised value (ASCII digits, ISO dates, E.164-ish phones, decimal-string amounts). */
  value: string;
  /** Exact slice of the original input text the value came from. */
  raw: string;
  span: SourceSpan;
  /** Label text that anchored the match, when one did. */
  source_label: string | null;
  pattern_strength: "labelled" | "unlabelled";
  verification_status: "candidate_only";
}

export interface ValidationNote {
  code: string;
  field: string | null;
  status: "pass" | "fail" | "not_applicable" | "missing";
  detail: string;
}

export interface SchemaExtraction {
  schema: ExtractSchemaName;
  schema_version: typeof EXTRACT_SCHEMA_VERSION;
  fields: ExtractedField[];
  validations: ValidationNote[];
  review_required: true;
}

export interface StructuredExtractionResult {
  schema_version: typeof EXTRACT_SCHEMA_VERSION;
  review_required: true;
  verification_status: "candidate_only";
  extractions: SchemaExtraction[];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const BN_DIGITS: Record<string, string> = {
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
  "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};

/** Length-preserving Bengali-digit → ASCII substitution (keeps span offsets valid). */
export function asciiDigitsPreservingLength(text: string): string {
  return text.replace(/[০-৯]/g, (ch) => BN_DIGITS[ch] ?? ch);
}

type IndexedMatch = RegExpExecArray & { indices?: Array<[number, number] | undefined> };

function groupSpan(match: RegExpExecArray, group: number): SourceSpan {
  const indexed = (match as IndexedMatch).indices?.[group];
  if (indexed) return { start: indexed[0], end: indexed[1] };
  const value = match[group] ?? "";
  const at = match[0].indexOf(value);
  const start = match.index + (at >= 0 ? at : 0);
  return { start, end: start + value.length };
}

function makeField(
  original: string,
  field: string,
  value: string,
  span: SourceSpan,
  sourceLabel: string | null,
  patternStrength: "labelled" | "unlabelled",
): ExtractedField {
  return {
    field,
    value,
    raw: original.slice(span.start, span.end),
    span,
    source_label: sourceLabel,
    pattern_strength: patternStrength,
    verification_status: "candidate_only",
  };
}

function baseExtraction(schema: ExtractSchemaName): SchemaExtraction {
  return { schema, schema_version: EXTRACT_SCHEMA_VERSION, fields: [], validations: [], review_required: true };
}

/**
 * Find `label` then capture with `valuePattern` within a bounded window after it.
 * Returns the capture-group-1 span/value of the first labelled hit, or null.
 */
function labelledCapture(
  text: string,
  labelPattern: RegExp,
  valuePattern: RegExp,
  windowChars = 80,
): { value: string; span: SourceSpan; label: string } | null {
  const labelRe = new RegExp(labelPattern.source, labelPattern.flags.includes("g") ? labelPattern.flags : `${labelPattern.flags}g`);
  for (let m = labelRe.exec(text); m; m = labelRe.exec(text)) {
    const from = m.index + m[0].length;
    const window = text.slice(from, from + windowChars);
    const valueRe = new RegExp(valuePattern.source, valuePattern.flags.includes("d") ? valuePattern.flags : `${valuePattern.flags}d`);
    const vm = valueRe.exec(window);
    if (vm && vm[1] !== undefined) {
      const rel = groupSpan(vm, 1);
      // Ignore leading separator-only drift: capture must start near the label.
      return { value: vm[1], span: { start: from + rel.start, end: from + rel.end }, label: m[0].trim() };
    }
  }
  return null;
}

/** Capture the remainder of the line after a label (names, businesses). */
function labelledLineValue(
  text: string,
  labelPattern: RegExp,
): { value: string; span: SourceSpan; label: string } | null {
  const hit = labelledCapture(text, labelPattern, /^[\s:\-–—।]*([^\n\r]{2,90})/, 120);
  if (!hit) return null;
  let value = hit.value;
  // OCR columns often join the next field with wide spacing; cut there.
  const columnCut = value.search(/\s{3,}/);
  if (columnCut > 0) value = value.slice(0, columnCut);
  value = value.replace(/[\s,;।]+$/u, "").trim();
  if (value.length < 2) return null;
  return { value, span: { start: hit.span.start, end: hit.span.start + value.length }, label: hit.label };
}

// ---------------------------------------------------------------------------
// Dates (English + Bengali labels/digits/month names; BD day-first default)
// ---------------------------------------------------------------------------

const EN_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const BN_MONTHS: Array<[string, number]> = [
  ["জানুয়ারি", 1], ["জানুয়ারী", 1], ["ফেব্রুয়ারি", 2], ["ফেব্রুয়ারী", 2],
  ["মার্চ", 3], ["এপ্রিল", 4], ["মে", 5], ["জুন", 6], ["জুলাই", 7],
  ["আগস্ট", 8], ["সেপ্টেম্বর", 9], ["অক্টোবর", 10], ["নভেম্বর", 11], ["ডিসেম্বর", 12],
];

function expandYear(twoOrFour: string): number {
  const n = Number(twoOrFour);
  if (twoOrFour.length === 4) return n;
  return n <= 69 ? 2000 + n : 1900 + n;
}

function toIsoDate(day: number, month: number, year: number): string | null {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > daysInMonth) return null;
  const p = (v: number) => String(v).padStart(2, "0");
  return `${year}-${p(month)}-${p(day)}`;
}

export interface DateHit {
  iso: string;
  span: SourceSpan;
}

const NUMERIC_DATE_PATTERNS: Array<{
  re: RegExp;
  toIso: (m: RegExpExecArray) => string | null;
}> = [
  {
    // ISO: 1990-01-12 / 1990/01/12
    re: /(?<![0-9])([0-9]{4})[-/]([0-9]{1,2})[-/]([0-9]{1,2})(?![0-9])/gd,
    toIso: (m) => toIsoDate(Number(m[3]), Number(m[2]), Number(m[1])),
  },
  {
    // BD day-first: 12/01/1990, 12-01-1990, 12.01.1990, 5/3/95
    re: /(?<![0-9])([0-9]{1,2})[-/.]([0-9]{1,2})[-/.]([0-9]{4}|[0-9]{2})(?![0-9])/gd,
    toIso: (m) => toIsoDate(Number(m[1]), Number(m[2]), expandYear(m[3])),
  },
  {
    // 12 Jan 1990 / 12 January 1990
    re: /(?<![0-9])([0-9]{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+([0-9]{4})(?![0-9])/gid,
    toIso: (m) => {
      const month = EN_MONTHS[m[2].slice(0, 4).toLowerCase()] ?? EN_MONTHS[m[2].slice(0, 3).toLowerCase()];
      return month ? toIsoDate(Number(m[1]), month, Number(m[3])) : null;
    },
  },
  {
    // January 12, 1990
    re: /\b([A-Za-z]{3,9})\.?\s+([0-9]{1,2})(?:st|nd|rd|th)?,?\s+([0-9]{4})(?![0-9])/gid,
    toIso: (m) => {
      const month = EN_MONTHS[m[1].slice(0, 4).toLowerCase()] ?? EN_MONTHS[m[1].slice(0, 3).toLowerCase()];
      return month ? toIsoDate(Number(m[2]), month, Number(m[3])) : null;
    },
  },
];

/** All calendar-valid dates in digit-normalised text, in order, non-overlapping. */
export function findDates(normalized: string): DateHit[] {
  const hits: DateHit[] = [];
  const occupied: Array<[number, number]> = [];
  const overlaps = (s: number, e: number) => occupied.some(([a, b]) => s < b && a < e);

  for (const { re, toIso } of NUMERIC_DATE_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(normalized); m; m = re.exec(normalized)) {
      const iso = toIso(m);
      if (!iso) continue;
      const end = m.index + m[0].length;
      if (overlaps(m.index, end)) continue;
      occupied.push([m.index, end]);
      hits.push({ iso, span: { start: m.index, end } });
    }
  }

  // Bengali month names: ৫ মার্চ ১৯৯৫ (digits already ASCII-normalised here).
  for (const [name, month] of BN_MONTHS) {
    const re = new RegExp(`(?<![0-9])([0-9]{1,2})\\s+${name}\\s+([0-9]{4})(?![0-9])`, "gd");
    for (let m = re.exec(normalized); m; m = re.exec(normalized)) {
      const iso = toIsoDate(Number(m[1]), month, Number(m[2]));
      if (!iso) continue;
      const end = m.index + m[0].length;
      if (overlaps(m.index, end)) continue;
      occupied.push([m.index, end]);
      hits.push({ iso, span: { start: m.index, end } });
    }
  }

  return hits.sort((a, b) => a.span.start - b.span.start);
}

function labelledDate(
  original: string,
  normalized: string,
  field: string,
  labelPattern: RegExp,
): ExtractedField | null {
  const labelRe = new RegExp(labelPattern.source, labelPattern.flags.includes("g") ? labelPattern.flags : `${labelPattern.flags}g`);
  const dates = findDates(normalized);
  for (let m = labelRe.exec(normalized); m; m = labelRe.exec(normalized)) {
    const from = m.index + m[0].length;
    const hit = dates.find((d) => d.span.start >= from && d.span.start <= from + 60);
    if (hit) return makeField(original, field, hit.iso, hit.span, m[0].trim(), "labelled");
  }
  return null;
}

const DOB_LABELS = /(?:date\s+of\s+birth|d\.?o\.?b\.?|birth\s+date|জন্ম\s*তারিখ|জন্মতারিখ)/i;
const ISSUE_DATE_LABELS = /(?:date\s+of\s+issue|issue\s+date|issued\s+on|ইস্যুর\s*তারিখ|প্রদানের\s*তারিখ)/i;
const EXPIRY_DATE_LABELS = /(?:date\s+of\s+expiry|expiry\s+date|expires?\s+on|valid\s+(?:until|till|thru)|মেয়াদ\s*উত্তীর্ণের\s*তারিখ|মেয়াদের\s*তারিখ|মেয়াদ)/i;

// ---------------------------------------------------------------------------
// Bangladesh NID — formats mirror common identity-core semantics:
//   10-digit smart-card number; 13-digit legacy number;
//   17-digit legacy number whose first 4 digits are the holder's birth year.
// There is no public NID check digit, so validation is format + DOB-year
// cross-check only, reported as candidate evidence.
// ---------------------------------------------------------------------------

const NID_LABELS =
  /(?:national\s+id(?:entity)?(?:\s+card)?|\bn\.?i\.?d\.?\b|জাতীয়\s+পরিচয়পত্র|পরিচয়পত্র|এনআইডি)(?:\s*(?:no\.?|number|নং|নম্বর))?/i;
const NID_CONTEXT = /(?:national\s+id|\bn\.?i\.?d\.?\b|জাতীয়\s+পরিচয়পত্র|এনআইডি)/i;

function digitsOnly(s: string): string {
  return s.replace(/[^0-9]/g, "");
}

function plausibleNid(digits: string): boolean {
  if (![10, 13, 17].includes(digits.length)) return false;
  if (/^([0-9])\1+$/.test(digits)) return false; // all-same-digit filler
  if (digits.length === 17) {
    const birthYear = Number(digits.slice(0, 4));
    if (birthYear < 1900 || birthYear > 2030) return false;
  }
  return true;
}

function findNidCandidate(normalized: string): { digits: string; span: SourceSpan; label: string | null } | null {
  const tokenRe = /(?<![0-9])([0-9]+(?:[ \-][0-9]+)*)(?![0-9])/gd;

  // 1) Labelled search first (strongest signal).
  const labelRe = new RegExp(NID_LABELS.source, "gi");
  for (let m = labelRe.exec(normalized); m; m = labelRe.exec(normalized)) {
    const from = m.index + m[0].length;
    const window = normalized.slice(from, from + 80);
    tokenRe.lastIndex = 0;
    for (let t = tokenRe.exec(window); t; t = tokenRe.exec(window)) {
      const digits = digitsOnly(t[1]);
      if (plausibleNid(digits)) {
        const rel = groupSpan(t, 1);
        return { digits, span: { start: from + rel.start, end: from + rel.end }, label: m[0].trim() };
      }
    }
  }

  // 2) Bare search: EVERY bare length needs explicit NID context somewhere
  //    in the document (critic must-fix). A context-free 13/17-digit run is
  //    far more likely an account/reference number than an NID, and claiming
  //    it with a format "pass" would read as verified identity extraction.
  const hasContext = NID_CONTEXT.test(normalized);
  if (!hasContext) return null;
  tokenRe.lastIndex = 0;
  for (let t = tokenRe.exec(normalized); t; t = tokenRe.exec(normalized)) {
    const digits = digitsOnly(t[1]);
    if (!plausibleNid(digits)) continue;
    return { digits, span: groupSpan(t, 1), label: null };
  }
  return null;
}

export function extractBdNid(text: string): SchemaExtraction {
  const out = baseExtraction("bd_nid");
  const normalized = asciiDigitsPreservingLength(text);
  const nid = findNidCandidate(normalized);
  if (!nid) {
    out.validations.push({
      code: "nid_number_missing",
      field: "nid_number",
      status: "missing",
      detail: "No 10/13/17-digit NID-shaped number found (labelled, or bare with NID context).",
    });
    return out;
  }

  out.fields.push(
    makeField(text, "nid_number", nid.digits, nid.span, nid.label, nid.label ? "labelled" : "unlabelled"),
    makeField(text, "nid_format", `${nid.digits.length}_digit`, nid.span, nid.label, nid.label ? "labelled" : "unlabelled"),
  );
  out.validations.push({
    code: "nid_format",
    field: "nid_number",
    status: "pass",
    detail: `${nid.digits.length}-digit NID format (no public check digit exists; format only, candidate only).`,
  });

  const name = labelledLineValue(normalized, /(?:^|\n)\s*(?:name|নাম)(?:\s*(?:\(english\)|ইংরেজিতে))?/i);
  if (name) out.fields.push(makeField(text, "holder_name", name.value, name.span, name.label, "labelled"));

  const dob = labelledDate(text, normalized, "date_of_birth", DOB_LABELS);
  if (dob) out.fields.push(dob);

  if (nid.digits.length === 17) {
    const embeddedYear = nid.digits.slice(0, 4);
    if (!dob) {
      out.validations.push({
        code: "nid_dob_cross_check",
        field: "date_of_birth",
        status: "missing",
        detail: `17-digit NID embeds birth year ${embeddedYear}, but no labelled date of birth was found to cross-check.`,
      });
    } else {
      const consistent = dob.value.startsWith(embeddedYear);
      out.validations.push({
        code: "nid_dob_cross_check",
        field: "date_of_birth",
        status: consistent ? "pass" : "fail",
        detail: consistent
          ? `17-digit NID birth-year prefix ${embeddedYear} matches date of birth ${dob.value}.`
          : `17-digit NID birth-year prefix ${embeddedYear} does NOT match date of birth ${dob.value}; review required.`,
      });
    }
  } else {
    out.validations.push({
      code: "nid_dob_cross_check",
      field: "date_of_birth",
      status: "not_applicable",
      detail: `${nid.digits.length}-digit NIDs do not embed a birth year; DOB cross-check is not applicable.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trade licence
// ---------------------------------------------------------------------------

const TRADE_LICENCE_CONTEXT = /(?:trade\s+licen[cs]e|ট্রেড\s*লাইসেন্স)/i;

export function extractTradeLicence(text: string): SchemaExtraction {
  const out = baseExtraction("bd_trade_licence");
  const normalized = asciiDigitsPreservingLength(text);

  const licenceNo = labelledCapture(
    normalized,
    /(?:trade\s+licen[cs]e|licen[cs]e|ট্রেড\s*লাইসেন্স|লাইসেন্স)\s*(?:no\.?|number|নং|নম্বর)?/i,
    /^[\s:\-–—]*([A-Za-z0-9][A-Za-z0-9\/-]{2,40}[A-Za-z0-9])/d,
    60,
  );
  if (licenceNo) {
    out.fields.push(makeField(text, "licence_number", licenceNo.value, licenceNo.span, licenceNo.label, "labelled"));
  } else {
    out.validations.push({
      code: "licence_number_missing",
      field: "licence_number",
      status: "missing",
      detail: "No labelled trade licence number found.",
    });
  }

  const proprietor = labelledLineValue(
    normalized,
    /(?:proprietor(?:'s)?(?:\s+name)?|owner(?:'s)?(?:\s+name)?|স্বত্বাধিকারী|প্রোপ্রাইটর|মালিকের\s+নাম|মালিক)/i,
  );
  if (proprietor) {
    out.fields.push(makeField(text, "proprietor_name", proprietor.value, proprietor.span, proprietor.label, "labelled"));
  }

  const business = labelledLineValue(
    normalized,
    /(?:business\s+name|name\s+of\s+(?:business|firm|enterprise)|firm\s+name|প্রতিষ্ঠানের\s+নাম|ব্যবসা\s*প্রতিষ্ঠানের\s+নাম)/i,
  );
  if (business) {
    out.fields.push(makeField(text, "business_name", business.value, business.span, business.label, "labelled"));
  }

  const issue = labelledDate(text, normalized, "issue_date", ISSUE_DATE_LABELS);
  if (issue) out.fields.push(issue);
  const expiry = labelledDate(text, normalized, "expiry_date", EXPIRY_DATE_LABELS);
  if (expiry) out.fields.push(expiry);
  if (issue && expiry) {
    out.validations.push({
      code: "licence_date_order",
      field: "expiry_date",
      status: expiry.value >= issue.value ? "pass" : "fail",
      detail:
        expiry.value >= issue.value
          ? `Expiry ${expiry.value} is on/after issue ${issue.value}.`
          : `Expiry ${expiry.value} precedes issue ${issue.value}; review required.`,
    });
  }
  out.fields.sort((a, b) => a.span.start - b.span.start);
  return out;
}

// ---------------------------------------------------------------------------
// Passport — TD3 MRZ-lite (ICAO 9303 positions + 7-3-1 check digits),
// with a labelled fallback when no MRZ block is present.
// MRZ field spans cover the whole MRZ line (OCR may inject spaces inside a
// line, so per-character offsets into the original text are not claimed).
// ---------------------------------------------------------------------------

function mrzCharValue(ch: string): number {
  if (ch === "<") return 0;
  if (ch >= "0" && ch <= "9") return ch.charCodeAt(0) - 48;
  if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0) - 55;
  return 0;
}

function mrzCheckDigit(field: string): string {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < field.length; i++) sum += mrzCharValue(field[i]) * weights[i % 3];
  return String(sum % 10);
}

function mrzDateToIso(yymmdd: string, kind: "dob" | "expiry"): string | null {
  if (!/^[0-9]{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const year = kind === "expiry" ? 2000 + yy : yy <= 29 ? 2000 + yy : 1900 + yy;
  return toIsoDate(Number(yymmdd.slice(4, 6)), Number(yymmdd.slice(2, 4)), year);
}

interface MrzHit {
  line1Span: SourceSpan;
  line2Span: SourceSpan;
  line1: string;
  line2: string;
}

function findMrz(normalized: string): MrzHit | null {
  // Split on \n keeping any preceding \r in the raw line, so span offsets
  // stay exact for CRLF text (critic must-fix: `\r?\n` + length+1 drifted
  // -1 per line). The reported span covers the line without its trailing \r.
  const rawLines = normalized.split("\n");
  const lines = rawLines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
  let cursor = 0;
  const spans: SourceSpan[] = rawLines.map((rawLine, i) => {
    const span = { start: cursor, end: cursor + lines[i].length };
    cursor += rawLine.length + 1;
    return span;
  });
  const compact = lines.map((line) => line.toUpperCase().replace(/[\s]/g, ""));
  for (let i = 0; i + 1 < compact.length; i++) {
    if (!/^P[<A-Z]/.test(compact[i]) || compact[i].length < 30) continue;
    const line2 = compact[i + 1];
    if (!/^[A-Z0-9<]{28,}$/.test(line2)) continue;
    return { line1Span: spans[i], line2Span: spans[i + 1], line1: compact[i], line2 };
  }
  return null;
}

export function extractBdPassport(text: string): SchemaExtraction {
  const out = baseExtraction("bd_passport");
  const normalized = asciiDigitsPreservingLength(text);
  const mrz = findMrz(normalized);

  if (mrz) {
    const { line1, line2 } = mrz;
    const docRaw = line2.slice(0, 9);
    const docNumber = docRaw.replace(/<+$/g, "");
    if (docNumber) {
      out.fields.push(makeField(text, "document_number", docNumber, mrz.line2Span, "mrz_line_2", "labelled"));
    }
    const namePart = line1.slice(5).replace(/<+$/g, "");
    if (namePart) {
      const [surname = "", given = ""] = namePart.split("<<");
      if (surname) out.fields.push(makeField(text, "surname_mrz", surname.replace(/</g, " ").trim(), mrz.line1Span, "mrz_line_1", "labelled"));
      if (given) out.fields.push(makeField(text, "given_names_mrz", given.replace(/</g, " ").trim(), mrz.line1Span, "mrz_line_1", "labelled"));
    }
    const dobIso = mrzDateToIso(line2.slice(13, 19), "dob");
    if (dobIso) out.fields.push(makeField(text, "date_of_birth", dobIso, mrz.line2Span, "mrz_line_2", "labelled"));
    const expiryIso = mrzDateToIso(line2.slice(21, 27), "expiry");
    if (expiryIso) out.fields.push(makeField(text, "expiry_date", expiryIso, mrz.line2Span, "mrz_line_2", "labelled"));

    const check = (code: string, field: string | null, segment: string, expected: string) => {
      const pass = /^[0-9]$/.test(expected) && mrzCheckDigit(segment) === expected;
      out.validations.push({
        code,
        field,
        status: pass ? "pass" : "fail",
        detail: pass
          ? `MRZ 7-3-1 check digit matches for ${field ?? "the composite line"} (OCR-consistency signal only, candidate only).`
          : `MRZ 7-3-1 check digit does NOT match for ${field ?? "the composite line"}; likely OCR error, review required.`,
      });
    };
    check("mrz_document_number_check_digit", "document_number", docRaw, line2[9] ?? "");
    check("mrz_dob_check_digit", "date_of_birth", line2.slice(13, 19), line2[19] ?? "");
    check("mrz_expiry_check_digit", "expiry_date", line2.slice(21, 27), line2[27] ?? "");
    if (line2.length >= 44) {
      check("mrz_composite_check_digit", null, line2.slice(0, 10) + line2.slice(13, 20) + line2.slice(21, 43), line2[43] ?? "");
    }
    out.fields.sort((a, b) => a.span.start - b.span.start);
    return out;
  }

  const docNo = labelledCapture(
    normalized,
    /(?:passport\s*(?:no\.?|number)?|পাসপোর্ট(?:\s*নং|\s*নম্বর)?)/i,
    /^[\s:\-–—]*([A-Za-z]{1,2}[0-9]{6,9})/d,
    40,
  );
  if (docNo) {
    out.fields.push(makeField(text, "document_number", docNo.value.toUpperCase(), docNo.span, docNo.label, "labelled"));
  } else {
    out.validations.push({
      code: "passport_document_number_missing",
      field: "document_number",
      status: "missing",
      detail: "No MRZ block and no labelled passport number found.",
    });
  }
  const dob = labelledDate(text, normalized, "date_of_birth", DOB_LABELS);
  if (dob) out.fields.push(dob);
  const expiry = labelledDate(text, normalized, "expiry_date", EXPIRY_DATE_LABELS);
  if (expiry) out.fields.push(expiry);
  out.fields.sort((a, b) => a.span.start - b.span.start);
  return out;
}

// ---------------------------------------------------------------------------
// Generic invoice / receipt — BDT amounts (decimal strings, never floats),
// dates, BD mobile phones, emails.
// ---------------------------------------------------------------------------

const AMOUNT_NUMBER = "[0-9]{1,3}(?:,[0-9]{2,3})+(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?";
const BDT_AMOUNT_RE = new RegExp(
  `(?:৳|\\bBDT\\b|\\bTk\\.?|\\bTaka\\b|টাকা)\\s*(${AMOUNT_NUMBER})(?![0-9])|(?<![0-9.])(${AMOUNT_NUMBER})\\s*(?:/-|৳|\\bBDT\\b|\\bTk\\.?|\\bTaka\\b|টাকা)`,
  "gid",
);

function canonicalAmount(rawNumber: string): string {
  const plain = rawNumber.replace(/,/g, "");
  const [whole = "0", frac] = plain.split(".");
  const wholeNorm = whole.replace(/^0+(?=[0-9])/, "");
  return frac === undefined ? wholeNorm : `${wholeNorm}.${frac}`;
}

export function findBdPhones(normalized: string): Array<{ value: string; span: SourceSpan }> {
  const re = /(?<![0-9])(\+?880|0)[ \-]?1[3-9](?:[ \-]?[0-9]){8}(?![0-9])/gd;
  const out: Array<{ value: string; span: SourceSpan }> = [];
  for (let m = re.exec(normalized); m; m = re.exec(normalized)) {
    const digits = m[0].replace(/[^0-9]/g, "");
    let e164: string | null = null;
    if (digits.length === 11 && digits.startsWith("01")) e164 = `+880${digits.slice(1)}`;
    else if (digits.length === 13 && digits.startsWith("8801")) e164 = `+${digits}`;
    if (e164) out.push({ value: e164, span: { start: m.index, end: m.index + m[0].length } });
  }
  return out;
}

export function extractInvoiceReceipt(text: string): SchemaExtraction {
  const out = baseExtraction("generic_invoice");
  const normalized = asciiDigitsPreservingLength(text);

  const invoiceNo = labelledCapture(
    normalized,
    /(?:invoice|bill|receipt|voucher|memo)\s*(?:no\.?|number|#)?|ইনভয়েস\s*নং|রসিদ\s*নং|চালান\s*নং/i,
    /^[\s:#\-–—]*([A-Za-z0-9][A-Za-z0-9\/-]{1,30}[A-Za-z0-9]|[A-Za-z0-9]{1,32})/d,
    40,
  );
  if (invoiceNo) {
    out.fields.push(makeField(text, "invoice_number", invoiceNo.value, invoiceNo.span, invoiceNo.label, "labelled"));
  }

  let invoiceDate = labelledDate(text, normalized, "invoice_date", /(?:invoice\s+date|bill\s+date|receipt\s+date|\bdate\b|তারিখ)/i);
  if (!invoiceDate) {
    const first = findDates(normalized)[0];
    if (first) invoiceDate = makeField(text, "document_date", first.iso, first.span, null, "unlabelled");
  }
  if (invoiceDate) out.fields.push(invoiceDate);

  // Labelled total first; an unlabelled amount is never promoted to "total".
  const totalHit = labelledCapture(
    normalized,
    /(?:grand\s+total|net\s+(?:amount|payable|total)|total\s*(?:amount|payable)?|amount\s+due|সর্বমোট|মোট\s*টাকা|মোট)/i,
    new RegExp(`^[\\s:=\\-–—]*(?:৳|\\bBDT\\b|\\bTk\\.?|\\bTaka\\b|টাকা)?\\s*(${AMOUNT_NUMBER})`, "id"),
    50,
  );
  if (totalHit) {
    out.fields.push(
      makeField(text, "total_amount_bdt", canonicalAmount(totalHit.value), totalHit.span, totalHit.label, "labelled"),
    );
  } else {
    out.validations.push({
      code: "invoice_total_missing",
      field: "total_amount_bdt",
      status: "missing",
      detail: "No labelled total (Total/Grand Total/মোট/সর্বমোট) found; unlabelled amounts are not promoted to a total.",
    });
  }

  BDT_AMOUNT_RE.lastIndex = 0;
  let amountCount = 0;
  for (let m = BDT_AMOUNT_RE.exec(normalized); m && amountCount < 20; m = BDT_AMOUNT_RE.exec(normalized)) {
    const group = m[1] !== undefined ? 1 : 2;
    const span = groupSpan(m, group);
    if (totalHit && span.start === totalHit.span.start && span.end === totalHit.span.end) continue;
    out.fields.push(makeField(text, "amount_bdt", canonicalAmount(m[group]), span, null, "unlabelled"));
    amountCount++;
  }

  for (const phone of findBdPhones(normalized).slice(0, 5)) {
    out.fields.push(makeField(text, "phone", phone.value, phone.span, null, "unlabelled"));
  }

  const emailRe = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gd;
  let emailCount = 0;
  for (let m = emailRe.exec(normalized); m && emailCount < 5; m = emailRe.exec(normalized)) {
    emailCount++;
    out.fields.push(
      makeField(text, "email", m[0].toLowerCase(), { start: m.index, end: m.index + m[0].length }, null, "unlabelled"),
    );
  }

  out.fields.sort((a, b) => a.span.start - b.span.start);
  return out;
}

// ---------------------------------------------------------------------------
// Unified entry point — runs every schema, keeps only detected documents.
// A schema is "detected" when its key field is present (NID number, licence
// number / trade-licence context with proprietor, passport document number,
// or any invoice money/contact signal). Invoice detection is intentionally
// suppressed when the document is clearly an identity document with no
// money/date/contact fields, to avoid empty noise.
// ---------------------------------------------------------------------------

export function extractStructuredFields(text: string): StructuredExtractionResult {
  const extractions: SchemaExtraction[] = [];
  const has = (e: SchemaExtraction, field: string) => e.fields.some((f) => f.field === field);

  const nid = extractBdNid(text);
  if (has(nid, "nid_number")) extractions.push(nid);

  const licence = extractTradeLicence(text);
  const licenceContext = TRADE_LICENCE_CONTEXT.test(text);
  if (has(licence, "licence_number") || (licenceContext && has(licence, "proprietor_name"))) {
    extractions.push(licence);
  }

  const passport = extractBdPassport(text);
  if (has(passport, "document_number")) extractions.push(passport);

  const invoice = extractInvoiceReceipt(text);
  const invoiceSignals = invoice.fields.filter((f) =>
    ["invoice_number", "total_amount_bdt", "amount_bdt", "phone", "email"].includes(f.field),
  );
  if (invoiceSignals.length > 0) extractions.push(invoice);

  return {
    schema_version: EXTRACT_SCHEMA_VERSION,
    review_required: true,
    verification_status: "candidate_only",
    extractions,
  };
}

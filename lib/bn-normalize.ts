/**
 * Bengali text normalizer — shared by audio-stt, phrase-eval, and future consumers.
 *
 * Responsibilities:
 *  - Bengali digit → ASCII digit substitution (০→0 … ৯→9)
 *  - Bengali punctuation normalisation (danda → period; double danda → period)
 *  - NFKC composition, whitespace collapse, trim
 *  - Language-mix tagging (bn / en / mixed)
 */

// U+0980–U+09FF = Bengali Unicode block
const BN_RANGE_RE = /[ঀ-৿]/u;
// ASCII-range letters (rough English proxy)
const EN_RANGE_RE = /[A-Za-z]/;

const BENGALI_DIGIT_MAP: Record<string, string> = {
  "০": "0",
  "১": "1",
  "২": "2",
  "৩": "3",
  "৪": "4",
  "৫": "5",
  "৬": "6",
  "৭": "7",
  "৮": "8",
  "৯": "9",
};

/** Replace Bengali digits with ASCII equivalents. */
function replaceBengaliDigits(text: string): string {
  return text.replace(/[০-৯]/gu, (ch) => BENGALI_DIGIT_MAP[ch] ?? ch);
}

/** Normalise Bengali danda (।) and double danda (॥) to plain period. */
function normaliseDanda(text: string): string {
  return text.replace(/[।॥]/gu, ".");
}

/**
 * Full normalisation pass.
 * Applies: NFKC → Bengali digits → danda → whitespace collapse → trim.
 */
export function normaliseBn(text: string): string {
  return normaliseDanda(
    replaceBengaliDigits(text.normalize("NFKC").replace(/\s+/g, " ").trim()),
  );
}

/** Backward-compat alias (dialect.ts uses `normalizeBn`). */
export const normalizeBn = normaliseBn;

export type ScriptMix = "bn" | "en" | "mixed" | "unknown";

/**
 * Tag the dominant script of the normalised string.
 *  - "bn"     — ≥70 % Bengali codepoints (by non-whitespace length)
 *  - "en"     — ≥70 % ASCII-letter codepoints
 *  - "mixed"  — both scripts present but neither dominates
 *  - "unknown" — empty or only punctuation/digits
 */
export function tagScriptMix(text: string): ScriptMix {
  const chars = [...text.replace(/\s/g, "")];
  if (chars.length === 0) return "unknown";

  let bnCount = 0;
  let enCount = 0;
  for (const ch of chars) {
    if (BN_RANGE_RE.test(ch)) bnCount++;
    else if (EN_RANGE_RE.test(ch)) enCount++;
  }

  const total = chars.length;
  const bnFrac = bnCount / total;
  const enFrac = enCount / total;

  if (bnFrac >= 0.7) return "bn";
  if (enFrac >= 0.7) return "en";
  if (bnCount > 0 || enCount > 0) return "mixed";
  return "unknown";
}

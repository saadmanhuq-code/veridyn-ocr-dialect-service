/**
 * Bengali dialect "catcher" — ported from `factory-VERIDYN/ui/bengali-dialect-lab/index.html`
 * transcript-matching heuristic (inferDialectFromTranscript + cues).
 */

const BENGALI_DIGITS = new Map<string, string>([
  ["০", "0"],
  ["১", "1"],
  ["২", "2"],
  ["৩", "3"],
  ["৪", "4"],
  ["৫", "5"],
  ["৬", "6"],
  ["৭", "7"],
  ["৮", "8"],
  ["৯", "9"],
]);

export const DIALECT_SUGGESTION_FLOOR = 0.58;

export interface DialectCandidate {
  phrase: string;
  dialect_label: string;
  speaker_region: string;
  candidate_label: string;
  source: string;
}

/** Curated cues matching the dialect lab chips + bundled sample transcripts. */
export function dialectCueCatalog(): DialectCandidate[] {
  return [
    {
      phrase: "আমি সিলেটি ভাষায় কথা কই",
      dialect_label: "sylhet",
      speaker_region: "Sylhet",
      candidate_label: "Sylhet",
      source: "phrase_chip",
    },
    {
      phrase: "আমি বরিশালে থাকি",
      dialect_label: "barishal",
      speaker_region: "Barishal",
      candidate_label: "Barishal",
      source: "phrase_chip",
    },
    {
      phrase: "আমি চট্টগ্রামের মানুষ",
      dialect_label: "chittagong",
      speaker_region: "Chattogram",
      candidate_label: "Chattogram",
      source: "phrase_chip",
    },
    {
      phrase: "নোয়াখালীতে আইজ বৃষ্টি হইব",
      dialect_label: "noakhali",
      speaker_region: "Noakhali",
      candidate_label: "Noakhali custom",
      source: "phrase_chip",
    },
    {
      phrase:
        "অন কথা হচ্ছে আমরা তো ইয়ানে আড্ডাদি না বন্ধু। আমরা আড্ডাদি মেলা দূর একজাগাত। কোনাই? সুজাহুর, সুজাহুর তো তুই চিনতি ন। সুজাপুরের নাম শুনছিলাম মনে অয়। অনেক দূরে",
      dialect_label: "noakhali",
      speaker_region: "Noakhali",
      candidate_label: "RegSpeech12 Noakhali sample",
      source: "sample_catalog",
    },
    {
      phrase:
        "কী অবস্তা ভাইয়া, তুঁই গম আসো না? অ বালা আছি। তোঁয়ার বাড়ি খডে দে ভাইয়্যে? আঁর বাড়ি অইলদি কক্সবাজারর চকরিয়া। চকরিয়া খোন জাগাত ফইজ্জে দে তোঁয়ার বাড়ি ইবে? চকরিয়ার বড় মোহরি, হিন্দুফারা. বড় মোহরির মইদ্যে এহন তোঁয়ারার উইন্দি দি ছাত্রলীগর সভাপতি খন ?",
      dialect_label: "chittagong",
      speaker_region: "Chittagong",
      candidate_label: "RegSpeech12 Chittagong sample",
      source: "sample_catalog",
    },
  ];
}

export function normalizeBn(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[০-৯]/gu, (ch) => BENGALI_DIGITS.get(ch) ?? ch);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n];
}

function tokenF1(a: string, b: string): number {
  const as = [...new Set(a.split(/\s+/u).filter(Boolean))];
  const bs = [...new Set(b.split(/\s+/u).filter(Boolean))];
  if (!as.length || !bs.length) return 0;
  const bset = new Set(bs);
  let overlap = 0;
  for (const tok of as) {
    if (bset.has(tok)) overlap++;
  }
  const precision = overlap / as.length;
  const recall = overlap / bs.length;
  return (2 * precision * recall) / (precision + recall || 1);
}

function characterSimilarity(expected: string, observed: string): number {
  if (!expected.length || !observed.length) return 0;
  if (expected === observed) return 1;
  return (
    (Math.max(expected.length, observed.length) - levenshtein(expected, observed)) /
    Math.max(expected.length, observed.length, 1)
  );
}

function scorePhrase(expected: string, observed: string): number {
  if (!expected || !observed) return 0;
  if (expected === observed) return 1;
  return Math.max(characterSimilarity(expected, observed), tokenF1(expected, observed));
}

export type DialectInferenceStatus =
  | "missing_transcript"
  | "unresolved"
  | "suggested"
  | "provided";

export interface DialectInference {
  status: DialectInferenceStatus;
  source: string;
  dialect_label: string | null;
  speaker_region: string | null;
  match_score: number | null;
  candidate_label: string | null;
}

/** Match OCR or ASR text against dialect cue phrases (cue-based "catcher"). */
export function inferDialectFromText(transcript: string): DialectInference {
  const normalizedTranscript = normalizeBn(transcript);
  if (!normalizedTranscript) {
    return {
      status: "missing_transcript",
      source: "transcript_match",
      dialect_label: null,
      speaker_region: null,
      match_score: null,
      candidate_label: null,
    };
  }

  let best: (DialectCandidate & { match_score: number; status: "suggested" }) | null = null;
  for (const candidate of dialectCueCatalog()) {
    const score = scorePhrase(normalizeBn(candidate.phrase), normalizedTranscript);
    if (!best || score > best.match_score) {
      best = { ...candidate, match_score: score, status: "suggested" };
    }
  }

  if (!best || best.match_score < DIALECT_SUGGESTION_FLOOR) {
    return {
      status: "unresolved",
      source: "transcript_match",
      dialect_label: null,
      speaker_region: null,
      match_score: best ? best.match_score : null,
      candidate_label: best ? best.candidate_label : null,
    };
  }

  return {
    status: "suggested",
    source: best.source,
    dialect_label: best.dialect_label,
    speaker_region: best.speaker_region,
    match_score: best.match_score,
    candidate_label: best.candidate_label,
  };
}

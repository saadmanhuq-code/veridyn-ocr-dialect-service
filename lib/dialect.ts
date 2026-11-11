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
export const MAX_DIALECT_TEXT_CHARACTERS = 8192;

/**
 * Integration safety caps (critic must-fix): cue scoring is Levenshtein +
 * token-F1 over every catalog phrase in two script views, so unbounded
 * input is an authenticated CPU/cost DoS (108k chars measured at ~2.3s).
 * Scoring and classifier prompts only ever see the first
 * MAX_DIALECT_SCORING_CHARS characters; callers get `input_truncated: true`
 * (additive) instead of a silent cut. The historic 0.58 floor is unchanged
 * for the original labels; the W1 curated regions (place-name cue phrases,
 * no corpus/native-speaker validation yet) require a stronger match so a
 * mere place mention in standard Bengali is not suggested as dialect depth.
 */
export const MAX_DIALECT_SCORING_CHARS = 2000;
export const CURATED_REGION_FLOOR = 0.75;
export const CURATED_REGION_LABELS = new Set(["rajshahi", "khulna", "mymensingh", "cumilla"]);

export function truncateDialectInput(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_DIALECT_SCORING_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_DIALECT_SCORING_CHARS), truncated: true };
}

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
      // RegSpeech12 Sylhet sample — resolves sylhet-long
      phrase:
        "তে খইনছাইন আফনের দিনখান, দিনখাল কিলাখান যায় তে? বালা যার, বাক্কা বালা যার, আফনার কিতা অবস্থা?",
      dialect_label: "sylhet",
      speaker_region: "Sylhet",
      candidate_label: "RegSpeech12 Sylhet sample",
      source: "sample_catalog",
    },
    {
      phrase: "আমি বরিশালে থাকি",
      dialect_label: "barishal",
      speaker_region: "Barishal",
      candidate_label: "Barishal",
      source: "phrase_chip",
    },
    {
      // RegSpeech12 Barishal sample — resolves barishal-long
      phrase:
        "আসসালামু আলাইকুম, আমার নাম হাসিবুর রহমান শুব, ডিপারমেন্ট অব সপটোওয়্যার ইনজিনারিং, ফাস্ট সেমিস্টার, ব্যাচ নাম্বার ফোরটি। আমি ড্যাফোডিল ইন্টারন্যাশনাল ইউনিবার্সিটিতে পড়াশুনা করতেছি। আর আমার হোম টাউন হচ্ছে হলো বরিশালে।",
      dialect_label: "barishal",
      speaker_region: "Barishal",
      candidate_label: "RegSpeech12 Barishal sample",
      source: "sample_catalog",
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
    {
      // RegSpeech12 Rangpur sample
      phrase: "সুমন তারপর হইলো রানা, তারপর জসিম, জাকারিয়া এরা কয়েকঝনের নাম দিছলাম ওটে।",
      dialect_label: "rangpur",
      speaker_region: "Rangpur",
      candidate_label: "RegSpeech12 Rangpur sample",
      source: "sample_catalog",
    },
    {
      // RegSpeech12 Sandwip sample
      phrase:
        "আইচ্ছা। আমনেরা এনজিও সম্পর্কে কিছু জানেন নে? জানি। তো এনজিও, টাকা লই না, আইচ্ছা, হিয়াল্লাই জানি, আইচ্ছা।",
      dialect_label: "sandwip",
      speaker_region: "Sandwip",
      candidate_label: "RegSpeech12 Sandwip sample",
      source: "sample_catalog",
    },
    {
      // Standard Dhaka / মান-বাংলা cue
      phrase: "আমি ঢাকায় থাকি, এখানে অনেক মানুষ।",
      dialect_label: "dhaka",
      speaker_region: "Dhaka",
      candidate_label: "Dhaka standard",
      source: "phrase_chip",
    },
    // W1 regional expansion — curated candidate cues, not corpus samples.
    {
      phrase: "আমি রাজশাহীর মানুষ, পদ্মার পাড়ে বাড়ি",
      dialect_label: "rajshahi",
      speaker_region: "Rajshahi",
      candidate_label: "Rajshahi",
      source: "phrase_chip",
    },
    {
      phrase: "হামার বাড়ি রাজশাহীতে, আমের বাগান আর পদ্মা নদীর পাড়ে থাকি",
      dialect_label: "rajshahi",
      speaker_region: "Rajshahi",
      candidate_label: "Rajshahi curated cue",
      source: "curated_cue",
    },
    {
      phrase: "আমি খুলনার মানুষ, রূপসা নদীর পাড়ে থাকি",
      dialect_label: "khulna",
      speaker_region: "Khulna",
      candidate_label: "Khulna",
      source: "phrase_chip",
    },
    {
      phrase: "কিরাম আছো? আমরা খুলনার রূপসা নদীর পাড়ে থাকি",
      dialect_label: "khulna",
      speaker_region: "Khulna",
      candidate_label: "Khulna curated cue",
      source: "curated_cue",
    },
    {
      phrase: "আমি ময়মনসিংহের মানুষ, ব্রহ্মপুত্রের পাড়ে বাড়ি",
      dialect_label: "mymensingh",
      speaker_region: "Mymensingh",
      candidate_label: "Mymensingh",
      source: "phrase_chip",
    },
    {
      phrase: "কেডা আইতাছে? আমরা ময়মনসিংহের মানুষ, পুরান ব্রহ্মপুত্রের পাড়ে থাকি",
      dialect_label: "mymensingh",
      speaker_region: "Mymensingh",
      candidate_label: "Mymensingh curated cue",
      source: "curated_cue",
    },
    {
      phrase: "আমি কুমিল্লার মানুষ, গোমতী নদীর পাড়ে থাকি",
      dialect_label: "cumilla",
      speaker_region: "Cumilla",
      candidate_label: "Cumilla",
      source: "phrase_chip",
    },
    {
      phrase: "কিতা করতাছো? আমরা কুমিল্লায় থাকি, ধর্মসাগরের কাছে বাড়ি",
      dialect_label: "cumilla",
      speaker_region: "Cumilla",
      candidate_label: "Cumilla curated cue",
      source: "curated_cue",
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

/**
 * Romanized Bengali ("Banglish") token map: Bengali word -> common Latin
 * spellings. Covers the cue-catalog vocabulary plus frequent conversational
 * words so a romanized rendering of a catalog cue scores against the same
 * Bengali-script catalog. English homographs are deliberately excluded
 * (e.g. "to" for তো, "ache" for আছে) so plain English stays English.
 */
const BANGLISH_VARIANTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["আমি", ["ami"]],
  ["আমরা", ["amra"]],
  ["আমার", ["amar"]],
  ["হামার", ["hamar"]],
  ["তুমি", ["tumi"]],
  ["তোমার", ["tomar"]],
  ["আপনি", ["apni"]],
  ["আফনে", ["afne"]],
  ["আফনার", ["afnar", "afner"]],
  ["কি", ["ki"]],
  ["কী", ["kee"]],
  ["কিতা", ["kita"]],
  ["কেডা", ["keda"]],
  ["কেন", ["keno", "ken"]],
  ["কোথায়", ["kothay", "kuthay"]],
  ["এখানে", ["ekhane", "ehane"]],
  ["সেখানে", ["sekhane", "shekhane"]],
  ["আজ", ["aj", "aaj"]],
  ["আইজ", ["aij", "aiz"]],
  ["কাল", ["kal"]],
  ["এখন", ["ekhon", "ehon"]],
  ["অনেক", ["onek"]],
  ["ভালা", ["bala", "vala"]],
  ["ভালো", ["bhalo", "valo"]],
  ["আছি", ["achi", "asi"]],
  ["আছো", ["achho", "acho", "aso"]],
  ["আছে", ["achhe", "ase"]],
  ["থাকি", ["thaki"]],
  ["করি", ["kori"]],
  ["করতাছো", ["kortachho", "kortaso", "kortaco"]],
  ["আইতাছে", ["aitachhe", "aitase", "aitace"]],
  ["যাইতাছে", ["jaitachhe", "jaitase", "zaitase"]],
  ["কথা", ["kotha", "katha"]],
  ["কই", ["koi"]],
  ["খবর", ["khobor", "khabor"]],
  ["কাজ", ["kaj"]],
  ["কাজকাম", ["kajkam"]],
  ["বাড়ি", ["bari"]],
  ["বাসায়", ["basay"]],
  ["টাকা", ["taka"]],
  ["মানুষ", ["manush", "manus"]],
  ["না", ["na"]],
  ["আর", ["ar"]],
  ["ভাষায়", ["bhashay", "vashay", "bashay"]],
  ["বৃষ্টি", ["brishti", "bristi", "bisti"]],
  ["হইব", ["hoibo", "hoibe"]],
  ["কাছে", ["kachhe", "kase"]],
  ["পুরান", ["puran", "purano"]],
  ["কিরাম", ["kiram"]],
  ["আমের", ["amer"]],
  ["বাগান", ["bagan"]],
  ["নদীর", ["nodir"]],
  ["পদ্মা", ["podda", "padma"]],
  ["পদ্মার", ["poddar", "padmar"]],
  ["পাড়ে", ["pare"]],
  ["রূপসা", ["rupsa", "rupsha"]],
  ["গোমতী", ["gomti", "gomoti"]],
  ["ব্রহ্মপুত্রের", ["brahmaputrer"]],
  ["ধর্মসাগরের", ["dharmasagarer", "dhormosagorer"]],
  ["সিলেটি", ["sylheti", "sileti"]],
  ["বরিশালে", ["borishale", "barishale"]],
  ["চট্টগ্রামের", ["chattogramer", "chottogramer"]],
  ["নোয়াখালীতে", ["noakhalite"]],
  ["ঢাকায়", ["dhakay"]],
  ["রাজশাহীর", ["rajshahir"]],
  ["রাজশাহীতে", ["rajshahite"]],
  ["খুলনার", ["khulnar"]],
  ["ময়মনসিংহের", ["mymensingher", "moymonshingher", "mymensingh"]],
  ["কুমিল্লার", ["cumillar", "kumillar"]],
  ["কুমিল্লায়", ["cumillay", "kumillay"]],
];

const BANGLISH_TOKEN_MAP = new Map<string, string>();
for (const [bengali, variants] of BANGLISH_VARIANTS) {
  for (const variant of variants) BANGLISH_TOKEN_MAP.set(variant, bengali);
}

function romanTokenLookup(token: string): string | null {
  const core = token
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .toLowerCase()
    .replace(/'/g, "");
  if (!/^[a-z]+$/u.test(core)) return null;
  return BANGLISH_TOKEN_MAP.get(core) ?? null;
}

/** True when any token in `text` is a known romanized Bengali word. */
export function hasRomanizedBnToken(text: string): boolean {
  return normalizeBn(text)
    .split(" ")
    .some((token) => romanTokenLookup(token) !== null);
}

/**
 * Romanized-aware normal form used only as an additional match view:
 * known Banglish tokens become their Bengali-script word and edge
 * punctuation is stripped from every token. Bengali-script tokens are
 * otherwise unchanged, and the caller always also scores the original
 * `normalizeBn` view, so Bengali-script scoring cannot regress.
 */
export function normalizeRomanizedBn(text: string): string {
  const normalized = normalizeBn(text);
  if (!normalized) return normalized;
  return normalized
    .split(" ")
    .map((token) => {
      const mapped = romanTokenLookup(token);
      if (mapped) return mapped;
      // Bengali vowel signs/virama are combining marks (\p{M}), not letters;
      // stripping "non-letter" edges without \p{M} would corrupt tokens
      // ending in a vowel sign (আমি -> আম, কথা -> কথ).
      return token.replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, "");
    })
    .filter(Boolean)
    .join(" ");
}

export type DialectScriptMix = "bn" | "en" | "mixed" | "banglish" | "unknown";

/**
 * Script/language-mix tag for `dialect_cue.v1` evidence (additive field).
 *  - "bn"       — Bengali script only
 *  - "mixed"    — Bengali script and Latin letters both present
 *  - "banglish" — Latin only, with romanized-Bengali density: >=2 known
 *                 romanized tokens covering >=25% of tokens, or a majority
 *                 of a short token list. The density guard keeps long
 *                 BD-English text that merely repeats a loanword (e.g.
 *                 "taka") tagged "en".
 *  - "en"       — Latin only without that romanized-Bengali evidence
 *  - "unknown"  — no Bengali or Latin letters
 */
export function detectDialectScriptMix(text: string): DialectScriptMix {
  let bnLetters = 0;
  let latinLetters = 0;
  for (const ch of text) {
    if (/[\u0980-\u09ff]/u.test(ch)) bnLetters++;
    else if (/[A-Za-z]/u.test(ch)) latinLetters++;
  }
  if (bnLetters === 0 && latinLetters === 0) return "unknown";
  if (bnLetters > 0 && latinLetters > 0) return "mixed";
  if (bnLetters > 0) return "bn";
  const words = normalizeBn(text).split(" ").filter(Boolean);
  const romanBnCount = words.filter((token) => romanTokenLookup(token) !== null).length;
  const romanBnRatio = words.length > 0 ? romanBnCount / words.length : 0;
  if ((romanBnCount >= 2 && romanBnRatio >= 0.25) || (romanBnCount >= 1 && romanBnRatio >= 0.5)) {
    return "banglish";
  }
  return "en";
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
  // Character Levenshtein is O(n*m); for long inputs its score is dominated
  // by the length gap anyway, so fall back to the linear token-F1 only.
  if (Math.max(expected.length, observed.length) > 300) return tokenF1(expected, observed);
  return Math.max(characterSimilarity(expected, observed), tokenF1(expected, observed));
}

export type DialectInferenceStatus =
  | "missing_transcript"
  | "unresolved"
  | "suggested"
  | "provided";

export type DialectResolutionMethod =
  | "cue_match"
  | "vertex_classifier"
  | "combined";

export type DialectClassifierStatus =
  | "ok"
  | "not_configured"
  | "provider_error"
  | "parse_error"
  | "skipped_missing_transcript";

export interface DialectCueMatchDetail {
  status: DialectInferenceStatus;
  source: string;
  dialect_label: string | null;
  speaker_region: string | null;
  match_score: number | null;
  candidate_label: string | null;
  candidate_dialect_label?: string | null;
  /** Additive in dialect_cue.v1 (W1): bn | en | mixed | banglish | unknown. */
  script_mix?: DialectScriptMix;
  /** Additive: true when scoring saw only the first MAX_DIALECT_SCORING_CHARS chars. */
  input_truncated?: boolean;
}

export interface DialectClassifierDetail {
  status: DialectClassifierStatus;
  dialect: string | null;
  confidence: number | null;
  cues: string[];
  provider?: string;
  model?: string;
  latency_ms?: number;
  error_type?: DialectClassifierStatus;
}

export interface DialectInference {
  status: DialectInferenceStatus;
  source: string;
  dialect_label: string | null;
  speaker_region: string | null;
  match_score: number | null;
  candidate_label: string | null;
  candidate_dialect_label?: string | null;
  /** Additive in dialect_cue.v1 (W1): bn | en | mixed | banglish | unknown. */
  script_mix?: DialectScriptMix;
  /** Additive: true when scoring saw only the first MAX_DIALECT_SCORING_CHARS chars. */
  input_truncated?: boolean;
  method?: DialectResolutionMethod;
  confidence?: number | null;
  classifier_confidence?: number | null;
  classifier_dialect?: string | null;
  classifier_status?: DialectClassifierStatus;
  cues?: string[];
  resolve_threshold?: number;
  detail?: {
    agreement?: "agree" | "disagree" | "none";
    classifier?: DialectClassifierDetail;
    cue_match?: DialectCueMatchDetail;
  };
}

/** Match OCR or ASR text against dialect cue phrases (cue-based "catcher"). */
export function inferDialectFromText(rawTranscript: string): DialectInference {
  const { text: transcript, truncated: input_truncated } = truncateDialectInput(rawTranscript);
  const script_mix = detectDialectScriptMix(transcript);
  const normalizedTranscript = normalizeBn(transcript);
  if (!normalizedTranscript) {
    return {
      status: "missing_transcript",
      source: "transcript_match",
      dialect_label: null,
      speaker_region: null,
      match_score: null,
      candidate_label: null,
      candidate_dialect_label: null,
      script_mix,
      input_truncated,
      method: "cue_match",
      confidence: null,
    };
  }

  // Score the historic Bengali view and, additively, the romanized-aware
  // view; keep the better of the two per candidate. Bengali-script input
  // therefore keeps its historic score, while a Banglish rendering of a
  // catalog cue can now resolve against the Bengali-script catalog.
  const romanizedTranscript = normalizeRomanizedBn(transcript);
  let best: (DialectCandidate & { match_score: number; status: "suggested" }) | null = null;
  for (const candidate of dialectCueCatalog()) {
    const score = Math.max(
      scorePhrase(normalizeBn(candidate.phrase), normalizedTranscript),
      scorePhrase(normalizeRomanizedBn(candidate.phrase), romanizedTranscript),
    );
    if (!best || score > best.match_score) {
      best = { ...candidate, match_score: score, status: "suggested" };
    }
  }

  // Curated W1 regions need a stronger than historic match: their cues are
  // place self-identification phrases, so a weak hit is a place mention in
  // standard Bengali, not dialect-feature evidence (critic must-fix).
  const effectiveFloor =
    best && CURATED_REGION_LABELS.has(best.dialect_label)
      ? CURATED_REGION_FLOOR
      : DIALECT_SUGGESTION_FLOOR;
  if (!best || best.match_score < effectiveFloor) {
    return {
      status: "unresolved",
      source: "transcript_match",
      dialect_label: null,
      speaker_region: null,
      match_score: best ? best.match_score : null,
      candidate_label: best ? best.candidate_label : null,
      candidate_dialect_label: best ? best.dialect_label : null,
      script_mix,
      input_truncated,
      method: "cue_match",
      confidence: best ? best.match_score : null,
    };
  }

  return {
    status: "suggested",
    source: best.source,
    dialect_label: best.dialect_label,
    speaker_region: best.speaker_region,
    match_score: best.match_score,
    candidate_label: best.candidate_label,
    candidate_dialect_label: best.dialect_label,
    script_mix,
    input_truncated,
    method: "cue_match",
    confidence: best.match_score,
  };
}

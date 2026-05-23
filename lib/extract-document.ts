import { createWorker } from "tesseract.js";
import JSZip from "jszip";
import { createRequire } from "module";
import { buildDocumentFactCandidates } from "@/lib/document-facts";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse: (data: Buffer) => Promise<{ text: string }> = require("pdf-parse");

export class DocumentIntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentIntakeError";
  }
}

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const SUPPORTED_TEXT = new Set([".txt", ".md", ".csv"]);
const DOCX = ".docx";
const PDF = ".pdf";
const IMAGES = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"]);

const BN_DIGITS: Record<string, string> = {
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

export function extension(filename: string): string {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

function normalizeIntakeText(text: string): string {
  return text.replace(/[০-৯]/g, (ch) => BN_DIGITS[ch] ?? ch);
}

function detectBengaliScript(text: string): boolean {
  return /[\u0980-\u09FF]/u.test(text);
}

async function decodeTextFile(content: Buffer): Promise<string> {
  for (const enc of ["utf-8", "utf16le"] as BufferEncoding[]) {
    try {
      const s = content.toString(enc);
      if (!s.includes("\uFFFD")) return s.replace(/^\uFEFF/, "");
    } catch {
      /* ignore */
    }
  }
  return content.toString("utf-8").replace(/^\uFEFF/, "");
}

async function extractDocxText(content: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(content);
  const file = zip.file("word/document.xml");
  if (!file) throw new DocumentIntakeError("DOCX file missing word/document.xml.");
  const xml = await file.async("string");
  const stripped = xml
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  return stripped.replace(/\s+/g, " ").trim();
}

async function extractPdfEmbeddedText(content: Buffer): Promise<string> {
  const res = await pdfParse(content);
  return (res?.text ?? "").trim();
}

function resolveLang(language: string | null | undefined): string {
  const l = language?.trim();
  if (!l) return "ben+eng";
  const low = l.toLowerCase();
  if (low === "en" || low === "english") return "eng";
  if (low === "bn" || low === "ben" || low === "bengali") return "ben";
  return l;
}

async function runImageOcr(
  buf: Buffer,
  languageHint: string | null | undefined,
): Promise<{ text: string; warnings: string[]; ocr_provenance: Record<string, unknown> }> {
  const resolvedLang = resolveLang(languageHint);
  let confidence = 0;
  try {
    const worker = await createWorker(resolvedLang);

    try {
      const {
        data: { text: rawText, confidence: conf },
      } = await worker.recognize(buf);
      confidence = typeof conf === "number" ? conf / 100 : 0;
      const normalized = normalizeIntakeText(rawText ?? "").trim();
      const prov: Record<string, unknown> = {
        schema_version: "ocr_intake.v1",
        engine: "tesseract.js",
        language: resolvedLang,
        language_source: languageHint ? "explicit" : "default_ben_eng",
        status: normalized ? "text_extracted_candidate_only" : "no_text_detected",
        candidate_evidence_only: true,
        support_ceiling: "ambiguous",
        review_required: true,
        ocr_quality_score: Math.min(Math.max(Number(confidence.toFixed(4)), 0), 1),
        deployment_note:
          "Vercel WASM path (tesseract.js). For PyMuPDF+native Tesseract parity, deploy scripts/veridyn-ocr-service Docker.",
      };
      const warnings = normalized
        ? ["OCR text is candidate evidence only until reviewed or validated."]
        : ["OCR ran but did not detect readable text in this scan."];
      if (detectBengaliScript(normalized)) {
        prov.bengali_ocr_attempted = true;
      }
      return { text: normalized, warnings, ocr_provenance: prov };
    } finally {
      await worker.terminate();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new DocumentIntakeError(`OCR engine failed: ${msg}`);
  }
}

export async function extractDocumentPayload(
  filename: string,
  content: Buffer,
  languageHint: string | null | undefined,
): Promise<Record<string, unknown>> {
  if (content.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentIntakeError(`Document exceeds ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`);
  }
  const ext = extension(filename);
  const supported = new Set([
    ...SUPPORTED_TEXT.values(),
    DOCX,
    PDF,
    ...IMAGES.values(),
  ]);
  if (!supported.has(ext)) {
    throw new DocumentIntakeError(
      `Unsupported file type '${ext || "unknown"}'. Supported types: ${[...supported].sort().join(", ")}.`,
    );
  }

  let text = "";
  const warnings: string[] = [];
  let ocrProvenance: Record<string, unknown> | null = null;
  let intakeKind = "document";

  if (SUPPORTED_TEXT.has(ext)) {
    text = await decodeTextFile(content);
    warnings.push("Plain-text intake is candidate evidence only until reviewed.");
  } else if (ext === DOCX) {
    text = await extractDocxText(content);
    warnings.push(
      "DOCX text extraction provides candidate evidence only; this content has not been reviewed.",
    );
  } else if (ext === PDF) {
    intakeKind = "pdf_text";
    text = await extractPdfEmbeddedText(content);
    if (!text.trim()) {
      warnings.push(
        "PDF has no embedded text (likely scanned). This deployment does not OCR multi-page scans; upload page images.",
      );
    } else {
      warnings.push(
        "PDF text layer extracted (not OCR). Candidate evidence only until validated.",
      );
    }
    ocrProvenance =
      text.trim().length > 0
        ? {
            schema_version: "pdf_text_intake.v1",
            engine: "pdf-parse",
            status: "text_layer_candidate_only",
          }
        : {
            schema_version: "pdf_text_intake.v1",
            status: "no_embedded_text",
          };
  } else {
    intakeKind = "image_scan";
    const img = await runImageOcr(content, languageHint);
    text = img.text;
    warnings.push(...img.warnings);
    ocrProvenance = img.ocr_provenance;
  }

  const normalized = normalizeIntakeText(text).replace(/\s+/g, " ").trim();

  if (detectBengaliScript(text)) {
    warnings.push(
      "Bengali (Bangla) text detected in uploaded content. Extraction is review-gated and candidate-only.",
    );
  }

  const candidateFactsRows = buildDocumentFactCandidates(text);
  if (normalized.length && candidateFactsRows.length === 0) {
    warnings.push("Structured extraction is unavailable for this document. Preview text is candidate evidence only.");
  }
  if (!normalized.length) {
    warnings.push("Structured extraction is unavailable because no readable text was extracted.");
  }

  return {
    file_name: filename,
    file_extension: ext,
    bytes: content.length,
    intake_kind: intakeKind,
    text_preview: normalized.slice(0, 1200),
    /** Full normalized text — additive vs legacy sidecar clients that only consume `text_preview`. */
    full_text_normalized: normalized,
    candidate_facts: candidateFactsRows,
    extractable: Boolean(normalized),
    warnings,
    ocr_provenance: ocrProvenance,
  };
}

import JSZip from "jszip";
import { buildDocumentFactCandidates } from "@/lib/document-facts";
import { extractPdfTextLayer, loadPdfDocument, ocrImageBuffer, ocrPdfRasterPages } from "@/lib/pdf-raster-ocr";

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
  const doc = await loadPdfDocument(content);
  return extractPdfTextLayer(doc);
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
    try {
      text = await extractPdfEmbeddedText(content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`PDF text-layer read failed (${msg}); falling back to page OCR.`);
      text = "";
    }
    if (!text.trim()) {
      intakeKind = "pdf_scan_ocr";
      const raster = await ocrPdfRasterPages(content, languageHint);
      text = raster.text;
      warnings.push(...raster.warnings);
      ocrProvenance = raster.ocr_provenance;
    } else {
      warnings.push(
        "PDF text layer extracted (not OCR). Candidate evidence only until validated.",
      );
      ocrProvenance = {
        schema_version: "pdf_text_intake.v1",
        engine: "pdfjs-dist",
        status: "text_layer_candidate_only",
      };
    }
  } else {
    intakeKind = "image_scan";
    try {
      const img = await ocrImageBuffer(content, languageHint);
      text = img.text;
      warnings.push(...img.warnings);
      ocrProvenance = img.ocr_provenance;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new DocumentIntakeError(`OCR engine failed: ${msg}`);
    }
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

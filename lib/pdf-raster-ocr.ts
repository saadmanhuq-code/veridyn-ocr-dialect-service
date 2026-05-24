import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { recognizeBuffer } from "@/lib/ocr-engine";

const MAX_OCR_PAGES = 2;
const RENDER_SCALE = 2;
const MAX_OCR_WIDTH = 1800;

const workerPath = path.join(
  process.cwd(),
  "node_modules",
  "pdfjs-dist",
  "legacy",
  "build",
  "pdf.worker.mjs",
);
GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

function resolveLang(language: string | null | undefined): string {
  const l = language?.trim();
  if (!l) return "ben+eng";
  const low = l.toLowerCase();
  if (low === "en" || low === "english" || low === "eng") return "eng";
  if (low === "bn" || low === "ben" || low === "bengali") return "ben";
  return l;
}

export async function loadPdfDocument(pdfBuffer: Buffer): Promise<PDFDocumentProxy> {
  return getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true }).promise;
}

export async function extractPdfTextLayer(doc: PDFDocumentProxy, maxPages = MAX_OCR_PAGES): Promise<string> {
  const pageCount = Math.min(doc.numPages, maxPages);
  const chunks: string[] = [];
  for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
      .join(" ");
    if (pageText.trim()) chunks.push(pageText.trim());
  }
  return chunks.join("\n\n").trim();
}

async function renderPdfPagePngScaled(doc: PDFDocumentProxy, pageNumber: number): Promise<Buffer> {
  let scale = RENDER_SCALE;
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  if (base.width * RENDER_SCALE > MAX_OCR_WIDTH) {
    scale = MAX_OCR_WIDTH / base.width;
  }
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  await page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  return canvas.toBuffer("image/png");
}

export async function ocrPdfRasterPages(
  pdfBuffer: Buffer,
  languageHint: string | null | undefined,
): Promise<{ text: string; warnings: string[]; ocr_provenance: Record<string, unknown> }> {
  const doc = await loadPdfDocument(pdfBuffer);
  const pageCount = Math.min(doc.numPages, MAX_OCR_PAGES);
  const resolvedLang = resolveLang(languageHint);
  const warnings: string[] = [];
  const pageTexts: string[] = [];
  let totalConfidence = 0;
  let confidenceSamples = 0;

  for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
    const png = await renderPdfPagePngScaled(doc, pageNum);
    const { text: normalized, confidence } = await recognizeBuffer(png, resolvedLang);
    if (normalized) pageTexts.push(normalized);
    if (confidence > 0) {
      totalConfidence += confidence;
      confidenceSamples += 1;
    }
  }

  const text = pageTexts.join("\n\n").trim();
  const meanConfidence = confidenceSamples > 0 ? totalConfidence / confidenceSamples : 0;

  if (!text) {
    warnings.push(
      "Scanned PDF OCR ran but no readable text was detected. Try a clearer scan or upload a PNG/JPEG photo of the document.",
    );
  } else {
    warnings.push(
      `Scanned PDF OCR (${pageCount} page${pageCount > 1 ? "s" : ""}) — candidate evidence only until reviewed.`,
    );
  }

  return {
    text,
    warnings,
    ocr_provenance: {
      schema_version: "ocr_intake.v1",
      engine: "tesseract.js",
      intake_path: "pdf_raster_ocr",
      language: resolvedLang,
      pages_ocrd: pageCount,
      status: text ? "text_extracted_candidate_only" : "no_text_detected",
      candidate_evidence_only: true,
      review_required: true,
      ocr_quality_score: Math.min(Math.max(Number(meanConfidence.toFixed(4)), 0), 1),
    },
  };
}

export async function ocrImageBuffer(
  buf: Buffer,
  languageHint: string | null | undefined,
): Promise<{ text: string; warnings: string[]; ocr_provenance: Record<string, unknown> }> {
  const resolvedLang = resolveLang(languageHint);
  const { text, confidence } = await recognizeBuffer(buf, resolvedLang);
  const warnings = text
    ? ["OCR text is candidate evidence only until reviewed or validated."]
    : ["OCR ran but did not detect readable text in this scan."];
  return {
    text,
    warnings,
    ocr_provenance: {
      schema_version: "ocr_intake.v1",
      engine: "tesseract.js",
      language: resolvedLang,
      language_source: languageHint ? "explicit" : "default_ben_eng",
      status: text ? "text_extracted_candidate_only" : "no_text_detected",
      candidate_evidence_only: true,
      support_ceiling: "ambiguous",
      review_required: true,
      ocr_quality_score: Math.min(Math.max(Number(confidence.toFixed(4)), 0), 1),
    },
  };
}

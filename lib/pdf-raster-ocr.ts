import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { recognizeBufferTesseract } from "@/lib/ocr-engine";
import { isGeminiVisionEnabled, isOpenRouterVisionEnabled, isVertexVisionEnabled, ocrImageViaBestVision } from "@/lib/vision-ocr";

const VISION_ENGINES = new Set(["vertex_vision", "gemini_vision"]);

function isVisionEngine(engine: string): boolean {
  return VISION_ENGINES.has(engine) || engine.startsWith("openrouter_vision:");
}

/**
 * PDF page bounds (documented caps — truncation is never silent):
 *  - Text-layer PDFs: all pages up to DEFAULT_MAX_TEXT_PDF_PAGES (50).
 *    Extraction is local pdfjs work, so the cap is generous; it exists to
 *    bound memory/time on adversarial many-page files within the 10MB limit.
 *  - Scanned PDFs: raster OCR up to DEFAULT_MAX_OCR_PDF_PAGES (10) pages AND
 *    within DEFAULT_PDF_OCR_TIME_BUDGET_MS (50s), so the 60s route budget
 *    (app/api/documents/extract maxDuration) keeps headroom. Each OCR page is
 *    a vision-engine call, so the loop re-checks elapsed time before every
 *    page and returns completed pages with an explicit truncation warning.
 * Env overrides (resolved per call, clamped):
 *  VERIDYN_PDF_MAX_TEXT_PAGES (1..200), VERIDYN_PDF_MAX_OCR_PAGES (1..50),
 *  VERIDYN_PDF_OCR_TIME_BUDGET_MS (1000..55000).
 */
export const DEFAULT_MAX_TEXT_PDF_PAGES = 50;
export const DEFAULT_MAX_OCR_PDF_PAGES = 10;
export const DEFAULT_PDF_OCR_TIME_BUDGET_MS = 50_000;
export const DEFAULT_PDF_TEXT_TIME_BUDGET_MS = 30_000;

export interface PdfPageCaps {
  maxTextPages: number;
  maxOcrPages: number;
  ocrTimeBudgetMs: number;
  textTimeBudgetMs: number;
}

/** Per-page extraction record (additive `pages[]` — candidate evidence only). */
export interface PdfPageResult {
  /** 1-based page number. */
  page: number;
  text: string;
  engine: string;
  /** OCR quality proxy 0..1 for OCR pages; null for text-layer pages (not OCR). */
  ocr_quality_score: number | null;
  candidate_evidence_only: true;
}

export interface PdfTextLayerResult {
  text: string;
  pages: PdfPageResult[];
  total_pages: number;
  pages_processed: number;
  max_pages: number;
  truncated: boolean;
  truncation_reason: "page_cap" | "time_budget" | null;
}

export interface PdfRasterOcrResult {
  text: string;
  warnings: string[];
  ocr_provenance: Record<string, unknown>;
  pages: PdfPageResult[];
  total_pages: number;
  pages_processed: number;
  truncated: boolean;
  truncation_reason: "page_cap" | "time_budget" | null;
}

function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

export function resolvePdfPageCaps(
  env: NodeJS.ProcessEnv = process.env,
): PdfPageCaps {
  return {
    maxTextPages: parseBoundedInt(
      env.VERIDYN_PDF_MAX_TEXT_PAGES,
      DEFAULT_MAX_TEXT_PDF_PAGES,
      1,
      200,
    ),
    maxOcrPages: parseBoundedInt(
      env.VERIDYN_PDF_MAX_OCR_PAGES,
      DEFAULT_MAX_OCR_PDF_PAGES,
      1,
      50,
    ),
    ocrTimeBudgetMs: parseBoundedInt(
      env.VERIDYN_PDF_OCR_TIME_BUDGET_MS,
      DEFAULT_PDF_OCR_TIME_BUDGET_MS,
      1_000,
      55_000,
    ),
    textTimeBudgetMs: parseBoundedInt(
      env.VERIDYN_PDF_TEXT_TIME_BUDGET_MS,
      DEFAULT_PDF_TEXT_TIME_BUDGET_MS,
      1_000,
      55_000,
    ),
  };
}

export function planPdfPages(
  totalPages: number,
  maxPages: number,
): { pagesToProcess: number; truncated: boolean } {
  const total = Math.max(0, Math.floor(totalPages) || 0);
  const cap = Math.max(0, Math.floor(maxPages) || 0);
  const pagesToProcess = Math.min(total, cap);
  return { pagesToProcess, truncated: total > pagesToProcess };
}

export function isWithinTimeBudget(
  startedAtMs: number,
  budgetMs: number,
  nowMs: number = Date.now(),
): boolean {
  return nowMs - startedAtMs < budgetMs;
}

export function pdfTruncationWarning(params: {
  kind: "text" | "ocr";
  processed: number;
  total: number;
  reason?: "page_cap" | "time_budget";
  cap?: number;
  budgetMs?: number;
}): string {
  const { kind, processed, total } = params;
  if (kind === "text") {
    if (params.reason === "time_budget") {
      return `PDF text extraction stopped early: processed ${processed} of ${total} pages before the time budget (${params.budgetMs}ms) was reached. Remaining pages were not extracted.`;
    }
    return `PDF text extraction truncated: processed ${processed} of ${total} pages (text page cap ${params.cap}). Remaining pages were not extracted.`;
  }
  if (params.reason === "time_budget") {
    return `Scanned PDF OCR stopped early: processed ${processed} of ${total} pages before the time budget (${params.budgetMs}ms) was reached. Remaining pages were not OCR'd.`;
  }
  return `Scanned PDF OCR truncated: processed ${processed} of ${total} pages (OCR page cap ${params.cap}). Remaining pages were not OCR'd.`;
}

function clampQualityScore(value: number): number {
  return Math.min(Math.max(Number(value.toFixed(4)), 0), 1);
}

const RENDER_SCALE = 2;
const MAX_OCR_WIDTH = 1200;

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

async function recognizeScanBuffer(
  buf: Buffer,
  languageHint: string | null | undefined,
): Promise<{ text: string; confidence: number; engine: string; visionFallback?: "provider_failure" }> {
  const resolvedLang = resolveLang(languageHint);
  let visionFailed = false;
  if (process.env.VERCEL || isVertexVisionEnabled() || isGeminiVisionEnabled() || isOpenRouterVisionEnabled()) {
    try {
      return await ocrImageViaBestVision(buf, languageHint);
    } catch (e) {
      if (process.env.VERCEL) throw e;
      visionFailed = true;
    }
  }
  const tess = await recognizeBufferTesseract(buf, resolvedLang);
  return { ...tess, engine: "tesseract.js", ...(visionFailed ? { visionFallback: "provider_failure" as const } : {}) };
}

async function downscaleForOcr(buf: Buffer, maxWidth = MAX_OCR_WIDTH): Promise<Buffer> {
  const img = await loadImage(buf);
  if (img.width <= maxWidth) return buf;
  const scale = maxWidth / img.width;
  const canvas = createCanvas(Math.ceil(img.width * scale), Math.ceil(img.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toBuffer("image/png");
}

export async function loadPdfDocument(pdfBuffer: Buffer): Promise<PDFDocumentProxy> {
  return getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true }).promise;
}

export async function extractPdfTextLayerPages(
  doc: PDFDocumentProxy,
  maxPages: number = resolvePdfPageCaps().maxTextPages,
  timeBudgetMs: number = resolvePdfPageCaps().textTimeBudgetMs,
): Promise<PdfTextLayerResult> {
  const totalPages = doc.numPages;
  const { pagesToProcess } = planPdfPages(totalPages, maxPages);
  const startedAtMs = Date.now();
  let truncationReason: "page_cap" | "time_budget" | null = null;
  const pages: PdfPageResult[] = [];
  for (let pageNum = 1; pageNum <= pagesToProcess; pageNum += 1) {
    // Text-layer reads are local but unbounded page counts inside a 60s
    // route still need a budget (critic must-fix); completed pages return.
    if (pageNum > 1 && !isWithinTimeBudget(startedAtMs, timeBudgetMs)) {
      truncationReason = "time_budget";
      break;
    }
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
      .join(" ");
    pages.push({
      page: pageNum,
      text: pageText.trim(),
      engine: "pdfjs-dist",
      ocr_quality_score: null,
      candidate_evidence_only: true,
    });
  }
  const text = pages
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const truncated = pages.length < totalPages;
  if (truncated && truncationReason === null) truncationReason = "page_cap";
  if (!truncated) truncationReason = null;
  return {
    text,
    pages,
    total_pages: totalPages,
    pages_processed: pages.length,
    max_pages: maxPages,
    truncated,
    truncation_reason: truncationReason,
  };
}

export async function extractPdfTextLayer(
  doc: PDFDocumentProxy,
  maxPages?: number,
): Promise<string> {
  return (await extractPdfTextLayerPages(doc, maxPages)).text;
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

class PdfPageOcrTimeoutError extends Error {
  constructor(pageNum: number, timeoutMs: number) {
    super(`OCR for PDF page ${pageNum} exceeded the remaining time budget (${timeoutMs}ms)`);
    this.name = "PdfPageOcrTimeoutError";
  }
}

/**
 * Race one page's OCR against the remaining route budget (critic must-fix:
 * a single hung vision page must not consume the whole 60s route and lose
 * every completed page). The underlying provider call has its own internal
 * timeouts and is abandoned, not aborted — `ocrImageViaBestVision` takes no
 * AbortSignal — but the caller regains control and returns partial pages.
 */
export async function withPdfPageTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  pageNum: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PdfPageOcrTimeoutError(pageNum, timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function ocrPdfRasterPages(
  pdfBuffer: Buffer,
  languageHint: string | null | undefined,
  options: { maxPages?: number; timeBudgetMs?: number } = {},
): Promise<PdfRasterOcrResult> {
  const caps = resolvePdfPageCaps();
  const maxPages = options.maxPages ?? caps.maxOcrPages;
  const timeBudgetMs = options.timeBudgetMs ?? caps.ocrTimeBudgetMs;
  const startedAtMs = Date.now();

  const doc = await loadPdfDocument(pdfBuffer);
  const totalPages = doc.numPages;
  const { pagesToProcess } = planPdfPages(totalPages, maxPages);
  const resolvedLang = resolveLang(languageHint);
  const warnings: string[] = [];
  const pages: PdfPageResult[] = [];
  let totalConfidence = 0;
  let confidenceSamples = 0;
  let engineUsed = "tesseract.js";
  let visionFallbackPages = 0;
  let truncationReason: "page_cap" | "time_budget" | null = null;

  for (let pageNum = 1; pageNum <= pagesToProcess; pageNum += 1) {
    // Page-loop guard: never start a new page once the budget is spent, so a
    // many-page scan cannot consume the whole 60s route budget. Completed
    // pages are still returned (with an explicit truncation warning below).
    if (pageNum > 1 && !isWithinTimeBudget(startedAtMs, timeBudgetMs)) {
      truncationReason = "time_budget";
      break;
    }
    const png = await downscaleForOcr(await renderPdfPagePngScaled(doc, pageNum));
    const remainingMs = Math.max(1_000, timeBudgetMs - (Date.now() - startedAtMs));
    let pageResult: { text: string; confidence: number; engine: string; visionFallback?: "provider_failure" };
    try {
      pageResult = await withPdfPageTimeout(recognizeScanBuffer(png, languageHint), remainingMs, pageNum);
    } catch (e) {
      if (e instanceof PdfPageOcrTimeoutError) {
        truncationReason = "time_budget";
        warnings.push(
          `Scanned PDF OCR timed out on page ${pageNum} within the time budget (${timeBudgetMs}ms); returning ${pages.length} completed page(s). Remaining pages were not OCR'd.`,
        );
        break;
      }
      throw e;
    }
    const { text: normalized, confidence, engine, visionFallback } = pageResult;
    engineUsed = engine;
    if (visionFallback) visionFallbackPages += 1;
    pages.push({
      page: pageNum,
      text: normalized,
      engine,
      ocr_quality_score: clampQualityScore(confidence),
      candidate_evidence_only: true,
    });
    // Mean over ALL processed pages including 0-confidence ones (critic
    // must-fix: excluding zeros inflated ocr_quality_score).
    totalConfidence += confidence;
    confidenceSamples += 1;
  }

  const pagesProcessed = pages.length;
  const truncated = pagesProcessed < totalPages;
  if (truncated && truncationReason === null) {
    truncationReason = "page_cap";
  }
  if (!truncated) {
    truncationReason = null;
  }

  const text = pages
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n\n")
    .trim();
  if (visionFallbackPages > 0) {
    warnings.push(`Vision OCR failed on ${visionFallbackPages} page${visionFallbackPages === 1 ? "" : "s"}; local OCR was used. Review the extracted text.`);
  }
  const meanConfidence = confidenceSamples > 0 ? totalConfidence / confidenceSamples : 0;

  if (!text) {
    warnings.push(
      "Scanned PDF OCR ran but no readable text was detected. Try a clearer scan or upload a PNG/JPEG photo of the document.",
    );
  } else {
    warnings.push(
      `Scanned PDF OCR (${pagesProcessed} page${pagesProcessed > 1 ? "s" : ""}) — candidate evidence only until reviewed.`,
    );
  }
  if (truncated) {
    warnings.push(
      pdfTruncationWarning({
        kind: "ocr",
        processed: pagesProcessed,
        total: totalPages,
        reason: truncationReason ?? "page_cap",
        cap: maxPages,
        budgetMs: timeBudgetMs,
      }),
    );
  }

  return {
    text,
    warnings,
    pages,
    total_pages: totalPages,
    pages_processed: pagesProcessed,
    truncated,
    truncation_reason: truncationReason,
    ocr_provenance: {
      schema_version: "ocr_intake.v1",
      // Legacy single-engine field: first processed page's engine. The
      // additive `engines` list is the honest record for mixed-engine docs
      // (critic must-fix: last-page-only misreported fallback documents).
      engine: pages[0]?.engine ?? engineUsed,
      engines: [...new Set(pages.map((p) => p.engine))],
      pages_scored: confidenceSamples,
      intake_path: "pdf_raster_ocr",
      language: resolvedLang,
      pages_ocrd: pagesProcessed,
      ...(visionFallbackPages > 0 ? { vision_fallback: "provider_failure", vision_fallback_page_count: visionFallbackPages } : {}),
      total_pages: totalPages,
      max_ocr_pages: maxPages,
      truncated,
      ...(truncated ? { truncation_reason: truncationReason } : {}),
      elapsed_ms: Date.now() - startedAtMs,
      status: text ? "text_extracted_candidate_only" : "no_text_detected",
      candidate_evidence_only: true,
      review_required: true,
      ocr_quality_score: clampQualityScore(meanConfidence),
      ...(isVisionEngine(engineUsed)
        ? { confidence_note: "estimated — character-level heuristic proxy, not a calibrated OCR confidence score" }
        : {}),
    },
  };
}

export async function ocrImageBuffer(
  buf: Buffer,
  languageHint: string | null | undefined,
): Promise<{ text: string; warnings: string[]; ocr_provenance: Record<string, unknown> }> {
  const resolvedLang = resolveLang(languageHint);
  const scaled = await downscaleForOcr(buf);
  const { text, confidence, engine, visionFallback } = await recognizeScanBuffer(scaled, languageHint);
  const warnings = text
    ? ["OCR text is candidate evidence only until reviewed or validated."]
    : ["OCR ran but did not detect readable text in this scan."];
  if (visionFallback) warnings.unshift("Vision OCR failed; local OCR was used. Review the extracted text.");
  return {
    text,
    warnings,
    ocr_provenance: {
      schema_version: "ocr_intake.v1",
      engine,
      ...(visionFallback ? { vision_fallback: visionFallback } : {}),
      language: resolvedLang,
      language_source: languageHint ? "explicit" : "default_ben_eng",
      status: text ? "text_extracted_candidate_only" : "no_text_detected",
      candidate_evidence_only: true,
      support_ceiling: "ambiguous",
      review_required: true,
      ocr_quality_score: Math.min(Math.max(Number(confidence.toFixed(4)), 0), 1),
      ...(isVisionEngine(engine)
        ? { confidence_note: "estimated — character-level heuristic proxy, not a calibrated OCR confidence score" }
        : {}),
    },
  };
}

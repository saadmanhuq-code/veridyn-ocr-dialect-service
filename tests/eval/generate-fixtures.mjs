/**
 * Synthetic BN+EN print fixture generator for the OCR gold set.
 *
 * Renders the `lines` of each png/pdf entry in tests/eval/gold/ocr-gold.json
 * into clean black-on-white print so the live runner can upload real image/PDF
 * bytes without committing binaries:
 *   png       — @napi-rs/canvas raster (already a runtime dependency)
 *   pdf_text  — pdf-lib with an embedded text layer (Latin only; StandardFonts
 *               cannot encode Bengali, which is why the gold pdf_text entry is EN)
 *   pdf_scan  — pdf-lib page wrapping the rendered PNG (no text layer), which
 *               exercises the scanned-PDF raster path (pdfjs-dist + canvas)
 *
 * Bengali rendering needs a Bengali-capable font. We look for (in order):
 *   $EVAL_BN_FONT_PATH, common Noto Sans Bengali / Nirmala UI install paths.
 * If none is found we still render with the canvas default font stack and the
 * caller is told via `bengaliFontRegistered()` — tofu boxes would tank the BN
 * token-F1 gate loudly rather than silently, which is the intended failure.
 *
 * CLI: node tests/eval/generate-fixtures.mjs [--out tests/eval/generated]
 * Generated files are disposable; the gold JSON is the committed truth.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

const BN_FONT_CANDIDATES = [
  process.env.EVAL_BN_FONT_PATH,
  "C:/Windows/Fonts/Nirmala.ttf",
  "C:/Windows/Fonts/Nirmala.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansBengali-Regular.ttf",
  "/usr/share/fonts/noto/NotoSansBengali-Regular.ttf",
  "/System/Library/Fonts/Supplemental/NotoSansBengali-Regular.ttf",
].filter(Boolean);

const BN_FAMILY = "EvalBengali";
let bnFontPath = null;

export function registerBengaliFont() {
  if (bnFontPath) return bnFontPath;
  for (const candidate of BN_FONT_CANDIDATES) {
    if (existsSync(candidate)) {
      try {
        if (GlobalFonts.registerFromPath(candidate, BN_FAMILY)) {
          bnFontPath = candidate;
          return bnFontPath;
        }
      } catch {
        // Try the next candidate; absence is surfaced, not hidden.
      }
    }
  }
  return null;
}

export function bengaliFontRegistered() {
  return bnFontPath !== null;
}

/** Render lines as clean print PNG bytes (48px, generous line spacing). */
export function renderPng(lines) {
  registerBengaliFont();
  const font = `48px ${bnFontPath ? `"${BN_FAMILY}", ` : ""}Arial, sans-serif`;
  const lineHeight = 72;
  const pad = 40;
  const measure = createCanvas(10, 10).getContext("2d");
  measure.font = font;
  const width = Math.ceil(Math.max(...lines.map((l) => measure.measureText(l).width), 200)) + pad * 2;
  const height = pad * 2 + lineHeight * lines.length;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.font = font;
  ctx.textBaseline = "top";
  lines.forEach((line, i) => ctx.fillText(line, pad, pad + i * lineHeight));
  return canvas.toBuffer("image/png");
}

/** Single-page PDF with an embedded text layer (Latin lines only). */
export async function makeTextPdf(lines) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => {
    page.drawText(line, { x: 56, y: 770 - i * 36, size: 20, font });
  });
  return Buffer.from(await doc.save());
}

/** Image-only PDF wrapping a PNG — no text layer (scanned-PDF path). */
export async function makeScanPdf(pngBytes) {
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(pngBytes);
  const page = doc.addPage([595, 842]);
  const scale = Math.min((595 - 80) / image.width, (842 - 80) / image.height, 1);
  page.drawImage(image, {
    x: 40,
    y: 842 - 40 - image.height * scale,
    width: image.width * scale,
    height: image.height * scale,
  });
  return Buffer.from(await doc.save());
}

/** Multi-page text-layer PDF: one pdf-lib page per `pages_lines` entry. */
export async function makeTextPdfMulti(pagesLines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pagesLines) {
    const page = doc.addPage([595, 842]);
    lines.forEach((line, i) => page.drawText(line, { x: 56, y: 770 - i * 36, size: 20, font }));
  }
  return Buffer.from(await doc.save());
}

/** Multi-page image-only PDF: one rendered PNG page per `pages_lines` entry. */
export async function makeScanPdfMulti(pagesLines) {
  const doc = await PDFDocument.create();
  for (const lines of pagesLines) {
    const image = await doc.embedPng(renderPng(lines));
    const page = doc.addPage([595, 842]);
    const scale = Math.min((595 - 80) / image.width, (842 - 80) / image.height, 1);
    page.drawImage(image, { x: 40, y: 842 - 40 - image.height * scale, width: image.width * scale, height: image.height * scale });
  }
  return Buffer.from(await doc.save());
}

/** Build upload bytes for one ocr-gold entry. Returns { bytes, mime }. */
export async function fixtureForEntry(entry) {
  switch (entry.kind) {
    case "txt":
      return { bytes: Buffer.from(entry.content, "utf8"), mime: "text/plain" };
    case "png":
      return { bytes: renderPng(entry.lines), mime: "image/png" };
    case "pdf_text":
      return { bytes: await makeTextPdf(entry.lines), mime: "application/pdf" };
    case "pdf_scan":
      return { bytes: await makeScanPdf(renderPng(entry.lines)), mime: "application/pdf" };
    case "pdf_text_multi":
      return { bytes: await makeTextPdfMulti(entry.pages_lines), mime: "application/pdf" };
    case "pdf_scan_multi":
      return { bytes: await makeScanPdfMulti(entry.pages_lines), mime: "application/pdf" };
    default:
      throw new Error(`Unknown ocr gold kind: ${entry.kind} (${entry.id})`);
  }
}

export function loadOcrGold() {
  return JSON.parse(readFileSync(join(REPO_ROOT, "tests/eval/gold/ocr-gold.json"), "utf8"));
}

async function main() {
  const outArg = process.argv.indexOf("--out");
  const outDir = outArg >= 0 ? process.argv[outArg + 1] : join(REPO_ROOT, "tests/eval/generated");
  mkdirSync(outDir, { recursive: true });
  const gold = loadOcrGold();
  for (const entry of gold.entries) {
    const { bytes } = await fixtureForEntry(entry);
    writeFileSync(join(outDir, entry.file_name), bytes);
    console.log(`${entry.file_name}  ${bytes.length} bytes (${entry.kind})`);
  }
  console.log(
    bengaliFontRegistered()
      ? `Bengali font: ${bnFontPath}`
      : "WARNING: no Bengali font found (set EVAL_BN_FONT_PATH); BN PNGs may render as tofu.",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

/**
 * W3 OCR scale: multi-page PDF extraction bounds.
 *
 * Covers the unit seams in pdf-raster-ocr.ts (caps, page planning, time-budget
 * guard, truncation warnings, text-layer per-page logic via a fake pdfjs doc)
 * plus real multi-page text PDFs (pdf-lib fixtures) through
 * extractDocumentPayload — the consumer-facing payload, pages[] shape, legacy
 * field preservation, and the never-silent truncation warning.
 *
 * Raster OCR of scanned pages needs a vision engine / tesseract worker and is
 * intentionally not exercised here; its loop is guarded by the same tested
 * planPdfPages / isWithinTimeBudget / pdfTruncationWarning seams.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

import {
  DEFAULT_MAX_OCR_PDF_PAGES,
  DEFAULT_MAX_TEXT_PDF_PAGES,
  DEFAULT_PDF_OCR_TIME_BUDGET_MS,
  DEFAULT_PDF_TEXT_TIME_BUDGET_MS,
  extractPdfTextLayer,
  extractPdfTextLayerPages,
  isWithinTimeBudget,
  pdfTruncationWarning,
  planPdfPages,
  resolvePdfPageCaps,
  withPdfPageTimeout,
  type PdfPageResult,
} from "./pdf-raster-ocr";
import { extractDocumentPayload } from "./extract-document";

function fakeDoc(pageTexts: string[]): PDFDocumentProxy {
  return {
    numPages: pageTexts.length,
    getPage: async (pageNum: number) => ({
      getTextContent: async () => {
        const text = pageTexts[pageNum - 1] ?? "";
        return { items: text ? text.split(" ").map((w) => ({ str: w })) : [] };
      },
    }),
  } as unknown as PDFDocumentProxy;
}

describe("resolvePdfPageCaps", () => {
  test("defaults lift the old silent 2-page cap", () => {
    const caps = resolvePdfPageCaps({} as unknown as NodeJS.ProcessEnv);
    assert.equal(caps.maxTextPages, DEFAULT_MAX_TEXT_PDF_PAGES);
    assert.equal(caps.maxOcrPages, DEFAULT_MAX_OCR_PDF_PAGES);
    assert.equal(caps.ocrTimeBudgetMs, DEFAULT_PDF_OCR_TIME_BUDGET_MS);
    assert.ok(caps.maxTextPages > 2 && caps.maxOcrPages > 2);
    assert.ok(caps.ocrTimeBudgetMs < 60_000, "budget must keep headroom under the 60s route limit");
  });

  test("env overrides apply and are clamped; invalid values fall back", () => {
    const caps = resolvePdfPageCaps({
      VERIDYN_PDF_MAX_TEXT_PAGES: "3",
      VERIDYN_PDF_MAX_OCR_PAGES: "9999",
      VERIDYN_PDF_OCR_TIME_BUDGET_MS: "not-a-number",
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(caps.maxTextPages, 3);
    assert.equal(caps.maxOcrPages, 50);
    assert.equal(caps.ocrTimeBudgetMs, DEFAULT_PDF_OCR_TIME_BUDGET_MS);
    assert.equal(
      resolvePdfPageCaps({ VERIDYN_PDF_MAX_TEXT_PAGES: "0" } as unknown as NodeJS.ProcessEnv).maxTextPages,
      1,
    );
  });
});

describe("planPdfPages + time-budget guard", () => {
  test("plans all pages under the cap and flags truncation above it", () => {
    assert.deepEqual(planPdfPages(4, 10), { pagesToProcess: 4, truncated: false });
    assert.deepEqual(planPdfPages(12, 10), { pagesToProcess: 10, truncated: true });
    assert.deepEqual(planPdfPages(0, 10), { pagesToProcess: 0, truncated: false });
  });

  test("isWithinTimeBudget is strict at the boundary", () => {
    assert.equal(isWithinTimeBudget(1_000, 500, 1_499), true);
    assert.equal(isWithinTimeBudget(1_000, 500, 1_500), false);
    assert.equal(isWithinTimeBudget(1_000, 500, 2_000), false);
  });

  test("truncation warnings name processed/total and the binding bound", () => {
    assert.match(
      pdfTruncationWarning({ kind: "text", processed: 50, total: 80, cap: 50 }),
      /truncated: processed 50 of 80 pages \(text page cap 50\)\. Remaining pages were not extracted\./,
    );
    assert.match(
      pdfTruncationWarning({ kind: "ocr", processed: 10, total: 14, reason: "page_cap", cap: 10 }),
      /truncated: processed 10 of 14 pages \(OCR page cap 10\)\. Remaining pages were not OCR'd\./,
    );
    assert.match(
      pdfTruncationWarning({ kind: "ocr", processed: 3, total: 9, reason: "time_budget", budgetMs: 50_000 }),
      /stopped early: processed 3 of 9 pages before the time budget \(50000ms\) was reached\. Remaining pages were not OCR'd\./,
    );
  });
});

describe("extractPdfTextLayerPages (fake pdfjs doc)", () => {
  test("extracts every page beyond the old 2-page cap, in order", async () => {
    const result = await extractPdfTextLayerPages(fakeDoc(["one", "two words", "", "four"]));
    assert.equal(result.total_pages, 4);
    assert.equal(result.pages_processed, 4);
    assert.equal(result.truncated, false);
    assert.deepEqual(result.pages.map((p) => p.page), [1, 2, 3, 4]);
    assert.deepEqual(result.pages.map((p) => p.text), ["one", "two words", "", "four"]);
    assert.ok(result.pages.every((p) => p.engine === "pdfjs-dist"));
    assert.ok(result.pages.every((p) => p.ocr_quality_score === null));
    assert.ok(result.pages.every((p) => p.candidate_evidence_only === true));
    // Legacy join semantics: empty pages contribute no chunk.
    assert.equal(result.text, "one\n\ntwo words\n\nfour");
  });

  test("cap truncates and reports it; legacy string API matches", async () => {
    const doc = fakeDoc(["a", "b", "c", "d", "e"]);
    const result = await extractPdfTextLayerPages(doc, 3);
    assert.equal(result.truncated, true);
    assert.equal(result.pages_processed, 3);
    assert.equal(result.text, "a\n\nb\n\nc");
    assert.equal(await extractPdfTextLayer(doc, 3), result.text);
    assert.equal(await extractPdfTextLayer(doc), "a\n\nb\n\nc\n\nd\n\ne");
  });
});

async function makeTextPdf(markers: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const marker of markers) {
    const page = doc.addPage([420, 200]);
    page.drawText(marker, { x: 40, y: 120, size: 16, font });
  }
  return Buffer.from(await doc.save());
}

const squash = (s: string) => s.replace(/\s+/g, "");

describe("extractDocumentPayload — multi-page text PDF (real pdfjs)", () => {
  const markers = ["AlphaPageOne", "BravoPageTwo", "CharliePageThree", "DeltaPageFour"];

  test("returns all pages with additive pages[] and intact legacy fields", async () => {
    const payload = await extractDocumentPayload("multi.pdf", await makeTextPdf(markers), undefined);

    // Legacy ProteinChain sidecar fields, unchanged shapes.
    assert.equal(payload.file_name, "multi.pdf");
    assert.equal(payload.intake_kind, "pdf_text");
    assert.equal(payload.extractable, true);
    assert.ok(Array.isArray(payload.candidate_facts));
    assert.ok(Array.isArray(payload.warnings));
    assert.equal(typeof payload.text_preview, "string");

    const full = String(payload.full_text_normalized);
    for (const marker of markers) {
      assert.ok(squash(full).includes(marker), `full text must include ${marker} (pages beyond 2 were silently dropped before W3)`);
    }

    const pages = payload.pages as PdfPageResult[];
    assert.equal(pages.length, 4);
    assert.deepEqual(pages.map((p) => p.page), [1, 2, 3, 4]);
    pages.forEach((p, i) => {
      assert.ok(squash(p.text).includes(markers[i]), `pages[${i}] must carry ${markers[i]}`);
      assert.equal(p.engine, "pdfjs-dist");
      assert.equal(p.ocr_quality_score, null);
      assert.equal(p.candidate_evidence_only, true);
    });
    // Invariant: joining non-empty page texts reproduces the legacy full text.
    assert.equal(pages.map((p) => p.text).filter(Boolean).join(" "), full);

    const provenance = payload.ocr_provenance as Record<string, unknown>;
    assert.equal(provenance.schema_version, "pdf_text_intake.v1");
    assert.equal(provenance.total_pages, 4);
    assert.equal(provenance.pages_extracted, 4);
    assert.equal(provenance.truncated, false);
    assert.ok(!(payload.warnings as string[]).some((w) => /truncated|stopped early/i.test(w)));
  });

  test("page cap truncates with an explicit warning, never silently", async () => {
    const prev = process.env.VERIDYN_PDF_MAX_TEXT_PAGES;
    process.env.VERIDYN_PDF_MAX_TEXT_PAGES = "2";
    try {
      const payload = await extractDocumentPayload("capped.pdf", await makeTextPdf(markers), undefined);
      const pages = payload.pages as PdfPageResult[];
      assert.equal(pages.length, 2);
      assert.ok(!squash(String(payload.full_text_normalized)).includes("CharliePageThree"));
      const provenance = payload.ocr_provenance as Record<string, unknown>;
      assert.equal(provenance.truncated, true);
      assert.equal(provenance.total_pages, 4);
      assert.ok(
        (payload.warnings as string[]).some((w) =>
          /PDF text extraction truncated: processed 2 of 4 pages/.test(w),
        ),
        "truncation must surface as a warning naming processed/total pages",
      );
    } finally {
      if (prev === undefined) delete process.env.VERIDYN_PDF_MAX_TEXT_PAGES;
      else process.env.VERIDYN_PDF_MAX_TEXT_PAGES = prev;
    }
  });
});

describe("integration: time budgets + structured_fields wiring", () => {
  test("caps expose a text-layer time budget under the route limit", () => {
    const caps = resolvePdfPageCaps({} as unknown as NodeJS.ProcessEnv);
    assert.equal(caps.textTimeBudgetMs, DEFAULT_PDF_TEXT_TIME_BUDGET_MS);
    assert.ok(caps.textTimeBudgetMs < 60_000);
  });

  test("text-layer loop stops on its time budget and says so", async () => {
    const slowDoc = {
      numPages: 5,
      getPage: async (pageNum: number) => ({
        getTextContent: async () => {
          await new Promise((r) => setTimeout(r, 15));
          return { items: [{ str: `page${pageNum}` }] };
        },
      }),
    } as unknown as PDFDocumentProxy;
    const result = await extractPdfTextLayerPages(slowDoc, 50, 20);
    assert.equal(result.truncated, true);
    assert.equal(result.truncation_reason, "time_budget");
    assert.ok(result.pages_processed >= 1 && result.pages_processed < 5);
    assert.match(
      pdfTruncationWarning({ kind: "text", processed: result.pages_processed, total: 5, reason: "time_budget", budgetMs: 20 }),
      /stopped early: processed \d+ of 5 pages before the time budget \(20ms\)/,
    );
  });

  test("per-page OCR timeout races a hung page and rejects with its page number", async () => {
    await assert.rejects(
      withPdfPageTimeout(new Promise(() => {}), 20, 3),
      /page 3 exceeded the remaining time budget \(20ms\)/,
    );
    assert.equal(await withPdfPageTimeout(Promise.resolve("ok"), 1000, 1), "ok");
  });

  test("payload carries bd_extract.v1 structured_fields, candidate_facts untouched (W2 wiring)", async () => {
    const text = [
      "National ID No: 19901234567890123",
      "Date of Birth: 12/01/1990",
      "Invoice No: INV-77",
      "Grand Total: Tk 12,600.00",
    ].join("\n");
    const payload = await extractDocumentPayload("ids.txt", Buffer.from(text, "utf8"), undefined);
    const structured = payload.structured_fields as {
      schema_version: string;
      review_required: boolean;
      extractions: Array<{ schema: string; fields: Array<{ field: string; value: string; verification_status: string; span: { start: number; end: number }; raw: string }> }>;
    };
    assert.equal(structured.schema_version, "bd_extract.v1");
    assert.equal(structured.review_required, true);
    assert.deepEqual(structured.extractions.map((e) => e.schema).sort(), ["bd_nid", "generic_invoice"]);
    const nid = structured.extractions.find((e) => e.schema === "bd_nid")?.fields.find((f) => f.field === "nid_number");
    assert.equal(nid?.value, "19901234567890123");
    assert.equal(nid?.verification_status, "candidate_only");
    assert.equal(nid ? text.slice(nid.span.start, nid.span.end) : "", "19901234567890123");
    // Legacy sidecar keeps its own shape; NID must not leak into it.
    const facts = payload.candidate_facts as Array<{ fact_key: string; value: string }>;
    assert.ok(Array.isArray(facts));
    assert.ok(!facts.some((f) => f.value === "19901234567890123"), "PII stays out of candidate_facts");
    assert.equal(payload.file_name, "ids.txt");
  });
});

test("non-PDF payloads keep legacy shape with pages null", async () => {
  const payload = await extractDocumentPayload("note.txt", Buffer.from("hello world", "utf8"), undefined);
  assert.equal(payload.pages, null);
  assert.equal(payload.full_text_normalized, "hello world");
  assert.equal(payload.text_preview, "hello world");
  assert.equal(payload.extractable, true);
});

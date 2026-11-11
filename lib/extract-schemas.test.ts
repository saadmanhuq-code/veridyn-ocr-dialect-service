import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  EXTRACT_SCHEMA_VERSION,
  extractBdNid,
  extractBdPassport,
  extractInvoiceReceipt,
  extractStructuredFields,
  extractTradeLicence,
  type SchemaExtraction,
} from "./extract-schemas";
import { buildDocumentSchemaCandidates } from "./document-facts";

function fieldOf(extraction: SchemaExtraction, name: string) {
  return extraction.fields.find((f) => f.field === name);
}

function validationOf(extraction: { validations: Array<{ code: string; status: string }> }, code: string) {
  return extraction.validations.find((v) => v.code === code);
}

const NID_EN_17 = [
  "Government of the People's Republic of Bangladesh",
  "National ID Card",
  "Name: MD RAHIM UDDIN",
  "NID No: 19901234567890123",
  "Date of Birth: 12/01/1990",
].join("\n");

const NID_BN_10 = [
  "গণপ্রজাতন্ত্রী বাংলাদেশ সরকার",
  "জাতীয় পরিচয়পত্র",
  "নাম: মোঃ করিম আহমেদ",
  "পরিচয়পত্র নং: ১২৩৪৫৬৭৮৯০",
  "জন্ম তারিখ: ০৫/০৩/১৯৯৫",
].join("\n");

describe("bd_nid extraction", () => {
  test("17-digit English NID with consistent DOB year cross-check", () => {
    const out = extractBdNid(NID_EN_17);
    assert.equal(out.schema_version, EXTRACT_SCHEMA_VERSION);
    assert.equal(out.review_required, true);
    const nid = fieldOf(out, "nid_number");
    assert.equal(nid?.value, "19901234567890123");
    assert.equal(fieldOf(out, "nid_format")?.value, "17_digit");
    assert.equal(fieldOf(out, "date_of_birth")?.value, "1990-01-12");
    assert.equal(validationOf(out, "nid_dob_cross_check")?.status, "pass");
    assert.equal(nid?.verification_status, "candidate_only");
    // Span must address the original text exactly.
    assert.equal(nid ? NID_EN_17.slice(nid.span.start, nid.span.end) : "", "19901234567890123");
    assert.equal(nid?.raw, "19901234567890123");
  });

  test("Bengali-digit 10-digit smart NID with Bengali labels", () => {
    const out = extractBdNid(NID_BN_10);
    const nid = fieldOf(out, "nid_number");
    assert.equal(nid?.value, "1234567890");
    assert.equal(fieldOf(out, "nid_format")?.value, "10_digit");
    assert.equal(fieldOf(out, "date_of_birth")?.value, "1995-03-05");
    assert.equal(validationOf(out, "nid_dob_cross_check")?.status, "not_applicable");
    // Raw keeps the original Bengali digits; span still indexes the source.
    assert.equal(nid?.raw, "১২৩৪৫৬৭৮৯০");
    assert.equal(nid ? NID_BN_10.slice(nid.span.start, nid.span.end) : "", "১২৩৪৫৬৭৮৯০");
  });

  test("13-digit legacy NID accepted; DOB cross-check not applicable", () => {
    const out = extractBdNid("NID: 2691647112345\nDate of Birth: 03 Mar 1988");
    assert.equal(fieldOf(out, "nid_number")?.value, "2691647112345");
    assert.equal(fieldOf(out, "nid_format")?.value, "13_digit");
    assert.equal(fieldOf(out, "date_of_birth")?.value, "1988-03-03");
  });

  test("17-digit NID whose birth year disagrees with DOB fails cross-check", () => {
    const out = extractBdNid("National ID No: 19851234567890123\nDate of Birth: 12/01/1990");
    assert.equal(fieldOf(out, "nid_number")?.value, "19851234567890123");
    assert.equal(validationOf(out, "nid_dob_cross_check")?.status, "fail");
  });

  test("near-miss NID lengths are rejected (9/11/12/14/18 digits)", () => {
    for (const bad of ["123456789", "12345678901", "123456789012", "12345678901234", "123456789012345678"]) {
      const out = extractBdNid(`NID No: ${bad}`);
      assert.equal(fieldOf(out, "nid_number"), undefined, `length ${bad.length} must not extract`);
      assert.equal(validationOf(out, "nid_number_missing")?.status, "missing");
    }
  });

  test("all-same-digit filler and plain phone numbers are not NIDs", () => {
    assert.equal(fieldOf(extractBdNid("NID No: 1111111111"), "nid_number"), undefined);
    assert.equal(fieldOf(extractBdNid("Mobile: 01712345678"), "nid_number"), undefined);
    // Bare 10-digit without any NID context must stay unclaimed.
    assert.equal(fieldOf(extractBdNid("Reference 1234567890 for delivery"), "nid_number"), undefined);
  });

  test("bare 13/17-digit runs without NID context are not claimed as NIDs (integration)", () => {
    // Critic must-fix: an invoice account number must not become a bd_nid
    // extraction with a format "pass".
    assert.equal(fieldOf(extractBdNid("Invoice\nAccount: 1234567890123"), "nid_number"), undefined);
    assert.equal(fieldOf(extractBdNid("Tracking ref 19901234567890123 shipped"), "nid_number"), undefined);
    const unified = extractStructuredFields("Invoice\nAccount: 1234567890123\nTotal: Tk 500");
    assert.ok(!unified.extractions.some((e) => e.schema === "bd_nid"), "no bd_nid without context");
    // The same digits WITH document-level NID context still extract.
    assert.equal(
      fieldOf(extractBdNid("National ID holder copy\n2691647112345"), "nid_number")?.value,
      "2691647112345",
    );
  });
});

const LICENCE_BN = [
  "ঢাকা উত্তর সিটি কর্পোরেশন",
  "ট্রেড লাইসেন্স নং: TRAD/DNCC/001234/2024",
  "প্রতিষ্ঠানের নাম: রহিম ট্রেডার্স",
  "স্বত্বাধিকারী: মোঃ রহিম উদ্দিন",
  "ইস্যুর তারিখ: ০১/০৭/২০২৪",
  "মেয়াদ: ৩০/০৬/২০২৫",
].join("\n");

describe("bd_trade_licence extraction", () => {
  test("Bengali trade licence: number, proprietor, business, issue/expiry", () => {
    const out = extractTradeLicence(LICENCE_BN);
    assert.equal(fieldOf(out, "licence_number")?.value, "TRAD/DNCC/001234/2024");
    assert.equal(fieldOf(out, "proprietor_name")?.value, "মোঃ রহিম উদ্দিন");
    assert.equal(fieldOf(out, "business_name")?.value, "রহিম ট্রেডার্স");
    assert.equal(fieldOf(out, "issue_date")?.value, "2024-07-01");
    assert.equal(fieldOf(out, "expiry_date")?.value, "2025-06-30");
    assert.equal(validationOf(out, "licence_date_order")?.status, "pass");
  });

  test("English trade licence labels", () => {
    const text = [
      "Trade Licence No: DNCC-2023-778899",
      "Proprietor: Ayesha Rahman",
      "Business Name: Rahman Garments Ltd",
      "Date of Issue: 15 Jan 2024",
      "Valid Until: 14 Jan 2025",
    ].join("\n");
    const out = extractTradeLicence(text);
    assert.equal(fieldOf(out, "licence_number")?.value, "DNCC-2023-778899");
    assert.equal(fieldOf(out, "proprietor_name")?.value, "Ayesha Rahman");
    assert.equal(fieldOf(out, "issue_date")?.value, "2024-01-15");
    assert.equal(fieldOf(out, "expiry_date")?.value, "2025-01-14");
  });
});

// TD3 MRZ with ICAO 7-3-1 check digits computed for doc A01234567,
// DOB 900112, expiry 301231, filler personal number, composite digit 2.
const PASSPORT_MRZ = [
  "P<BGDRAHIM<<MD<RAHIM<UDDIN<<<<<<<<<<<<<<<<<<",
  "A012345678BGD9001125M3012316<<<<<<<<<<<<<<<2",
].join("\n");

describe("bd_passport extraction", () => {
  test("TD3 MRZ parses document number, DOB, expiry and passes check digits", () => {
    const out = extractBdPassport(PASSPORT_MRZ);
    assert.equal(fieldOf(out, "document_number")?.value, "A01234567");
    assert.equal(fieldOf(out, "date_of_birth")?.value, "1990-01-12");
    assert.equal(fieldOf(out, "expiry_date")?.value, "2030-12-31");
    assert.equal(fieldOf(out, "surname_mrz")?.value, "RAHIM");
    assert.equal(validationOf(out, "mrz_document_number_check_digit")?.status, "pass");
    assert.equal(validationOf(out, "mrz_dob_check_digit")?.status, "pass");
    assert.equal(validationOf(out, "mrz_expiry_check_digit")?.status, "pass");
    assert.equal(validationOf(out, "mrz_composite_check_digit")?.status, "pass");
  });

  test("corrupted MRZ digit fails the relevant check digit, stays candidate", () => {
    const broken = PASSPORT_MRZ.replace("A01234567", "A01234568");
    const out = extractBdPassport(broken);
    assert.equal(fieldOf(out, "document_number")?.value, "A01234568");
    assert.equal(validationOf(out, "mrz_document_number_check_digit")?.status, "fail");
    assert.equal(validationOf(out, "mrz_composite_check_digit")?.status, "fail");
  });

  test("CRLF MRZ spans address the original text exactly (integration)", () => {
    const crlf = `Bangladesh Passport\r\n${PASSPORT_MRZ.split("\n").join("\r\n")}\r\nEnd`;
    const out = extractBdPassport(crlf);
    const docField = fieldOf(out, "document_number");
    assert.equal(docField?.value, "A01234567");
    // Span covers whole MRZ line 2 without leaking leading \r\n.
    assert.equal(docField ? crlf.slice(docField.span.start, docField.span.end) : "", PASSPORT_MRZ.split("\n")[1]);
    assert.equal(docField?.raw, PASSPORT_MRZ.split("\n")[1]);
    const surname = fieldOf(out, "surname_mrz");
    assert.equal(surname ? crlf.slice(surname.span.start, surname.span.end) : "", PASSPORT_MRZ.split("\n")[0]);
  });

  test("labelled passport fallback without MRZ (Bengali label)", () => {
    const out = extractBdPassport("পাসপোর্ট নং: EA0987654\nমেয়াদ উত্তীর্ণের তারিখ: ২০/০৯/২০৩১");
    assert.equal(fieldOf(out, "document_number")?.value, "EA0987654");
    assert.equal(fieldOf(out, "expiry_date")?.value, "2031-09-20");
  });
});

const INVOICE_EN = [
  "Rahim Traders",
  "Invoice No: INV-2024-0042",
  "Invoice Date: 05/11/2024",
  "Item: Cotton fabric    1,20,000.00",
  "VAT: Tk 6,000",
  "Grand Total: ৳1,26,000.00",
  "Phone: 01712-345678",
  "Email: Sales@RahimTraders.com.bd",
].join("\n");

const RECEIPT_BN = [
  "রসিদ নং: ৪৫৬৭",
  "তারিখ: ১২ ডিসেম্বর ২০২৪",
  "চাল ৫ কেজি — ৩৫০ টাকা",
  "সর্বমোট: ৮৫০ টাকা",
  "মোবাইল: +৮৮০১৯১২৩৪৫৬৭৮",
].join("\n");

describe("generic_invoice extraction", () => {
  test("English invoice: number, date, South-Asian grouped total, phone, email", () => {
    const out = extractInvoiceReceipt(INVOICE_EN);
    assert.equal(fieldOf(out, "invoice_number")?.value, "INV-2024-0042");
    assert.equal(fieldOf(out, "invoice_date")?.value, "2024-11-05");
    assert.equal(fieldOf(out, "total_amount_bdt")?.value, "126000.00");
    assert.equal(fieldOf(out, "phone")?.value, "+8801712345678");
    assert.equal(fieldOf(out, "email")?.value, "sales@rahimtraders.com.bd");
    const amounts = out.fields.filter((f) => f.field === "amount_bdt").map((f) => f.value);
    assert.deepEqual(amounts, ["6000"]);
    // Amounts are decimal strings, never floats.
    assert.equal(typeof fieldOf(out, "total_amount_bdt")?.value, "string");
  });

  test("Bengali receipt: Bengali digits, Bengali month name, টাকা total, +880 phone", () => {
    const out = extractInvoiceReceipt(RECEIPT_BN);
    assert.equal(fieldOf(out, "invoice_number")?.value, "4567");
    assert.equal(fieldOf(out, "invoice_date")?.value, "2024-12-12");
    assert.equal(fieldOf(out, "total_amount_bdt")?.value, "850");
    assert.equal(fieldOf(out, "phone")?.value, "+8801912345678");
    const amounts = out.fields.filter((f) => f.field === "amount_bdt").map((f) => f.value);
    assert.deepEqual(amounts, ["350"]);
  });

  test("email fields are capped like amounts/phones (integration)", () => {
    const many = Array.from({ length: 12 }, (_, i) => `user${i}@example.com`).join(" ");
    const out = extractInvoiceReceipt(`Invoice No: X1\nContacts: ${many}`);
    assert.equal(out.fields.filter((f) => f.field === "email").length, 5);
  });

  test("unlabelled amounts are never promoted to a total", () => {
    const out = extractInvoiceReceipt("Paid ৳500 for delivery. Another Tk 300 later.");
    assert.equal(fieldOf(out, "total_amount_bdt"), undefined);
    assert.equal(validationOf(out, "invoice_total_missing")?.status, "missing");
    assert.deepEqual(out.fields.filter((f) => f.field === "amount_bdt").map((f) => f.value), ["500", "300"]);
  });
});

describe("extractStructuredFields + compat bridge", () => {
  test("detects the NID schema and stays candidate-only throughout", () => {
    const result = extractStructuredFields(NID_EN_17);
    assert.equal(result.schema_version, "bd_extract.v1");
    assert.equal(result.verification_status, "candidate_only");
    assert.deepEqual(result.extractions.map((e) => e.schema), ["bd_nid"]);
    for (const extraction of result.extractions) {
      assert.equal(extraction.review_required, true);
      for (const field of extraction.fields) assert.equal(field.verification_status, "candidate_only");
    }
  });

  test("trade licence text detects licence schema only", () => {
    const result = extractStructuredFields(LICENCE_BN);
    assert.deepEqual(result.extractions.map((e) => e.schema), ["bd_trade_licence"]);
  });

  test("plain narrative text detects nothing", () => {
    const result = extractStructuredFields("Workers reported overtime concerns at the factory last week.");
    assert.deepEqual(result.extractions, []);
  });

  test("document-facts compat bridge projects schema fields additively", () => {
    const rows = buildDocumentSchemaCandidates(INVOICE_EN);
    const total = rows.find((r) => r.fact_key === "generic_invoice.total_amount_bdt");
    assert.equal(total?.value, "126000.00");
    assert.equal(total?.source, "bd_extract.v1_candidate");
  });
});

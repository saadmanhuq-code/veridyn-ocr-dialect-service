/** Port of Veridyn `extract_candidate_facts_from_text` hints (deterministic regex). */

const BN_DIGIT_MAP: Record<string, string> = {
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

const BENGALI_KEYWORD_MAP: Record<string, string> = {
  ঘণ্টা: "hours",
  সপ্তাহ: "week",
  বয়স: "age",
  বছর: "years",
  নোটিশ: "notice",
  দিন: "days",
};

function normalizeIntakeText(text: string): string {
  let t = text;
  for (const [bn, digit] of Object.entries(BN_DIGIT_MAP)) {
    t = t.split(bn).join(digit);
  }
  for (const [bn, en] of Object.entries(BENGALI_KEYWORD_MAP)) {
    t = t.split(bn).join(en);
  }
  return t;
}

function humanFactLabel(factKey: string): string {
  return factKey.replace(/_/g, " ").replace("bdt", "BDT").replace("cet1", "CET1").replace(/\bhr\b/gi, "HR");
}

export function extractCandidateFactsFromText(raw: string): Record<string, string> {
  const normalized = normalizeIntakeText(raw);
  let lower = normalized.toLowerCase();
  const facts: Record<string, string> = {};

  const hoursWeek = lower.match(
    /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?).{0,40}(?:week|weekly)|(?:week|weekly).{0,40}?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/,
  );
  if (hoursWeek) facts.working_hours_per_week = hoursWeek[1] || hoursWeek[2] || "";

  const overtime = lower.match(/overtime.{0,40}?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/);
  if (overtime) facts.overtime_hours_per_day = overtime[1] || "";

  const age = lower.match(/(?:age|aged|worker is|workers are|old).{0,20}?(\d{1,2})/);
  if (age) facts.worker_age_years = age[1] || "";

  if (lower.includes("permanent")) facts.worker_type = "permanent";
  if (lower.includes("temporary")) facts.worker_type = "temporary";

  if (/(subcontract|washing|printing|embroidery)/.test(lower)) {
    facts.subcontractor_declared_and_approved =
      lower.includes("approved") && !lower.includes("not approved") ? "true" : "false";
  }

  if (/(expired fire|missing fire|fire certificate expired)/.test(lower)) {
    facts.fire_certificate_current = "false";
  } else if (lower.includes("fire certificate current") || lower.includes("valid fire certificate")) {
    facts.fire_certificate_current = "true";
  }

  if (/(late wage|missing wage|wage records late)/.test(lower)) facts.wage_records_current = "false";
  else if (lower.includes("current wage") || lower.includes("wage records current")) facts.wage_records_current = "true";

  if (/(shipment finance due|lc condition missing|payment hold)/.test(lower)) facts.lc_conditions_met = "false";
  else if (lower.includes("lc conditions met") || lower.includes("finance conditions met"))
    facts.lc_conditions_met = "true";

  if (/(missing export|customs documents missing|shipment documents incomplete)/.test(lower)) {
    facts.export_documents_complete = "false";
  }

  if (
    lower.includes("inspection certificate is missing") ||
    lower.includes("missing inspection") ||
    lower.includes("expired inspection") ||
    lower.includes("inspection certificate is not current") ||
    lower.includes("inspection certificate is not valid") ||
    lower.includes("inspection certificate expired")
  ) {
    facts.inspection_certificate_current = "false";
  } else if (
    lower.includes("inspection certificate is current") ||
    lower.includes("valid inspection certificate")
  ) {
    facts.inspection_certificate_current = "true";
  }

  if (
    lower.includes("qualified acceptance") ||
    lower.includes("acceptance is qualified") ||
    lower.includes("conditional acceptance") ||
    lower.includes("acceptance is conditional")
  ) {
    facts.acceptance_qualified = "true";
  } else if (lower.includes("unqualified acceptance") || lower.includes("acceptance is unqualified")) {
    facts.acceptance_qualified = "false";
  }

  const notice = lower.match(/(\d+)\s*(?:day|days).{0,35}notice|notice.{0,35}(\d+)\s*(?:day|days)/);
  if (notice) facts.notice_period_days = notice[1] || notice[2] || "";

  const cet1 = lower.match(/cet1[^0-9]*(\d+(?:\.\d+)?)/);
  if (cet1) facts.cet1_ratio = cet1[1] || "";

  const amount = lower.match(/(?:bdt|tk|taka)\s*(\d+(?:\.\d+)?)/);
  if (amount) facts.transaction_amount_bdt = amount[1] || "";

  if (lower.includes("not verified") || lower.includes("without verification")) facts.customer_identity_verified = "false";
  else if (lower.includes("verified")) facts.customer_identity_verified = "true";

  if (lower.includes("suspicious")) facts.suspicious_transaction_flagged = "true";
  if (lower.includes("not reported") || lower.includes("unreported")) facts.suspicious_report_filed_within_24h = "false";

  return facts;
}

export function buildDocumentFactCandidates(text: string): Array<{ fact_key: string; label: string; value: string; source: string }> {
  const facts = extractCandidateFactsFromText(text);
  return Object.entries(facts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      fact_key: key,
      label: humanFactLabel(key),
      value,
      source: "document_text_hint",
    }));
}

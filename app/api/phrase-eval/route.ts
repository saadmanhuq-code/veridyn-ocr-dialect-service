import { NextRequest, NextResponse } from "next/server";

import { requireApiKey } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { inferDialectFromText, normalizeBn, DIALECT_SUGGESTION_FLOOR } from "@/lib/dialect";

export const runtime = "nodejs";

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

/**
 * POST /api/phrase-eval
 *
 * Evaluates one or more phrases against the dialect cue catalog and returns
 * the cue-matching inference result for each phrase.  Accepts the same auth
 * posture as sibling routes (optional Bearer via VERIDYN_OCR_API_KEY).
 *
 * Request body (JSON):
 *   { "phrases": string[] }          — evaluate up to 50 phrases in one call
 *   { "phrase": string }             — shorthand for a single phrase
 *
 * Response (JSON):
 *   {
 *     "schema_version": "phrase_eval.v1",
 *     "suggestion_floor": number,
 *     "results": Array<{
 *       "phrase": string,
 *       "characters": number,
 *       "normalized": string,
 *       "evidence": DialectInference
 *     }>
 *   }
 */
export async function POST(req: NextRequest) {
  const authBlock = requireApiKey(req.headers);
  if (authBlock) {
    Object.entries(corsHeaders()).forEach(([k, v]) => authBlock.headers.set(k, v));
    return authBlock;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { detail: "Expected JSON body." },
      { status: 400, headers: corsHeaders() },
    );
  }

  // Accept either { phrase: string } or { phrases: string[] }.
  const raw = body as Record<string, unknown>;
  let phrases: string[];
  if (typeof raw.phrase === "string") {
    phrases = [raw.phrase];
  } else if (Array.isArray(raw.phrases)) {
    phrases = raw.phrases.map((p) => (typeof p === "string" ? p : String(p)));
  } else {
    return NextResponse.json(
      { detail: 'Body must contain "phrase" (string) or "phrases" (string[]).' },
      { status: 400, headers: corsHeaders() },
    );
  }

  const MAX_PHRASES = 50;
  if (phrases.length > MAX_PHRASES) {
    return NextResponse.json(
      { detail: `Too many phrases — max ${MAX_PHRASES} per request.` },
      { status: 400, headers: corsHeaders() },
    );
  }

  const results = phrases.map((phrase) => ({
    phrase,
    characters: phrase.length,
    normalized: normalizeBn(phrase),
    evidence: inferDialectFromText(phrase),
  }));

  return NextResponse.json(
    {
      schema_version: "phrase_eval.v1",
      suggestion_floor: DIALECT_SUGGESTION_FLOOR,
      results,
    },
    { headers: corsHeaders() },
  );
}

import { NextRequest, NextResponse } from "next/server";

import { requireApiKey } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { buildDocumentFactCandidates } from "@/lib/document-facts";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

/**
 * POST /api/facts/extract
 *
 * Text-only fact extraction — runs the same deterministic regex engine used by
 * POST /api/documents/extract after OCR, but accepts raw text directly so
 * callers (DataRoom, BDA, Agentic) can skip the multipart upload path when
 * they already hold the transcript.
 *
 * Auth posture: identical to sibling routes — Bearer via VERIDYN_OCR_API_KEY /
 * VERIDYN_OCR_API_KEY_NEXT. Auth FAILS CLOSED: if neither env var is set, only
 * genuine local dev passes through; any deployed environment (production or
 * preview) returns 503 until a key is configured.
 *
 * Request body (JSON):
 *   { "text": string }
 *
 * Response (JSON):
 *   {
 *     "schema_version": "facts_extract.v1",
 *     "characters": number,
 *     "candidate_facts": Array<{
 *       "fact_key": string,
 *       "label": string,
 *       "value": string,
 *       "source": string
 *     }>
 *   }
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const authBlock = requireApiKey(req.headers);
  if (authBlock) {
    Object.entries(corsHeaders(origin)).forEach(([k, v]) => authBlock.headers.set(k, v));
    return authBlock;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { detail: "Expected JSON body." },
      { status: 400, headers: corsHeaders(origin) },
    );
  }

  const raw = body as Record<string, unknown>;
  if (typeof raw.text !== "string" || !raw.text.trim()) {
    return NextResponse.json(
      { detail: 'Body must contain "text" (non-empty string).' },
      { status: 400, headers: corsHeaders(origin) },
    );
  }

  const MAX_TEXT_BYTES = 500_000; // 500 KB — same order as the 10 MB file cap
  if (Buffer.byteLength(raw.text, "utf8") > MAX_TEXT_BYTES) {
    return NextResponse.json(
      { detail: `text exceeds ${MAX_TEXT_BYTES / 1000} KB limit.` },
      { status: 400, headers: corsHeaders(origin) },
    );
  }

  const candidateFacts = buildDocumentFactCandidates(raw.text);

  return NextResponse.json(
    {
      schema_version: "facts_extract.v1",
      characters: raw.text.length,
      candidate_facts: candidateFacts,
    },
    { headers: corsHeaders(origin) },
  );
}

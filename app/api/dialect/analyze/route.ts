import { NextRequest, NextResponse } from "next/server";

import { requireApiKey, resolveConsumer, withConsumerHeader } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { JsonBodyTooLargeError, MAX_DIALECT_REQUEST_BYTES, parseLimitedJsonBody } from "@/lib/limited-json-body";
import { inferDialectFromText, MAX_DIALECT_TEXT_CHARACTERS } from "@/lib/dialect";
import { resolveDialectFromText } from "@/lib/dialect-classifier";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

/**
 * POST /api/dialect/analyze
 *
 * Body: { "text": string, "use_classifier"?: boolean }
 *
 * Default (flag absent or not strictly `true`): the historic cue-only
 * `inferDialectFromText` result — same status/label/score semantics as
 * before W1 for existing callers. With `"use_classifier": true` the
 * classifier-primary resolver runs instead (Vertex classifier with the
 * cue matcher as corroboration/fallback inside `resolveDialectFromText`).
 *
 * Response stays `dialect_cue.v1`; W1 fields (`evidence.script_mix`, and
 * on the classifier path the resolver's classifier detail) are additive.
 * Input is bounded before parsing (413 over the byte/text limits).
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const authBlock = requireApiKey(req.headers);
  if (authBlock) {
    Object.entries(corsHeaders(origin)).forEach(([k, v]) => authBlock.headers.set(k, v));
    return authBlock;
  }
  const consumer = resolveConsumer(req.headers);

  let body: unknown;
  try {
    body = await parseLimitedJsonBody(req);
  } catch (error) {
    if (error instanceof JsonBodyTooLargeError) {
      return NextResponse.json(
        { detail: `JSON body exceeds ${MAX_DIALECT_REQUEST_BYTES} bytes.` },
        { status: 413, headers: corsHeaders(origin) },
      );
    }
    return NextResponse.json({ detail: "Expected JSON body." }, { status: 400, headers: corsHeaders(origin) });
  }
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  const text = record && "text" in record ? String(record.text) : "";
  if (text.length > MAX_DIALECT_TEXT_CHARACTERS) {
    return NextResponse.json(
      { detail: `Dialect text exceeds ${MAX_DIALECT_TEXT_CHARACTERS} characters.` },
      { status: 413, headers: corsHeaders(origin) },
    );
  }
  const useClassifier = record?.use_classifier === true;
  const evidence = useClassifier ? await resolveDialectFromText(text) : inferDialectFromText(text);
  return NextResponse.json(
    {
      schema_version: "dialect_cue.v1",
      input_characters: text.length,
      evidence,
    },
    { headers: withConsumerHeader(corsHeaders(origin), consumer) },
  );
}

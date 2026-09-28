import { NextRequest, NextResponse } from "next/server";

import { requireApiKey, resolveConsumer, withConsumerHeader } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { JsonBodyTooLargeError, MAX_DIALECT_REQUEST_BYTES, parseLimitedJsonBody } from "@/lib/limited-json-body";
import { inferDialectFromText, MAX_DIALECT_TEXT_CHARACTERS } from "@/lib/dialect";

export const runtime = "nodejs";

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

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
  const text = typeof body === "object" && body && "text" in body ? String((body as { text: unknown }).text) : "";
  if (text.length > MAX_DIALECT_TEXT_CHARACTERS) {
    return NextResponse.json(
      { detail: `Dialect text exceeds ${MAX_DIALECT_TEXT_CHARACTERS} characters.` },
      { status: 413, headers: corsHeaders(origin) },
    );
  }
  const evidence = inferDialectFromText(text);
  return NextResponse.json(
    {
      schema_version: "dialect_cue.v1",
      input_characters: text.length,
      evidence,
    },
    { headers: withConsumerHeader(corsHeaders(origin), consumer) },
  );
}

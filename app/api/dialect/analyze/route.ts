import { NextRequest, NextResponse } from "next/server";

import { requireApiKey } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { inferDialectFromText } from "@/lib/dialect";

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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ detail: "Expected JSON body." }, { status: 400, headers: corsHeaders(origin) });
  }
  const text = typeof body === "object" && body && "text" in body ? String((body as { text: unknown }).text) : "";
  const evidence = inferDialectFromText(text);
  return NextResponse.json(
    {
      schema_version: "dialect_cue.v1",
      input_characters: text.length,
      evidence,
    },
    { headers: corsHeaders(origin) },
  );
}

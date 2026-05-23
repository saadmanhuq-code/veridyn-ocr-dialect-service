import { NextRequest, NextResponse } from "next/server";

import { requireApiKey } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { DocumentIntakeError, extractDocumentPayload } from "@/lib/extract-document";

export const runtime = "nodejs";
export const maxDuration = 60;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const authBlock = requireApiKey(req.headers);
  if (authBlock) {
    Object.entries(corsHeaders()).forEach(([k, v]) => authBlock.headers.set(k, v));
    return authBlock;
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ detail: "Expected multipart/form-data." }, { status: 400, headers: corsHeaders() });
  }

  const raw = formData.get("file");
  const languageRaw = formData.get("language");
  const language = typeof languageRaw === "string" ? languageRaw : undefined;

  if (!(raw instanceof File)) {
    return NextResponse.json({ detail: "Missing form field file." }, { status: 400, headers: corsHeaders() });
  }

  const arrayBuf = await raw.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  try {
    const payload = await extractDocumentPayload(raw.name || "upload", buffer, language);
    return NextResponse.json(payload, { headers: corsHeaders() });
  } catch (e) {
    if (e instanceof DocumentIntakeError) {
      return NextResponse.json({ detail: e.message }, { status: 400, headers: corsHeaders() });
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[extract]", msg);
    return NextResponse.json({ detail: msg }, { status: 500, headers: corsHeaders() });
  }
}

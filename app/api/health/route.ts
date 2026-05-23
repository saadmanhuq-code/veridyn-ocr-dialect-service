import { NextResponse } from "next/server";

import { corsHeaders } from "@/lib/cors";

export const runtime = "nodejs";

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export function GET() {
  return NextResponse.json({ ok: true }, { headers: corsHeaders() });
}

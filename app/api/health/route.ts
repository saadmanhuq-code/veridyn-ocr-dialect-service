import { NextRequest, NextResponse } from "next/server";

import { corsHeaders } from "@/lib/cors";
import { getOcrWorker } from "@/lib/ocr-engine";
import { isGeminiVisionEnabled, isOpenRouterVisionEnabled } from "@/lib/vision-ocr";

export const runtime = "nodejs";
export const maxDuration = 60;

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  let ocrWarm: string | undefined;
  if (req.nextUrl.searchParams.get("warm") === "ocr") {
    try {
      if (process.env.VERCEL && !isGeminiVisionEnabled() && !isOpenRouterVisionEnabled()) {
        ocrWarm = "vision_keys_required";
      } else if ((isGeminiVisionEnabled() || isOpenRouterVisionEnabled()) && process.env.VERCEL) {
        ocrWarm = "vision_ready";
      } else {
        await getOcrWorker();
        ocrWarm = "ready";
      }
    } catch (e) {
      ocrWarm = e instanceof Error ? e.message : "failed";
    }
  }
  return NextResponse.json({ ok: true, ...(ocrWarm ? { ocr_warm: ocrWarm } : {}) }, { headers: corsHeaders(origin) });
}

import { NextRequest, NextResponse } from "next/server";

import { corsHeaders } from "@/lib/cors";
import { getOcrWorker } from "@/lib/ocr-engine";
import { isGeminiVisionEnabled, isOpenRouterVisionEnabled } from "@/lib/vision-ocr";
import pkg from "@/package.json";

export const runtime = "nodejs";
export const maxDuration = 60;

// Deploy-identity binding: lets a caller (or the orchestrator's remote-truth
// probes) confirm WHICH build is actually serving traffic, not just that
// *some* build responds 200. runtime_sha is null outside Vercel (local dev).
const CONTRACT_VERSION = pkg.version;

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
  const runtimeSha = process.env.VERCEL_GIT_COMMIT_SHA || null;
  return NextResponse.json(
    {
      ok: true,
      runtime_sha: runtimeSha,
      commit_sha: runtimeSha,
      contract_version: CONTRACT_VERSION,
      ...(ocrWarm ? { ocr_warm: ocrWarm } : {}),
    },
    { headers: corsHeaders(origin) },
  );
}

import { NextRequest, NextResponse } from "next/server";

import { BUILD_COMMIT_SHA } from "@/lib/generated-build-info";
import { corsHeaders } from "@/lib/cors";
import { getOcrWorker } from "@/lib/ocr-engine";
import { isGeminiVisionEnabled, isOpenRouterVisionEnabled } from "@/lib/vision-ocr";
import pkg from "@/package.json";

export const runtime = "nodejs";
export const maxDuration = 60;

// Deploy-identity binding: lets a caller (or the orchestrator's remote-truth
// probes) confirm WHICH build is actually serving traffic, not just that
// *some* build responds 200. The generated fallback is captured before every
// build/test/typecheck and makes missing deploy identity a build failure.
const CONTRACT_VERSION = pkg.version;

/**
 * Resolve the deployed commit SHA a remote-truth probe can trust.
 *
 * Priority: `VERCEL_GIT_COMMIT_SHA` (set by Vercel at build AND, when the
 * project has "Automatically expose System Environment Variables" enabled,
 * at runtime too) -> `GIT_COMMIT_SHA` (a plain build-time env var for
 * non-Vercel hosts, e.g. the Docker deployment on Oracle VM3, where an
 * operator can inject the CI commit SHA at image-build time) ->
 * `BUILD_COMMIT_SHA` (baked into the bundle by scripts/generate-build-info.mjs
 * from local git/CI env at build time) -> the literal string `"unknown"`.
 *
 * `"unknown"` is returned only when every candidate is empty/unset, so a
 * probe always sees an explicit, machine-checkable value instead of a
 * missing field or an empty string.
 */
export function resolveRuntimeSha(
  candidates: Array<string | null | undefined>,
): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return "unknown";
}

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
  const runtimeSha = resolveRuntimeSha([
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.GIT_COMMIT_SHA,
    BUILD_COMMIT_SHA,
  ]);
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

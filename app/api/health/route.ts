import { NextRequest, NextResponse } from "next/server";

import { BUILD_COMMIT_SHA } from "@/lib/generated-build-info";
import { corsHeaders } from "@/lib/cors";
import { requireApiKey } from "@/lib/auth";
import { resolveBuildIdentity } from "@/lib/health-identity";
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

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  let ocrWarm: string | undefined;
  if (req.nextUrl.searchParams.get("warm") === "ocr") {
    const authBlock = requireApiKey(req.headers);
    if (authBlock) {
      Object.entries(corsHeaders(origin)).forEach(([key, value]) => authBlock.headers.set(key, value));
      return authBlock;
    }
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
  // Build identity via env chain (lib/health-identity.ts): Vercel CLI
  // deploys leave VERCEL_GIT_COMMIT_SHA unset, so fall back to operator- or
  // CI-injected SHA vars, then the generated BUILD_COMMIT_SHA baked in at
  // build time — a built artifact therefore never reports a null SHA.
  // runtime_sha/commit_sha keep their existing shape; `build` is additive.
  const build = resolveBuildIdentity({
    ...process.env,
    BUILD_COMMIT_SHA: process.env.BUILD_COMMIT_SHA?.trim() || BUILD_COMMIT_SHA,
  });
  const runtimeSha = build.commit_sha;
  return NextResponse.json(
    {
      ok: true,
      runtime_sha: runtimeSha,
      commit_sha: runtimeSha,
      contract_version: CONTRACT_VERSION,
      build: {
        commit_sha: build.commit_sha,
        sha_source: build.sha_source,
        vercel_env: process.env.VERCEL_ENV || null,
        deployment_id: process.env.VERCEL_DEPLOYMENT_ID || null,
      },
      ...(ocrWarm ? { ocr_warm: ocrWarm } : {}),
    },
    { headers: corsHeaders(origin) },
  );
}

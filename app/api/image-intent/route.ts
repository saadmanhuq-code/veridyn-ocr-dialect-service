/**
 * POST /api/image-intent
 *
 * Accepts multipart/form-data with a single image file.
 *
 * Multipart fields:
 *   image (File)         — required; image/jpeg | image/png | image/webp; ≤4 MB
 *   product (string)     — optional; calling product tag for corpus log
 *   region (string)      — optional; user-declared region
 *
 * Auth / CORS: identical to /api/documents/extract.
 *
 * Response (success):
 *   ImageIntentResult (schema_version: "image_intent.v1")
 *
 * Response (no vendor key):
 *   { fallback: true, detail: "No vision provider configured" }  HTTP 200
 *   (never 500 on missing vendor — same contract as extract endpoint)
 *
 * Response (no key AND Vercel env detected):
 *   { detail: "...", vision_keys_required: true }  HTTP 503
 *   (matches ocrImageViaBestVision behavior on Vercel with no keys)
 */

import { NextRequest, NextResponse } from "next/server";

import { requireApiKey } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { analyzeImageIntent } from "@/lib/image-intent";
import { appendCorpusEvent, contentHash } from "@/lib/corpus-log";

export const runtime = "nodejs";
export const maxDuration = 60;

const IMAGE_SIZE_LIMIT = 4 * 1024 * 1024; // 4 MB

const ACCEPTED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

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

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { detail: "Expected multipart/form-data." },
      { status: 400, headers: corsHeaders(origin) },
    );
  }

  const raw = formData.get("image");
  if (!(raw instanceof File)) {
    return NextResponse.json(
      { detail: "Missing form field: image (File)." },
      { status: 400, headers: corsHeaders(origin) },
    );
  }

  const mimeType = raw.type?.toLowerCase().split(";")[0].trim() || "image/jpeg";
  if (!ACCEPTED_IMAGE_MIME.has(mimeType)) {
    return NextResponse.json(
      {
        detail: `Unsupported image type: ${mimeType}. Accepted: ${[...ACCEPTED_IMAGE_MIME].join(", ")}.`,
      },
      { status: 415, headers: corsHeaders(origin) },
    );
  }

  if (raw.size > IMAGE_SIZE_LIMIT) {
    return NextResponse.json(
      { detail: `Image too large — max ${IMAGE_SIZE_LIMIT / 1024 / 1024} MB.` },
      { status: 413, headers: corsHeaders(origin) },
    );
  }

  const product =
    typeof formData.get("product") === "string" ? String(formData.get("product")) : undefined;
  const region =
    typeof formData.get("region") === "string" ? String(formData.get("region")) : undefined;

  const imageBytes = Buffer.from(await raw.arrayBuffer());

  const result = await analyzeImageIntent(imageBytes);

  if (!result) {
    // No provider available
    if (process.env.VERCEL) {
      return NextResponse.json(
        {
          detail:
            "Image intent unavailable on Vercel — no vision API keys configured. Set GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_AI_STUDIO_KEY or OPENROUTER_API_KEY.",
          vision_keys_required: true,
        },
        { status: 503, headers: corsHeaders(origin) },
      );
    }
    return NextResponse.json(
      { fallback: true, detail: "No vision provider configured" },
      { headers: corsHeaders(origin) },
    );
  }

  // Corpus log (fire-and-forget)
  appendCorpusEvent({
    event_type: "image_intent",
    image_sha256: contentHash(imageBytes),
    language: result.language,
    intent_category: result.category_hints[0],
    product,
    region,
    consent: true,
  });

  return NextResponse.json(result, { headers: corsHeaders(origin) });
}

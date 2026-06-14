/**
 * POST /api/voice/transcribe
 *
 * Accepts multipart/form-data OR base64 JSON.
 *
 * Multipart fields:
 *   audio (File)         — required; audio/webm | audio/ogg | audio/m4a | audio/wav | audio/mpeg
 *   product (string)     — optional; calling product tag for corpus log (e.g. "khep", "bda")
 *   region (string)      — optional; user-declared region for corpus log
 *
 * JSON body alternative:
 *   { audio_base64: string, mime_type: string, product?: string, region?: string }
 *
 * Response (success):
 *   {
 *     transcript_raw: string,
 *     transcript_bn: string,        // normalised (bn digits → ASCII, danda → period)
 *     language: "bn" | "en" | "mixed" | "unknown",
 *     dialect: DialectInference,    // includes optional classifier/cue corroboration metadata
 *     stt_provenance: { provider: string, model: string, latency_ms: number },
 *     fallback: false
 *   }
 *
 * Response (no vendor key):
 *   { fallback: true }
 *
 * Limits: ≤8 MB audio, accepted mime types listed above.
 * Auth: requireApiKey (Bearer; fails closed when keys are unset in production).
 * CORS: corsHeaders() standard.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireApiKey } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";
import { transcribeViaBest } from "@/lib/audio-stt";
import { normaliseBn, tagScriptMix } from "@/lib/bn-normalize";
import { resolveDialectFromText } from "@/lib/dialect-classifier";
import { appendCorpusEvent, contentHash, dialectCorpusFields } from "@/lib/corpus-log";

export const runtime = "nodejs";
export const maxDuration = 60;

const AUDIO_SIZE_LIMIT = 8 * 1024 * 1024; // 8 MB

const ACCEPTED_MIME = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
]);

function coerceMime(raw: string): string {
  const lower = raw.toLowerCase().split(";")[0].trim();
  // audio/wav variants
  if (lower === "audio/wave" || lower === "audio/x-wav") return "audio/wav";
  return lower;
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: NextRequest) {
  const authBlock = requireApiKey(req.headers);
  if (authBlock) {
    Object.entries(corsHeaders()).forEach(([k, v]) => authBlock.headers.set(k, v));
    return authBlock;
  }

  let audioBytes: Buffer;
  let mimeType: string;
  let product: string | undefined;
  let region: string | undefined;

  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    // --- multipart ---
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { detail: "Expected multipart/form-data." },
        { status: 400, headers: corsHeaders() },
      );
    }

    const raw = formData.get("audio");
    if (!(raw instanceof File)) {
      return NextResponse.json(
        { detail: "Missing form field: audio (File)." },
        { status: 400, headers: corsHeaders() },
      );
    }

    if (raw.size > AUDIO_SIZE_LIMIT) {
      return NextResponse.json(
        { detail: `Audio too large — max ${AUDIO_SIZE_LIMIT / 1024 / 1024} MB.` },
        { status: 413, headers: corsHeaders() },
      );
    }

    mimeType = coerceMime(raw.type || "audio/webm");
    if (!ACCEPTED_MIME.has(mimeType)) {
      return NextResponse.json(
        { detail: `Unsupported mime type: ${mimeType}. Accepted: ${[...ACCEPTED_MIME].join(", ")}.` },
        { status: 415, headers: corsHeaders() },
      );
    }

    audioBytes = Buffer.from(await raw.arrayBuffer());
    product = typeof formData.get("product") === "string"
      ? String(formData.get("product"))
      : undefined;
    region = typeof formData.get("region") === "string"
      ? String(formData.get("region"))
      : undefined;
  } else {
    // --- JSON base64 ---
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { detail: "Expected multipart/form-data or JSON { audio_base64, mime_type }." },
        { status: 400, headers: corsHeaders() },
      );
    }

    const b = body as Record<string, unknown>;
    if (typeof b.audio_base64 !== "string" || !b.audio_base64) {
      return NextResponse.json(
        { detail: "JSON body must include audio_base64 (string)." },
        { status: 400, headers: corsHeaders() },
      );
    }

    mimeType = coerceMime(
      typeof b.mime_type === "string" ? b.mime_type : "audio/webm",
    );
    if (!ACCEPTED_MIME.has(mimeType)) {
      return NextResponse.json(
        { detail: `Unsupported mime type: ${mimeType}.` },
        { status: 415, headers: corsHeaders() },
      );
    }

    audioBytes = Buffer.from(b.audio_base64, "base64");
    if (audioBytes.length > AUDIO_SIZE_LIMIT) {
      return NextResponse.json(
        { detail: `Audio too large — max ${AUDIO_SIZE_LIMIT / 1024 / 1024} MB.` },
        { status: 413, headers: corsHeaders() },
      );
    }
    product = typeof b.product === "string" ? b.product : undefined;
    region = typeof b.region === "string" ? b.region : undefined;
  }

  // --- STT ---
  const sttResult = await transcribeViaBest(audioBytes, mimeType);

  if ("fallback" in sttResult && sttResult.fallback) {
    return NextResponse.json({ fallback: true }, { headers: corsHeaders() });
  }

  const result = sttResult as Exclude<typeof sttResult, { fallback: true }>;
  const transcriptRaw = result.transcript;
  const transcriptBn = normaliseBn(transcriptRaw);
  const language = tagScriptMix(transcriptBn);
  const dialect = await resolveDialectFromText(transcriptBn);

  // --- Corpus log (fire-and-forget) ---
  appendCorpusEvent({
    event_type: "transcribe",
    audio_sha256: contentHash(audioBytes),
    transcript: transcriptBn,
    language,
    ...dialectCorpusFields(dialect),
    product,
    region,
    stt_provider: result.provider,
    consent: true, // operator context; user consent UI is a Slice-2 requirement
  });

  return NextResponse.json(
    {
      transcript_raw: transcriptRaw,
      transcript_bn: transcriptBn,
      language,
      dialect,
      stt_provenance: {
        provider: result.provider,
        model: result.model,
        latency_ms: result.latency_ms,
      },
      fallback: false,
    },
    { headers: corsHeaders() },
  );
}

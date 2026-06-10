/**
 * Audio Speech-to-Text — Veridyn OCR Dialect Service.
 *
 * PRIMARY:  Gemini generateContent, audio inline_data (identical call shape to
 *           ocrImageViaGeminiStudio in lib/vision-ocr.ts).
 * FALLBACK: OpenRouter google/gemini-2.5-flash with input_audio content part.
 *           EXPERIMENTAL — OpenRouter audio-input is model-dependent and
 *           unproven in this stack. Marked accordingly; drop if smoke fails.
 *
 * If NO key is present → { fallback: true } (Khep's exact contract).
 * Never throws on a missing vendor — only on a confirmed API error.
 *
 * Env:
 *   VERIDYN_STT_MODEL         — Gemini STT model (default "gemini-2.0-flash")
 *   GOOGLE_AI_STUDIO_KEY | GEMINI_API_KEY | GOOGLE_CLOUD_VISION_API_KEY
 *   OPENROUTER_API_KEY
 */

export interface SttResult {
  transcript: string;
  provider: string;
  model: string;
  latency_ms: number;
}

export interface SttFallback {
  fallback: true;
}

export type SttOutcome = SttResult | SttFallback;

// ---------------------------------------------------------------------------
// Key resolution (mirrors vision-ocr.ts:143-148)
// ---------------------------------------------------------------------------

function geminiApiKey(): string | null {
  return (
    process.env.GOOGLE_AI_STUDIO_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim() ||
    null
  );
}

function openRouterApiKey(): string | null {
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

export function isGeminiSttEnabled(): boolean {
  return geminiApiKey() !== null;
}

export function isOpenRouterSttEnabled(): boolean {
  return openRouterApiKey() !== null;
}

// ---------------------------------------------------------------------------
// PRIMARY: Gemini inline_data STT
// ---------------------------------------------------------------------------

/**
 * Transcribe audio via Gemini generateContent (inline_data).
 * Call shape is identical to ocrImageViaGeminiStudio; audio mime instead of image.
 */
export async function transcribeViaGeminiStudio(
  audioBytes: Buffer,
  mimeType: string,
): Promise<SttResult> {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error("Gemini API key is not configured");

  const b64 = audioBytes.toString("base64");
  const model = process.env.VERIDYN_STT_MODEL?.trim() || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: "Transcribe all speech in this audio exactly as spoken. Return only the raw transcript text — no commentary, no timestamps, no speaker labels. Preserve Bengali script as-is.",
            },
            { inline_data: { mime_type: mimeType, data: b64 } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(55_000),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini STT HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };

  const transcript = (
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join(" ") ?? ""
  )
    .replace(/\s+/g, " ")
    .trim();

  return {
    transcript,
    provider: "gemini",
    model,
    latency_ms: Date.now() - t0,
  };
}

// ---------------------------------------------------------------------------
// FALLBACK: OpenRouter input_audio (EXPERIMENTAL)
// ---------------------------------------------------------------------------

/**
 * Transcribe audio via OpenRouter chat/completions with input_audio content part.
 *
 * EXPERIMENTAL: OpenRouter audio-input is model-dependent. This path is only
 * reached when OPENROUTER_API_KEY is set AND Gemini fails or is absent.
 * A smoke test during S1-0 validates whether this fallback actually works;
 * drop it from production routing if the test fails — do not fake redundancy.
 */
export async function transcribeViaOpenRouter(
  audioBytes: Buffer,
  mimeType: string,
): Promise<SttResult> {
  const apiKey = openRouterApiKey();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const b64 = audioBytes.toString("base64");
  // Use the same Gemini-family slug that Khep uses for multimodal
  const model = "google/gemini-2.5-flash";
  const t0 = Date.now();

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://veridyn-ocr-dialect-service.vercel.app",
      "X-Title": "Veridyn OCR Dialect Service STT",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe all speech in this audio exactly as spoken. Return only the raw transcript text — no commentary, no timestamps, no speaker labels. Preserve Bengali script as-is.",
            },
            {
              type: "input_audio",
              input_audio: {
                data: b64,
                format: mimeType.split("/")[1] || "wav",
              },
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(55_000),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      detail = err.error?.message ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(`OpenRouter STT HTTP ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const transcript = (data.choices?.[0]?.message?.content ?? "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    transcript,
    provider: "openrouter_experimental",
    model,
    latency_ms: Date.now() - t0,
  };
}

// ---------------------------------------------------------------------------
// DISPATCHER: mirrors ocrImageViaBestVision semantics
// ---------------------------------------------------------------------------

/**
 * Attempt STT with the best available provider.
 *
 * Priority: Gemini → OpenRouter (experimental) → { fallback: true }
 *
 * Never throws on missing vendor. Returns { fallback: true } when no key is
 * reachable, matching Khep's exact degradation contract.
 */
export async function transcribeViaBest(
  audioBytes: Buffer,
  mimeType: string,
): Promise<SttOutcome> {
  const errors: string[] = [];

  if (isGeminiSttEnabled()) {
    try {
      return await transcribeViaGeminiStudio(audioBytes, mimeType);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (isOpenRouterSttEnabled()) {
    try {
      return await transcribeViaOpenRouter(audioBytes, mimeType);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  // No working provider — return fallback contract (never 500 on missing vendor)
  console.warn("[audio-stt] No STT provider available:", errors.join("; ") || "no keys set");
  return { fallback: true };
}

/** Fast image OCR on Vercel — Vertex / Gemini / OpenRouter / Cloud Vision; local dev uses tesseract. */

import { generateViaVertex, isVertexGeminiEnabled } from "./vertex-gemini";

export const DEFAULT_OPENROUTER_OCR_MODELS = [
  "xiaomi/mimo-v2.5",
  "qwen/qwen3-vl-8b-instruct",
  "qwen/qwen3-vl-30b-a3b-instruct",
] as const;

export const OPENROUTER_VISION_MODEL_TIMEOUT_MS = 18_000;
export const OPENROUTER_VISION_CHAIN_TIMEOUT_MS = 54_000;

function parseModelList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
}

function uniqueModels(models: readonly string[]): string[] {
  return [...new Set(models)];
}

export function openRouterVisionModelsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const configuredModels = parseModelList(env.OPENROUTER_OCR_MODELS);
  if (configuredModels.length > 0) return uniqueModels(configuredModels);

  const legacyModel = env.OPENROUTER_OCR_MODEL?.trim();
  if (legacyModel) return uniqueModels([legacyModel, ...DEFAULT_OPENROUTER_OCR_MODELS]);

  return [...DEFAULT_OPENROUTER_OCR_MODELS];
}

function mimeFromBuffer(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  return "image/png";
}

function estimatedConfidenceFromVertexCandidate(
  text: string,
  candidate: { finishReason?: string; safetyRatings?: Array<{ blocked?: boolean }> } | undefined,
): number {
  const blocked = candidate?.safetyRatings?.some((r) => r.blocked) ?? false;
  const finishedNormally =
    !candidate?.finishReason || candidate.finishReason === "STOP";
  const charRatio = text.length > 0 ? Math.min(1, text.replace(/\s/g, "").length / text.length + 0.5) : 0;
  return blocked || !finishedNormally ? 0.1 : text ? Math.round(charRatio * 100) / 100 : 0.1;
}

export async function ocrImageViaVertex(
  imageBytes: Buffer,
): Promise<{ text: string; confidence: number }> {
  const b64 = imageBytes.toString("base64");
  const mime = mimeFromBuffer(imageBytes);
  const { data } = await generateViaVertex([
    { text: "Extract every line of text from this trade licence or certificate. Return plain text only." },
    { inline_data: { mime_type: mime, data: b64 } },
  ]);

  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts?.map((p) => p.text ?? "").join("\n") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return { text, confidence: estimatedConfidenceFromVertexCandidate(text, candidate) };
}

async function ocrImageViaGeminiStudio(
  imageBytes: Buffer,
): Promise<{ text: string; confidence: number }> {
  const apiKey =
    process.env.GOOGLE_AI_STUDIO_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim();
  if (!apiKey) throw new Error("Gemini API key is not configured");

  const b64 = imageBytes.toString("base64");
  const mime = mimeFromBuffer(imageBytes);
  const model = process.env.GEMINI_OCR_MODEL?.trim() || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: "Extract every line of text from this trade licence or certificate. Return plain text only." },
            { inline_data: { mime_type: mime, data: b64 } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(55_000),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini vision HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
      safetyRatings?: Array<{ blocked?: boolean }>;
    }>;
  };
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts?.map((p) => p.text ?? "").join("\n") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  // estimated_confidence: heuristic proxy — not a calibrated OCR score.
  // Penalise safety blocks and empty output; scale by non-whitespace character ratio.
  return { text, confidence: estimatedConfidenceFromVertexCandidate(text, candidate) };
}

function openRouterVisionContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const item = part as { type?: string; text?: string };
      return item.type === "text" && item.text ? item.text : "";
    })
    .join("\n");
}

function formatOpenRouterChainError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function runOpenRouterVisionModelChain<T>(
  label: string,
  runModel: (model: string, timeoutMs: number) => Promise<T>,
): Promise<T> {
  const errors: string[] = [];
  const deadlineMs = Date.now() + OPENROUTER_VISION_CHAIN_TIMEOUT_MS;

  for (const model of openRouterVisionModelsFromEnv()) {
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      errors.push(`${model}: skipped because ${label} exceeded ${OPENROUTER_VISION_CHAIN_TIMEOUT_MS}ms chain budget`);
      continue;
    }

    try {
      return await runModel(model, Math.min(OPENROUTER_VISION_MODEL_TIMEOUT_MS, remainingMs));
    } catch (error) {
      errors.push(`${model}: ${formatOpenRouterChainError(error)}`);
    }
  }

  throw new Error(`${label} failed for all configured models: ${errors.join("; ")}`);
}

export async function openRouterVisionCompletionForModel(params: {
  imageBytes: Buffer;
  model: string;
  prompt: string;
  title: string;
  maxTokens: number;
  timeoutMs?: number;
}): Promise<{ content: string; latency_ms: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const b64 = params.imageBytes.toString("base64");
  const mime = mimeFromBuffer(params.imageBytes);
  const t0 = Date.now();

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://veridyn-ocr-dialect-service.vercel.app",
      "X-Title": params.title,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0,
      max_tokens: params.maxTokens,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: params.prompt },
            {
              type: "image_url",
              image_url: { url: `data:${mime};base64,${b64}` },
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(params.timeoutMs ?? OPENROUTER_VISION_MODEL_TIMEOUT_MS),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      detail = err.error?.message ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  return {
    content: openRouterVisionContentToText(data.choices?.[0]?.message?.content).trim(),
    latency_ms: Date.now() - t0,
  };
}

export async function ocrImageViaOpenRouter(
  imageBytes: Buffer,
  languageHint: string | null | undefined,
): Promise<{ text: string; confidence: number; model: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const langNote =
    languageHint?.toLowerCase().includes("ben") || languageHint?.toLowerCase().includes("bn")
      ? "The document may include Bengali (Bangla) and English text."
      : "The document may include English and Bengali (Bangla) text.";
  const prompt = `Extract every line of text from this trade licence / certificate scan. ${langNote} Return plain text only — no markdown, no commentary.`;

  return runOpenRouterVisionModelChain("OpenRouter vision OCR", async (model, timeoutMs) => {
    const completion = await openRouterVisionCompletionForModel({
      imageBytes,
      model,
      prompt,
      title: "Veridyn OCR Dialect Service",
      maxTokens: 1200,
      timeoutMs,
    });
    const text = completion.content.replace(/\s+/g, " ").trim();
    if (!text) {
      throw new Error("empty OCR text");
    }
    // estimated_confidence: heuristic proxy — not a calibrated OCR score.
    // Scale by non-whitespace character ratio; 0.1 for empty output.
    const charRatioOR = text.length > 0 ? Math.min(1, text.replace(/\s/g, "").length / text.length + 0.5) : 0;
    const estimatedConfidenceOR = text ? Math.round(charRatioOR * 100) / 100 : 0.1;
    return { text, confidence: estimatedConfidenceOR, model };
  });
}

export function isOpenRouterVisionEnabled(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export function isVertexVisionEnabled(): boolean {
  return isVertexGeminiEnabled();
}

export function isGeminiVisionEnabled(): boolean {
  return Boolean(
    process.env.GOOGLE_AI_STUDIO_KEY?.trim() ||
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim(),
  );
}

export async function ocrImageViaBestVision(
  imageBytes: Buffer,
  languageHint: string | null | undefined,
): Promise<{ text: string; confidence: number; engine: string }> {
  const errors: string[] = [];
  if (isVertexVisionEnabled()) {
    try {
      const v = await ocrImageViaVertex(imageBytes);
      return { ...v, engine: "vertex_vision" };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (isGeminiVisionEnabled()) {
    try {
      const g = await ocrImageViaGeminiStudio(imageBytes);
      return { ...g, engine: "gemini_vision" };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (isOpenRouterVisionEnabled()) {
    try {
      const o = await ocrImageViaOpenRouter(imageBytes, languageHint);
      return { ...o, engine: `openrouter_vision:${o.model}` };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (process.env.VERCEL) {
    throw new Error(
      `Image OCR unavailable on Vercel (${errors.join("; ") || "no vision API keys"}). Set GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_AI_STUDIO_KEY or OPENROUTER_API_KEY with credits.`,
    );
  }
  throw new Error(errors.join("; ") || "No vision OCR provider configured");
}

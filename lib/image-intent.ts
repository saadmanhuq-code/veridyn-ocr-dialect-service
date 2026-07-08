/**
 * Image intent analysis — uses the same Vertex → Gemini → OpenRouter priority
 * as the best-vision dispatcher, with an intent-specific prompt.
 *
 * Mirrors the vision provider availability checks from lib/vision-ocr.ts.
 * Returns structured JSON describing what the image shows / what is wanted.
 * Model: VERTEX_MODEL for Vertex; VERIDYN_IMAGE_INTENT_MODEL for AI Studio.
 *
 * One JSON-repair retry on malformed model output before returning null.
 *
 * Response schema: image_intent.v1
 */

import { generateViaVertex, isVertexGeminiEnabled } from "./vertex-gemini";
import {
  isGeminiVisionEnabled,
  isOpenRouterVisionEnabled,
  openRouterVisionCompletionForModel,
  runOpenRouterVisionModelChain,
} from "./vision-ocr";

export interface ImageIntentResult {
  object_label: string;
  scene: string;
  intent_guess: string;
  text_in_image: string;
  language: string;
  category_hints: string[];
  condition_hints: string[];
  confidence: number;
  provenance: {
    provider: string;
    model: string;
    latency_ms: number;
    schema_version: "image_intent.v1";
  };
}

const INTENT_PROMPT = `Analyze this image and return a JSON object with exactly these fields:
{
  "object_label": "brief label for the main object or subject (string)",
  "scene": "short description of the overall scene (string)",
  "intent_guess": "what is this / what is wanted — most likely purpose or request (string)",
  "text_in_image": "any text visible in the image, verbatim (string, empty string if none)",
  "language": "primary language of text in image, e.g. bn, en, mixed, none (string)",
  "category_hints": ["up to 3 category tags, e.g. vehicle, document, food (string array)"],
  "condition_hints": ["up to 3 condition tags, e.g. new, used, damaged (string array)"],
  "confidence": 0.0 to 1.0 float reflecting your certainty
}
Return ONLY the JSON object — no markdown fences, no commentary.`;

function geminiApiKey(): string | null {
  return (
    process.env.GOOGLE_AI_STUDIO_KEY?.trim() ||
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_CLOUD_VISION_API_KEY?.trim() ||
    null
  );
}

function mimeFromBuffer(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp"; // RIFF prefix for some webp
  if (buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "image/jpeg"; // safe default for photos
}

/** Attempt to extract a JSON object from a possibly-dirty model output string. */
function parseJsonField(raw: string): Record<string, unknown> | null {
  // direct parse
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // strip markdown fences and retry (one repair attempt)
    const stripped = raw.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      return JSON.parse(stripped) as Record<string, unknown>;
    } catch {
      // extract first {...} block
      const match = stripped.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}

function coerceResult(
  parsed: Record<string, unknown>,
  provider: string,
  model: string,
  latency_ms: number,
): ImageIntentResult {
  const str = (v: unknown, fallback = ""): string =>
    typeof v === "string" ? v : fallback;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)) : [];
  const num = (v: unknown, fallback = 0.5): number =>
    typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;

  return {
    object_label: str(parsed.object_label, "unknown"),
    scene: str(parsed.scene),
    intent_guess: str(parsed.intent_guess),
    text_in_image: str(parsed.text_in_image),
    language: str(parsed.language, "unknown"),
    category_hints: arr(parsed.category_hints),
    condition_hints: arr(parsed.condition_hints),
    confidence: num(parsed.confidence),
    provenance: {
      provider,
      model,
      latency_ms,
      schema_version: "image_intent.v1",
    },
  };
}

async function intentViaGemini(imageBytes: Buffer): Promise<ImageIntentResult> {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error("Gemini API key is not configured");

  const b64 = imageBytes.toString("base64");
  const mime = mimeFromBuffer(imageBytes);
  const model =
    process.env.VERIDYN_IMAGE_INTENT_MODEL?.trim() || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const t0 = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: INTENT_PROMPT },
            { inline_data: { mime_type: mime, data: b64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
    signal: AbortSignal.timeout(55_000),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini intent HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const raw = (
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? ""
  ).trim();

  const parsed = parseJsonField(raw);
  if (!parsed) {
    throw new Error(`Gemini intent: could not parse JSON from response: ${raw.slice(0, 200)}`);
  }

  return coerceResult(parsed, "gemini", model, Date.now() - t0);
}

async function intentViaVertex(imageBytes: Buffer): Promise<ImageIntentResult> {
  const b64 = imageBytes.toString("base64");
  const mime = mimeFromBuffer(imageBytes);
  const { data, model, latency_ms } = await generateViaVertex(
    [
      { text: INTENT_PROMPT },
      { inline_data: { mime_type: mime, data: b64 } },
    ],
    { generationConfig: { temperature: 0, responseMimeType: "application/json" } },
  );

  const raw = (
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? ""
  ).trim();

  const parsed = parseJsonField(raw);
  if (!parsed) {
    throw new Error(`Vertex intent: could not parse JSON from response: ${raw.slice(0, 200)}`);
  }

  return coerceResult(parsed, "vertex", model, latency_ms);
}

async function intentViaOpenRouter(imageBytes: Buffer): Promise<ImageIntentResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  return runOpenRouterVisionModelChain("OpenRouter image intent", async (model, timeoutMs) => {
    const completion = await openRouterVisionCompletionForModel({
      imageBytes,
      model,
      prompt: INTENT_PROMPT,
      title: "Veridyn Image Intent",
      maxTokens: 450,
      timeoutMs,
    });
    const raw = completion.content.trim();
    const parsed = parseJsonField(raw);
    if (!parsed) {
      throw new Error(`could not parse JSON from response: ${raw.slice(0, 200)}`);
    }

    return coerceResult(parsed, "openrouter_vision", model, completion.latency_ms);
  });
}

/**
 * Analyse image intent via best available provider.
 * Vertex → Gemini → OpenRouter. Never throws on missing vendor — returns null
 * when no key is available.
 */
export async function analyzeImageIntent(
  imageBytes: Buffer,
): Promise<ImageIntentResult | null> {
  const errors: string[] = [];

  if (isVertexGeminiEnabled()) {
    try {
      return await intentViaVertex(imageBytes);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (isGeminiVisionEnabled()) {
    try {
      return await intentViaGemini(imageBytes);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  if (isOpenRouterVisionEnabled()) {
    try {
      return await intentViaOpenRouter(imageBytes);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  console.warn("[image-intent] No vision provider available:", errors.join("; ") || "no keys set");
  return null;
}

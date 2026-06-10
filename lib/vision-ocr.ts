/** Fast image OCR on Vercel — OpenRouter / Gemini / Cloud Vision; local dev uses tesseract. */

function mimeFromBuffer(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  return "image/png";
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
  const blocked = candidate?.safetyRatings?.some((r) => r.blocked) ?? false;
  const finishedNormally =
    !candidate?.finishReason || candidate.finishReason === "STOP";
  const charRatio = text.length > 0 ? Math.min(1, text.replace(/\s/g, "").length / text.length + 0.5) : 0;
  const estimatedConfidence = blocked || !finishedNormally ? 0.1 : text ? Math.round(charRatio * 100) / 100 : 0.1;
  return { text, confidence: estimatedConfidence };
}

export async function ocrImageViaOpenRouter(
  imageBytes: Buffer,
  languageHint: string | null | undefined,
): Promise<{ text: string; confidence: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const model = process.env.OPENROUTER_OCR_MODEL?.trim() || "google/gemini-2.0-flash-001";
  const b64 = imageBytes.toString("base64");
  const mime = mimeFromBuffer(imageBytes);
  const langNote =
    languageHint?.toLowerCase().includes("ben") || languageHint?.toLowerCase().includes("bn")
      ? "The document may include Bengali (Bangla) and English text."
      : "The document may include English and Bengali (Bangla) text.";

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://veridyn-ocr-dialect-service.vercel.app",
      "X-Title": "Veridyn OCR Dialect Service",
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
              text: `Extract every line of text from this trade licence / certificate scan. ${langNote} Return plain text only — no markdown, no commentary.`,
            },
            {
              type: "image_url",
              image_url: { url: `data:${mime};base64,${b64}` },
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
    throw new Error(`OpenRouter vision HTTP ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content
      .map((part) => (part.type === "text" && part.text ? part.text : ""))
      .join("\n");
  }
  text = text.replace(/\s+/g, " ").trim();
  // estimated_confidence: heuristic proxy — not a calibrated OCR score.
  // Scale by non-whitespace character ratio; 0.1 for empty output.
  const charRatioOR = text.length > 0 ? Math.min(1, text.replace(/\s/g, "").length / text.length + 0.5) : 0;
  const estimatedConfidenceOR = text ? Math.round(charRatioOR * 100) / 100 : 0.1;
  return { text, confidence: estimatedConfidenceOR };
}

export function isOpenRouterVisionEnabled(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export function isGeminiVisionEnabled(): boolean {
  return Boolean(
    process.env.GOOGLE_AI_STUDIO_KEY?.trim() ||
      process.env.GEMINI_API_KEY?.trim(),
  );
}

export async function ocrImageViaBestVision(
  imageBytes: Buffer,
  languageHint: string | null | undefined,
): Promise<{ text: string; confidence: number; engine: string }> {
  const errors: string[] = [];
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
      return { ...o, engine: "openrouter_vision" };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  if (process.env.VERCEL) {
    throw new Error(
      `Image OCR unavailable on Vercel (${errors.join("; ") || "no vision API keys"}). Set GOOGLE_AI_STUDIO_KEY or OPENROUTER_API_KEY with credits.`,
    );
  }
  throw new Error(errors.join("; ") || "No vision OCR provider configured");
}

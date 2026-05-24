/** Fast image OCR on Vercel via OpenRouter vision (Gemini Flash). */

function mimeFromBuffer(buf: Buffer): string {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  return "image/png";
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
  return { text, confidence: text ? 0.88 : 0.1 };
}

export function isOpenRouterVisionEnabled(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export function preferOpenRouterOnVercel(): boolean {
  return Boolean(process.env.VERCEL) && isOpenRouterVisionEnabled();
}

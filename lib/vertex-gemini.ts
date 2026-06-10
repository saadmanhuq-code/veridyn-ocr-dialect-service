import { getVertexAccessToken, isVertexServiceAccountConfigured } from "./vertex-auth";

const DEFAULT_VERTEX_PROJECT = "gen-lang-client-0305450104";
const DEFAULT_VERTEX_LOCATION = "global";
const DEFAULT_VERTEX_MODEL = "gemini-2.5-flash";

export type VertexGeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

export interface VertexGeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
  safetyRatings?: Array<{ blocked?: boolean }>;
}

export interface VertexGeminiResponse {
  candidates?: VertexGeminiCandidate[];
  error?: VertexErrorEnvelope["error"];
}

export interface VertexGenerateOptions {
  model?: string;
  generationConfig?: Record<string, unknown>;
  signal?: AbortSignal;
}

interface VertexErrorEnvelope {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: unknown[];
  };
}

export class VertexGeminiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown[];

  constructor(message: string, status: number, code?: string, details?: unknown[]) {
    super(message);
    this.name = "VertexGeminiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isVertexGeminiEnabled(): boolean {
  return isVertexServiceAccountConfigured();
}

function vertexProject(): string {
  return process.env.VERTEX_PROJECT?.trim() || DEFAULT_VERTEX_PROJECT;
}

function vertexLocation(): string {
  return process.env.VERTEX_LOCATION?.trim() || DEFAULT_VERTEX_LOCATION;
}

function vertexModel(model?: string): string {
  return model?.trim() || process.env.VERTEX_MODEL?.trim() || DEFAULT_VERTEX_MODEL;
}

function vertexGenerateUrl(project: string, location: string, model: string): string {
  const encodedProject = encodeURIComponent(project);
  const encodedLocation = encodeURIComponent(location);
  const encodedModel = encodeURIComponent(model);
  return `https://aiplatform.googleapis.com/v1/projects/${encodedProject}/locations/${encodedLocation}/publishers/google/models/${encodedModel}:generateContent`;
}

async function parseResponseBody(res: Response): Promise<{ parsed: unknown; text: string }> {
  const text = await res.text();
  if (!text) return { parsed: null, text: "" };
  try {
    return { parsed: JSON.parse(text), text };
  } catch {
    return { parsed: null, text };
  }
}

function errorEnvelope(value: unknown): VertexErrorEnvelope["error"] | null {
  const envelope = value as VertexErrorEnvelope;
  return envelope?.error && typeof envelope.error === "object" ? envelope.error : null;
}

function throwVertexError(status: number, parsed: unknown, text: string): never {
  const err = errorEnvelope(parsed);
  if (err) {
    throw new VertexGeminiError(
      `Vertex Gemini HTTP ${status}: ${err.message ?? err.status ?? "request failed"}`,
      status,
      err.status,
      err.details,
    );
  }
  throw new VertexGeminiError(`Vertex Gemini HTTP ${status}: ${(text || "request failed").slice(0, 200)}`, status);
}

export async function generateViaVertex(
  parts: VertexGeminiPart[],
  options: VertexGenerateOptions = {},
): Promise<{ data: VertexGeminiResponse; model: string; latency_ms: number }> {
  const model = vertexModel(options.model);
  const token = await getVertexAccessToken();
  const t0 = Date.now();
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
  };
  if (options.generationConfig) {
    body.generationConfig = options.generationConfig;
  }

  const res = await fetch(vertexGenerateUrl(vertexProject(), vertexLocation(), model), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: options.signal ?? AbortSignal.timeout(55_000),
  });

  const { parsed, text } = await parseResponseBody(res);
  if (!res.ok) {
    throwVertexError(res.status, parsed, text);
  }

  const embeddedError = errorEnvelope(parsed);
  if (embeddedError) {
    throw new VertexGeminiError(
      `Vertex Gemini error envelope: ${embeddedError.message ?? embeddedError.status ?? "request failed"}`,
      embeddedError.code ?? res.status,
      embeddedError.status,
      embeddedError.details,
    );
  }

  return {
    data: (parsed ?? {}) as VertexGeminiResponse,
    model,
    latency_ms: Date.now() - t0,
  };
}

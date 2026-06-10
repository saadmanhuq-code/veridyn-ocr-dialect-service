import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const CACHE_REFRESH_SKEW_MS = 300_000;

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

let cachedToken: CachedToken | null = null;

export class VertexAuthError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "VertexAuthError";
    this.status = status;
  }
}

export function isVertexServiceAccountConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim());
}

export function clearVertexAuthTokenCache(): void {
  cachedToken = null;
}

function serviceAccountFromEnv(): ServiceAccountCredentials {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    throw new VertexAuthError("GOOGLE_SERVICE_ACCOUNT_JSON is not configured");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new VertexAuthError("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }

  const creds = parsed as Partial<ServiceAccountCredentials>;
  if (typeof creds.client_email !== "string" || !creds.client_email.trim()) {
    throw new VertexAuthError("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email");
  }
  if (typeof creds.private_key !== "string" || !creds.private_key.trim()) {
    throw new VertexAuthError("GOOGLE_SERVICE_ACCOUNT_JSON is missing private_key");
  }

  return {
    client_email: creds.client_email.trim(),
    private_key: creds.private_key.replace(/\\n/g, "\n"),
    token_uri: typeof creds.token_uri === "string" && creds.token_uri.trim()
      ? creds.token_uri.trim()
      : TOKEN_URL,
  };
}

function base64urlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function buildJwt(creds: ServiceAccountCredentials, nowSeconds: number): string {
  const header = base64urlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64urlJson({
    iss: creds.client_email,
    scope: CLOUD_PLATFORM_SCOPE,
    aud: TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  });

  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(creds.private_key).toString("base64url");
  return `${signingInput}.${signature}`;
}

async function readTokenError(res: Response): Promise<string> {
  const text = await res.text();
  if (!text) return res.statusText;
  try {
    const parsed = JSON.parse(text) as TokenResponse;
    return parsed.error_description ?? parsed.error ?? text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

export async function getVertexAccessToken(nowMs = Date.now()): Promise<string> {
  if (cachedToken && nowMs < cachedToken.expiresAtMs - CACHE_REFRESH_SKEW_MS) {
    return cachedToken.accessToken;
  }

  const creds = serviceAccountFromEnv();
  const assertion = buildJwt(creds, Math.floor(nowMs / 1000));
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const res = await fetch(creds.token_uri ?? TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    throw new VertexAuthError(`Vertex OAuth token exchange failed (${res.status}): ${await readTokenError(res)}`, res.status);
  }

  const token = (await res.json()) as TokenResponse;
  if (!token.access_token) {
    throw new VertexAuthError("Vertex OAuth token exchange returned no access_token", res.status);
  }

  const expiresInSeconds = typeof token.expires_in === "number" && token.expires_in > 0
    ? token.expires_in
    : 3600;
  cachedToken = {
    accessToken: token.access_token,
    expiresAtMs: nowMs + expiresInSeconds * 1000,
  };
  return cachedToken.accessToken;
}

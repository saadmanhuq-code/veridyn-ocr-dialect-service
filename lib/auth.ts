/** Fail-closed Bearer auth — same convention as protein-chain-bd Veridyn client. */

import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

/** Current/old key. Kept as-is for callers (routes, smoke) that read the primary. */
export function veridynOcrBearer(): string | null {
  const k = process.env.VERIDYN_OCR_API_KEY?.trim();
  return k || null;
}

/** Next/new key, accepted during the zero-downtime rotation window. */
function veridynOcrBearerNext(): string | null {
  const k = process.env.VERIDYN_OCR_API_KEY_NEXT?.trim();
  return k || null;
}

export function bearerFromRequest(authHeader: string | null): string | null {
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return null;
  return authHeader.slice(7).trim() || null;
}

/** Name attributed to a request authenticated via the legacy shared key. */
export const LEGACY_CONSUMER = "legacy";

/** Response header carrying the attributed consumer name. */
export const CONSUMER_HEADER = "x-veridyn-consumer";

/**
 * Parse VERIDYN_OCR_CONSUMER_KEYS into a Map<consumerName, key>.
 *
 * Each named entry is an independent, individually revocable credential:
 * an operator drops one `name` -> `key` pair to revoke that consumer alone,
 * without touching any other consumer's entry or the legacy shared key.
 *
 * Accepts two formats so operators can pick whichever is easier to manage
 * in their secrets store:
 *   - a JSON object: {"proteinchain": "key-a", "dataroom": "key-b"}
 *   - a comma/newline-separated "name:key" list:
 *     "proteinchain:key-a,dataroom:key-b"
 *
 * Malformed entries are skipped individually rather than throwing, so one
 * bad line in the list can't take every consumer down.
 */
export function parseConsumerKeys(raw: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const trimmed = raw?.trim();
  if (!trimmed) return out;

  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
          const key = typeof value === "string" ? value.trim() : "";
          const trimmedName = name.trim();
          if (trimmedName && key) out.set(trimmedName, key);
        }
        return out;
      }
    } catch {
      // Not valid JSON — fall through to the "name:key" list parser below.
    }
  }

  for (const entry of trimmed.split(/[,\n]/)) {
    const piece = entry.trim();
    if (!piece) continue;
    const idx = piece.indexOf(":");
    if (idx <= 0) continue;
    const name = piece.slice(0, idx).trim();
    const key = piece.slice(idx + 1).trim();
    if (name && key) out.set(name, key);
  }
  return out;
}

/** Reads and parses VERIDYN_OCR_CONSUMER_KEYS fresh on every call (no module-level cache), so revocation takes effect on the next request without a process restart. */
function consumerKeys(): Map<string, string> {
  return parseConsumerKeys(process.env.VERIDYN_OCR_CONSUMER_KEYS);
}

/**
 * Resolve which credential (if any) a presented bearer token matches, by
 * name. Named per-consumer keys are checked first, then the legacy shared
 * key(s) (attributed as LEGACY_CONSUMER). Returns null for no match.
 */
function matchCredential(token: string): string | null {
  for (const [name, key] of consumerKeys()) {
    if (safeEqual(token, key)) return name;
  }
  const legacy = [veridynOcrBearer(), veridynOcrBearerNext()].filter(
    (k): k is string => k !== null,
  );
  if (legacy.some((expected) => safeEqual(token, expected))) return LEGACY_CONSUMER;
  return null;
}

/**
 * Resolve the consumer name attributable to a request's bearer token, for
 * response-header / log attribution. Returns null when there is no bearer
 * token or it matches no configured credential — callers only use this
 * after `requireApiKey` has already let the request through.
 */
export function resolveConsumer(headers: Headers): string | null {
  const got = bearerFromRequest(headers.get("authorization"));
  if (got === null) return null;
  return matchCredential(got);
}

/**
 * Add the per-consumer attribution header to a response's headers, when a
 * consumer was resolved. Leaves the headers untouched when consumer is null
 * (unauthenticated dev-bypass path, or no match) so callers can pass this
 * through unconditionally.
 */
export function withConsumerHeader(
  headers: Record<string, string>,
  consumer: string | null,
): Record<string, string> {
  if (!consumer) return headers;
  return { ...headers, [CONSUMER_HEADER]: consumer };
}

/**
 * Constant-time string compare. Both inputs are SHA-256-hashed to a fixed
 * 32-byte width before comparison so timingSafeEqual never throws and no
 * information about key length is leaked via timing.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * True only when ALL THREE conditions hold simultaneously:
 *  (a) VERIDYN_OCR_ALLOW_UNAUTHENTICATED=true is set explicitly by the developer.
 *  (b) Not running on Vercel — VERCEL is unset (Vercel sets it on every deployment,
 *      production AND preview, so any deployed environment fails closed regardless).
 *  (c) Not a production build — NODE_ENV !== "production" (`next build` sets this,
 *      which also covers `next start` and preview builds).
 *
 * Why the explicit opt-in flag is required (in addition to the existing checks):
 *  This service also runs as a Docker container on non-Vercel hosts (e.g. Oracle
 *  VM3). Without the flag, a misconfigured container that omits VERCEL and keeps
 *  NODE_ENV at its default would fail open with no key configured. The opt-in flag
 *  ensures every environment fails closed by default; only a developer who has
 *  deliberately set the flag on a genuine local box gets the allow-all path.
 */
function authBypassAllowed(): boolean {
  const explicitDevOptIn =
    process.env.VERIDYN_OCR_ALLOW_UNAUTHENTICATED?.trim().toLowerCase() ===
    "true";
  return (
    explicitDevOptIn &&
    !process.env.VERCEL &&
    process.env.NODE_ENV !== "production"
  );
}

export function requireApiKey(headers: Headers): NextResponse | null {
  // Accept the current key, the next key (rotation window), OR any
  // individually-configured per-consumer key from VERIDYN_OCR_CONSUMER_KEYS.
  // If none are set, auth does not gate (subject to the fail-closed check
  // below).
  const legacyAccepted = [veridynOcrBearer(), veridynOcrBearerNext()].filter(
    (k): k is string => k !== null,
  );
  const named = consumerKeys();

  // FAIL CLOSED: if no credentials are configured at all (legacy key(s) AND
  // named consumer keys both empty), only local dev may pass through.
  // Any deployed environment (production or preview) is rejected so the service
  // never silently serves unauthenticated traffic when keys are missing.
  // Reject with 403 (not 503): a missing-key config is a permanent "forbidden",
  // not a transient outage, so well-behaved clients stop rather than retry-storm.
  if (legacyAccepted.length === 0 && named.size === 0) {
    if (authBypassAllowed()) return null;
    return NextResponse.json(
      { detail: "Forbidden: API key not configured." },
      { status: 403 },
    );
  }

  const got = bearerFromRequest(headers.get("authorization"));
  const consumer = got === null ? null : matchCredential(got);
  if (consumer === null) {
    console.warn(
      JSON.stringify({ event: "veridyn_ocr_auth", ok: false, consumer: null }),
    );
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
  // Per-consumer attribution in the request log (finding #23) — the response
  // header is added by callers via withConsumerHeader/resolveConsumer, since
  // only the route builds the final NextResponse.
  console.log(
    JSON.stringify({ event: "veridyn_ocr_auth", ok: true, consumer }),
  );
  return null;
}

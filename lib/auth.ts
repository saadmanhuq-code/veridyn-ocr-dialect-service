/** Fail-closed Bearer auth — same convention as protein-chain-bd Veridyn client. */

import { NextResponse } from "next/server";

import {
  CONSUMER_HEADER,
  LEGACY_CONSUMER,
  constantTimeEqual,
  consumerKeys,
  logUsageEvent,
  matchConsumerKey,
} from "./consumer-keys";

export { CONSUMER_HEADER, LEGACY_CONSUMER };
export { parseConsumerKeys } from "./consumer-keys";

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

/** Legacy shared keys currently configured (current + rotation-next). */
function legacyAcceptedKeys(): string[] {
  return [veridynOcrBearer(), veridynOcrBearerNext()].filter(
    (k): k is string => k !== null,
  );
}

/**
 * Resolve which credential a presented bearer token matches, by consumer
 * name. Named per-consumer keys (lib/consumer-keys.ts) are checked first,
 * then the legacy shared key(s), attributed as LEGACY_CONSUMER. Every
 * compare is constant-time. Returns null for no match.
 */
function matchCredential(token: string): string | null {
  const named = matchConsumerKey(token);
  if (named !== null) return named;
  if (legacyAcceptedKeys().some((expected) => constantTimeEqual(token, expected))) {
    return LEGACY_CONSUMER;
  }
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
 * consumer was resolved. Leaves the headers untouched when consumer is
 * null (unauthenticated dev-bypass path, or no match) so callers can pass
 * this through unconditionally.
 */
export function withConsumerHeader(
  headers: Record<string, string>,
  consumer: string | null,
): Record<string, string> {
  if (!consumer) return headers;
  return { ...headers, [CONSUMER_HEADER]: consumer };
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
  // Accept the legacy current/next keys (rotation window) OR any named
  // per-consumer key from the env map (lib/consumer-keys.ts). If a key
  // source is unset, it does not gate.
  const hasLegacy = legacyAcceptedKeys().length > 0;
  const hasNamed = consumerKeys().size > 0;

  // FAIL CLOSED: if no credentials are configured at all (legacy AND named
  // both empty), only local dev may pass through. Any deployed environment
  // (production or preview) is rejected so the service never silently
  // serves unauthenticated traffic when keys are missing.
  // Reject with 403 (not 503): a missing-key config is a permanent "forbidden",
  // not a transient outage, so well-behaved clients stop rather than retry-storm.
  if (!hasLegacy && !hasNamed) {
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
    logUsageEvent({ consumer: null, ok: false });
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
  // Per-consumer attribution in the request log (main lineage) plus the
  // usage_event.v1 metering line (consumer name + outcome only, no PII).
  // The response attribution header is added by callers via
  // withConsumerHeader/resolveConsumer, since only the route builds the
  // final NextResponse.
  console.log(
    JSON.stringify({ event: "veridyn_ocr_auth", ok: true, consumer }),
  );
  logUsageEvent({ consumer, ok: true });
  return null;
}

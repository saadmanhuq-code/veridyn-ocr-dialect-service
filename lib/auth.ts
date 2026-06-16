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
  // Accept either the current key or the next key (rotation window). If a key
  // is unset, it does not gate.
  const accepted = [veridynOcrBearer(), veridynOcrBearerNext()].filter(
    (k): k is string => k !== null,
  );

  // FAIL CLOSED: if no keys are configured, only local dev may pass through.
  // Any deployed environment (production or preview) is rejected so the service
  // never silently serves unauthenticated traffic when keys are missing.
  // Reject with 403 (not 503): a missing-key config is a permanent "forbidden",
  // not a transient outage, so well-behaved clients stop rather than retry-storm.
  if (accepted.length === 0) {
    if (authBypassAllowed()) return null;
    return NextResponse.json(
      { detail: "Forbidden: API key not configured." },
      { status: 403 },
    );
  }

  const got = bearerFromRequest(headers.get("authorization"));
  if (got === null || !accepted.some((expected) => safeEqual(got, expected))) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
  return null;
}

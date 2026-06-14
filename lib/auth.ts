/** Optional Bearer auth — same convention as protein-chain-bd Veridyn client. */

import { timingSafeEqual } from "node:crypto";

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

/** Constant-time string compare. Length-guarded so unequal lengths never throw. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * True only in genuine local development: not running on Vercel AND not built
 * for production. This is the *only* place auth is allowed to be optional.
 *
 * Why this exact condition:
 *  - Vercel sets VERCEL=1 on every deployment (production AND preview), so any
 *    deployed environment fails closed.
 *  - `next build` sets NODE_ENV=production, which also covers `next start`.
 *  - Preview deployments are internet-reachable, so they MUST require a key —
 *    keying off VERCEL_ENV === "production" alone would leave preview open.
 * Local `npm run dev` and the test runner are non-Vercel + non-production, so
 * they keep the zero-friction allow-all behavior.
 */
function authBypassAllowed(): boolean {
  return !process.env.VERCEL && process.env.NODE_ENV !== "production";
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

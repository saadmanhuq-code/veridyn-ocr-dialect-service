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

export function requireApiKey(headers: Headers): NextResponse | null {
  // Accept either the current key or the next key (rotation window). If a key
  // is unset, it does not gate. If BOTH are unset, auth is optional (allow-all).
  const accepted = [veridynOcrBearer(), veridynOcrBearerNext()].filter(
    (k): k is string => k !== null,
  );
  if (accepted.length === 0) return null;

  const got = bearerFromRequest(headers.get("authorization"));
  if (got === null || !accepted.some((expected) => safeEqual(got, expected))) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
  return null;
}

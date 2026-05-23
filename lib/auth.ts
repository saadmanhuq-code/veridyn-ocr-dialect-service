/** Optional Bearer auth — same convention as protein-chain-bd Veridyn client. */

import { NextResponse } from "next/server";

export function veridynOcrBearer(): string | null {
  const k = process.env.VERIDYN_OCR_API_KEY?.trim();
  return k || null;
}

export function bearerFromRequest(authHeader: string | null): string | null {
  if (!authHeader?.toLowerCase().startsWith("bearer ")) return null;
  return authHeader.slice(7).trim() || null;
}

export function requireApiKey(headers: Headers): NextResponse | null {
  const expected = veridynOcrBearer();
  if (!expected) return null;

  const got = bearerFromRequest(headers.get("authorization"));
  if (got !== expected) {
    return NextResponse.json({ detail: "Unauthorized" }, { status: 401 });
  }
  return null;
}

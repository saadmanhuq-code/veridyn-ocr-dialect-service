/** CORS headers for programmatic consumers (other Vercel projects, local tools). */

/**
 * Allowlisted origins, parsed from OCR_CORS_ORIGINS (comma-separated).
 * Trailing slashes are stripped so "https://x.com" and "https://x.com/" match.
 * Empty / unset => no cross-origin access is granted (fail closed). The literal
 * "*" is honored only if an operator explicitly opts in via OCR_CORS_ORIGINS="*".
 */
function allowedOrigins(): string[] {
  return (process.env.OCR_CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter((o) => o.length > 0);
}

/**
 * Resolve the Access-Control-Allow-Origin value for a given request origin.
 * Returns the reflected origin when it is allowlisted, "*" when the operator
 * has opted into wildcard, or null when the origin is not allowed (fail closed).
 */
function resolveAllowOrigin(reqOrigin: string | null | undefined): string | null {
  const allowed = allowedOrigins();
  if (allowed.includes("*")) return "*";
  if (!reqOrigin) return null;
  const normalized = reqOrigin.trim().replace(/\/+$/, "");
  return allowed.includes(normalized) ? reqOrigin : null;
}

/**
 * Build CORS headers. Pass the request's `Origin` header so cross-origin callers
 * can be matched against the allowlist. Same-origin requests (the bundled UI)
 * send no Origin and need no CORS headers, so a missing/disallowed origin simply
 * omits Access-Control-Allow-Origin rather than emitting a wildcard.
 */
export function corsHeaders(reqOrigin?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    // Responses vary by Origin because the allowed value is computed per-request.
    Vary: "Origin",
  };

  const allowOrigin = resolveAllowOrigin(reqOrigin);
  if (allowOrigin) {
    headers["Access-Control-Allow-Origin"] = allowOrigin;
  }

  return headers;
}

/** CORS headers for programmatic consumers (other Vercel projects, local tools). */

function allowOrigin(): string {
  const o = process.env.OCR_CORS_ORIGIN?.trim();
  return o && o.length ? o : "https://veridyn-ocr-dialect-service.vercel.app";
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowOrigin(),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Per-consumer scoped API keys (W4 consumer platform).
 *
 * Operators configure named, individually revocable consumer credentials via
 * an env map. Two env names are honoured and merged so existing deployments
 * keep working whichever name they adopted first:
 *
 *   VERIDYN_OCR_API_KEYS        — wave-spec name (wins on a name collision)
 *   VERIDYN_OCR_CONSUMER_KEYS   — name used by the (undeployed) main lineage
 *
 * Both accept two formats:
 *   - comma/newline-separated "name:key" list: "proteinchain:key-a,dataroom:key-b"
 *   - JSON object: {"proteinchain": "key-a", "dataroom": "key-b"}
 *
 * Malformed entries are skipped individually so one bad line cannot take
 * every consumer down. Keys are compared in constant time (SHA-256 to a
 * fixed 32-byte width, then timingSafeEqual — same construction lib/auth.ts
 * has always used). Env is re-read on every call: revoking a consumer is an
 * env edit, effective on the next request, no restart.
 *
 * The legacy shared keys (VERIDYN_OCR_API_KEY / _NEXT) still work and are
 * attributed as LEGACY_CONSUMER, so existing consumers (ProteinChain) are
 * untouched; named keys are purely additive.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/** Name attributed to a request authenticated via the legacy shared key. */
export const LEGACY_CONSUMER = "legacy";

/** Response header carrying the attributed consumer name. */
export const CONSUMER_HEADER = "x-veridyn-consumer";

/** Primary env var for the per-consumer key map. */
export const CONSUMER_KEYS_ENV = "VERIDYN_OCR_API_KEYS";

/** Alternate env var (main-lineage name), merged under CONSUMER_KEYS_ENV. */
export const CONSUMER_KEYS_ALT_ENV = "VERIDYN_OCR_CONSUMER_KEYS";

/**
 * Constant-time string compare. Both inputs are SHA-256-hashed to a fixed
 * 32-byte width before comparison so timingSafeEqual never throws and no
 * information about key length is leaked via timing.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Parse one env-map value ("name:key,..." list or JSON object) into name->key. */
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

/**
 * All configured per-consumer keys, read fresh from env on every call.
 * CONSUMER_KEYS_ALT_ENV entries are loaded first so CONSUMER_KEYS_ENV wins
 * when the same consumer name appears in both.
 */
export function consumerKeys(): Map<string, string> {
  const merged = parseConsumerKeys(process.env[CONSUMER_KEYS_ALT_ENV]);
  for (const [name, key] of parseConsumerKeys(process.env[CONSUMER_KEYS_ENV])) {
    merged.set(name, key);
  }
  return merged;
}

/**
 * Resolve which named consumer a presented bearer token belongs to, using
 * constant-time compares. Returns null when no named key matches (the
 * caller then falls back to the legacy shared keys).
 */
export function matchConsumerKey(token: string): string | null {
  for (const [name, key] of consumerKeys()) {
    if (constantTimeEqual(token, key)) return name;
  }
  return null;
}

/**
 * Emit one structured usage line for metering (stdout JSONL, captured by the
 * platform log drain — zero new infra). Contains consumer attribution and
 * outcome only: never the token, never request content, no PII.
 * Fire-and-forget — metering must never break the primary response.
 */
export function logUsageEvent(input: { consumer: string | null; ok: boolean }): void {
  try {
    process.stdout.write(
      JSON.stringify({
        schema_version: "usage_event.v1",
        event: "veridyn_ocr_usage",
        ts: new Date().toISOString(),
        consumer: input.consumer,
        ok: input.ok,
      }) + "\n",
    );
  } catch {
    // swallow — usage metering must never break the primary response
  }
}

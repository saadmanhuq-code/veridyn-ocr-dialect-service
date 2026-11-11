/**
 * VERIDYN_CORPUS_LOG — append-only JSONL corpus logger.
 *
 * Storage decision: Vercel filesystem is read-only in production; Supabase
 * requires a separate key/project. For Slice-1 we use the simplest approach
 * that needs ZERO new infra: write to stdout as structured JSON lines. These
 * are captured by Vercel's built-in log drain and can be piped to any sink
 * (Supabase, S3, Loki) by toggling a Vercel Log Drain integration — no code
 * change required. When VERIDYN_CORPUS_LOG=enabled the lines are emitted;
 * when absent (default) the function is a no-op. Enabled logging still
 * requires an explicit consent:true event (caller-supplied via
 * parseConsent, default false); without it nothing is emitted.
 *
 * To enable: set VERIDYN_CORPUS_LOG=enabled on the Vercel project.
 * To ship to Supabase: attach a Log Drain webhook that POSTs to a Supabase
 * edge function — documented in docs/corpus-log.md (Slice-2 work).
 *
 * Schema: corpus_event.v1
 */

import { createHash } from "node:crypto";

import type { DialectClassifierStatus, DialectInference, DialectResolutionMethod } from "./dialect";

export interface CorpusEvent {
  schema_version: "corpus_event.v1";
  ts: string; // ISO-8601
  event_type: "transcribe" | "image_intent";
  audio_sha256?: string; // transcribe only
  image_sha256?: string; // image_intent only
  transcript?: string; // raw STT output
  language?: string;
  dialect_label?: string | null;
  dialect_match_score?: number | null;
  method?: DialectResolutionMethod | null;
  classifier_status?: DialectClassifierStatus | null;
  classifier_confidence?: number | null;
  product?: string; // calling product tag
  region?: string; // optional user-declared region
  stt_provider?: string;
  intent_category?: string;
  /**
   * Caller-supplied end-user consent for corpus retention. Defaults to
   * false when the caller does not supply it. Explicit end-user consent is
   * required before any corpus write: when false, no event is emitted at
   * all (main's consent stop); the field-strip in appendCorpusEvent stays
   * as defense in depth behind that gate.
   */
  consent?: boolean;
}

/** Fields that identify or reproduce caller content; retained only with consent. */
const PERSISTENCE_FIELDS = ["transcript", "audio_sha256", "image_sha256"] as const;

/**
 * Parse a caller-supplied consent value from a multipart form field or a
 * JSON body. Only an explicit affirmative counts: boolean true, or the
 * strings "true"/"1"/"yes" (case-insensitive). Everything else — including
 * undefined, null, "false", numbers — is false. Consent is never inferred.
 */
export function parseConsent(raw: unknown): boolean {
  if (raw === true) return true;
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes";
  }
  return false;
}

function isCorpusLogEnabled(): boolean {
  return process.env.VERIDYN_CORPUS_LOG?.trim().toLowerCase() === "enabled";
}

function sha256hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function dialectCorpusFields(dialect: DialectInference): Pick<
  CorpusEvent,
  "dialect_label" | "dialect_match_score" | "method" | "classifier_status" | "classifier_confidence"
> {
  return {
    dialect_label: dialect.dialect_label,
    dialect_match_score: dialect.match_score,
    method: dialect.method ?? null,
    classifier_status: dialect.classifier_status ?? null,
    classifier_confidence: dialect.classifier_confidence ?? null,
  };
}

/**
 * Append a corpus event. Fire-and-forget — swallow all errors.
 * Output to stdout as JSONL; captured by Vercel log drain.
 */
export function appendCorpusEvent(event: Omit<CorpusEvent, "schema_version" | "ts">): void {
  if (!isCorpusLogEnabled() || event.consent !== true) return;
  try {
    // Consent gate (defense in depth behind the early return above): the
    // sanitizer below would strip persistence-shaped fields and record
    // consent:false if a non-consented event ever reached emission.
    const consented = event.consent === true;
    const sanitized: Omit<CorpusEvent, "schema_version" | "ts"> = {
      ...event,
      consent: consented,
    };
    if (!consented) {
      for (const field of PERSISTENCE_FIELDS) delete sanitized[field];
    }
    const record: CorpusEvent = {
      schema_version: "corpus_event.v1",
      ts: new Date().toISOString(),
      ...sanitized,
    };
    // JSONL line — one compact JSON object per line, no PII beyond content hashes
    process.stdout.write(JSON.stringify(record) + "\n");
  } catch {
    // swallow — corpus log must never break the primary response
  }
}

/**
 * Compute SHA-256 of audio/image bytes for corpus identity (no raw bytes stored).
 * Content hash only — the actual bytes never leave the service.
 */
export function contentHash(buf: Buffer): string {
  return sha256hex(buf);
}

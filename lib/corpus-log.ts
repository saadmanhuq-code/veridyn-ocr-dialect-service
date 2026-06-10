/**
 * VERIDYN_CORPUS_LOG — append-only JSONL corpus logger.
 *
 * Storage decision: Vercel filesystem is read-only in production; Supabase
 * requires a separate key/project. For Slice-1 we use the simplest approach
 * that needs ZERO new infra: write to stdout as structured JSON lines. These
 * are captured by Vercel's built-in log drain and can be piped to any sink
 * (Supabase, S3, Loki) by toggling a Vercel Log Drain integration — no code
 * change required. When VERIDYN_CORPUS_LOG=enabled the lines are emitted;
 * when absent (default) the function is a no-op.
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
  consent?: boolean; // always true in Slice-1 (operator context); required before persisting audio hashes
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
  if (!isCorpusLogEnabled()) return;
  try {
    const record: CorpusEvent = {
      schema_version: "corpus_event.v1",
      ts: new Date().toISOString(),
      ...event,
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

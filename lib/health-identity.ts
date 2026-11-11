/**
 * Build identity for GET /api/health.
 *
 * Vercel CLI deploys do not set VERCEL_GIT_COMMIT_SHA, so health reported
 * commit_sha:null in production even though the build knew its SHA. This
 * resolver walks an env chain so any deploy path (Vercel git, Vercel CLI
 * with an injected SHA, Docker on a non-Vercel host) can identify itself:
 *
 *   VERCEL_GIT_COMMIT_SHA -> GIT_COMMIT_SHA -> COMMIT_SHA -> BUILD_COMMIT_SHA
 *
 * `BUILD_COMMIT_SHA` is baked into the bundle by
 * scripts/generate-build-info.mjs from local git/CI env at build time; the
 * health route injects that generated value when no env SHA is set, so a
 * built artifact never reports a null SHA. `resolveBuildIdentity` itself
 * returns nulls when nothing is set: the existing health contract has
 * always allowed null here, and consumers may rely on that. `sha_source`
 * names which env var supplied the value so an operator can tell a
 * git-bound deploy from a CLI-injected one at a glance.
 */

export interface BuildIdentity {
  commit_sha: string | null;
  /** Env var name that supplied commit_sha, or null when unresolved. */
  sha_source: string | null;
}

const SHA_ENV_CHAIN = [
  "VERCEL_GIT_COMMIT_SHA",
  "GIT_COMMIT_SHA",
  "COMMIT_SHA",
  "BUILD_COMMIT_SHA",
] as const;

/** Resolve build identity from an env record (process.env in the route). */
export function resolveBuildIdentity(
  env: Record<string, string | undefined>,
): BuildIdentity {
  for (const name of SHA_ENV_CHAIN) {
    const value = env[name]?.trim();
    if (value) return { commit_sha: value, sha_source: name };
  }
  return { commit_sha: null, sha_source: null };
}

/**
 * Resolve the deployed commit SHA a remote-truth probe can trust, from
 * candidates in priority order (VERCEL_GIT_COMMIT_SHA -> GIT_COMMIT_SHA ->
 * generated BUILD_COMMIT_SHA). Returns the literal string `"unknown"` only
 * when every candidate is empty/unset, so a probe always sees an explicit,
 * machine-checkable value instead of a missing field or an empty string.
 */
export function resolveRuntimeSha(
  candidates: Array<string | null | undefined>,
): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return "unknown";
}

/**
 * Resolve the deployed commit SHA a remote-truth probe can trust.
 *
 * Priority: `VERCEL_GIT_COMMIT_SHA` (set by Vercel at build AND, when the
 * project has "Automatically expose System Environment Variables" enabled,
 * at runtime too) -> `GIT_COMMIT_SHA` (a plain build-time env var for
 * non-Vercel hosts, e.g. the Docker deployment on Oracle VM3, where an
 * operator can inject the CI commit SHA at image-build time) ->
 * `BUILD_COMMIT_SHA` (baked into the bundle by scripts/generate-build-info.mjs
 * from local git/CI env at build time) -> the literal string `"unknown"`.
 *
 * `"unknown"` is returned only when every candidate is empty/unset, so a
 * probe always sees an explicit, machine-checkable value instead of a
 * missing field or an empty string.
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

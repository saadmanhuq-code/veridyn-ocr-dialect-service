/**
 * AUTH-COVERAGE integrity guard for veridyn-ocr-dialect-service.
 *
 * Design (drift-proof): the route list is derived from the filesystem at
 * runtime, not hardcoded.  Adding a new route.ts next month means it is
 * automatically subject to the auth check.
 *
 * Contract:
 *   - Every route.ts under app/api/ that exports POST / PUT / PATCH / DELETE
 *     (as a function declaration or a const arrow/function expression) must
 *     contain a `requireApiKey` call.
 *   - GET-only routes and OPTIONS handlers are exempt (health probe, preflight).
 *   - The detector is a pure function so it can be exercised with in-memory
 *     fixtures in the planted-defect test without touching the filesystem.
 *
 * Self-contained by design: no dependency on any external/shared package.
 * (A portfolio-wide shared `@saadmanhuq-code/integrity-guards` package exists
 * for other products, but wiring it here requires a private-registry
 * .npmrc/NODE_AUTH_TOKEN setup that is out of scope for this fix — see the
 * PR description for the full history.)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RouteFile {
  /** Absolute or relative path — used only for error messages. */
  path: string;
  /** Raw source text of the route.ts file. */
  source: string;
}

export interface UnprotectedRoute {
  path: string;
  /** HTTP methods that lack a requireApiKey call. */
  methods: string[];
}

// ---------------------------------------------------------------------------
// Pure detector — testable with in-memory fixtures
// ---------------------------------------------------------------------------

const MUTATION_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

/**
 * Returns routes that export a mutation handler but do NOT call requireApiKey.
 *
 * Detection is source-level: we check whether:
 *   (a) the file exports a handler for the method — either
 *       `export [async ]function METHOD(` or `export const METHOD =` — AND
 *   (b) the file contains a `requireApiKey(` call.
 *
 * If (a) is true and (b) is false → unprotected.
 *
 * This is intentionally simple regex/string-scan — no full AST — which is
 * sufficient for this codebase's uniform pattern (requireApiKey is called at
 * the top of every POST handler, or the route is a GET/OPTIONS-only file).
 */
export function detectUnprotectedRoutes(routes: RouteFile[]): UnprotectedRoute[] {
  const unprotected: UnprotectedRoute[] = [];

  for (const route of routes) {
    const hasAuth = route.source.includes("requireApiKey(");

    const exposedMutationMethods = MUTATION_METHODS.filter((method) => {
      // Match `export async function POST(` / `export function POST(`
      const fnPattern = new RegExp(
        `export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`,
      );
      // Match `export const POST = ` (arrow fn or function expression)
      const constPattern = new RegExp(`export\\s+const\\s+${method}\\s*=`);
      return fnPattern.test(route.source) || constPattern.test(route.source);
    });

    if (exposedMutationMethods.length > 0 && !hasAuth) {
      unprotected.push({ path: route.path, methods: exposedMutationMethods });
    }
  }

  return unprotected;
}

// ---------------------------------------------------------------------------
// Filesystem collector — derives the route list from app/api/**
// ---------------------------------------------------------------------------

/**
 * Walks app/api/ and returns every route.ts file as a RouteFile.
 * The appApiDir should be an absolute path to the app/api directory.
 */
export function collectRouteFiles(appApiDir: string): RouteFile[] {
  const results: RouteFile[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (entry === "route.ts" || entry === "route.js") {
        results.push({
          path: full,
          source: readFileSync(full, "utf8"),
        });
      }
    }
  }

  walk(appApiDir);
  return results;
}

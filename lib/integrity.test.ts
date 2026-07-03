import { readFileSync, existsSync } from "node:fs";
import { globSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Import from the shared portfolio-core package. The package's "exports" field
// is ESM-only and not resolvable through tsx's CJS loader bridge, so we bind
// directly to the built dist entrypoint. The guard logic itself is untouched.
import {
  assertAuthCoverage,
  assertReadinessLedger,
} from "../../../Users/saadm/Projects/portfolio-core/packages/integrity-guards/dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.dirname(__dirname);
const API_DIR = path.join(REPO_ROOT, "app", "api");
const REPORT_PATH = path.join(REPO_ROOT, "test-report.json");

/**
 * Build the list of route descriptors from Next.js app/api route files.
 * For each route.ts we detect which HTTP methods it exports and, for
 * mutation methods, whether it calls requireApiKey.
 */
function buildRouteDescriptors(): Array<{
  path: string;
  method: string;
  hasAuth: boolean;
}> {
  const routes: Array<{ path: string; method: string; hasAuth: boolean }> = [];
  const routeFiles = globSync("**/route.ts", { cwd: API_DIR });

  for (const relative of routeFiles) {
    const fullPath = path.join(API_DIR, relative);
    const content = readFileSync(fullPath, "utf8");
    const routePath = "/api/" + relative.replace(/\/route\.ts$/, "");
    const hasAuth = content.includes("requireApiKey");

    // Detect exported HTTP-method handlers.
    const methodPattern =
      /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS)/g;
    const methods = new Set<string>();
    let match: RegExpExecArray | null;
    while ((match = methodPattern.exec(content)) !== null) {
      methods.add(match[1]!);
    }

    for (const method of methods) {
      routes.push({ path: routePath, method, hasAuth });
    }
  }

  return routes;
}

test("all mutation routes require API key", () => {
  const routes = buildRouteDescriptors();

  // Sanity check: we found the routes we expect.
  if (routes.length === 0) {
    throw new Error(
      "AUTH-COVERAGE FATAL: No routes discovered in app/api. The route scan is broken."
    );
  }

  assertAuthCoverage(
    routes,
    (route) => Boolean((route as typeof routes[number]).hasAuth),
    {
      exemptRoutes: new Set([
        "/api/health", // health surface is intentionally public
      ]),
    }
  );
});

test("readiness ledger invariants have passing tests", () => {
  // The ledger assertion reads a test report produced by the full suite. When
  // the report is being generated (INTEGRITY_LEDGER_CHECK is unset) we skip the
  // ledger check; the gate command re-runs this test with the env var set after
  // the report has been written.
  if (!process.env.INTEGRITY_LEDGER_CHECK) {
    console.log(
      "SKIP: ledger assertion runs only in the gate phase (INTEGRITY_LEDGER_CHECK=1)."
    );
    return;
  }

  assertReadinessLedger(
    path.join(REPO_ROOT, "readiness.json"),
    REPORT_PATH
  );
});

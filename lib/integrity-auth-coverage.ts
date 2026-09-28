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
import ts from "typescript";

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

function isMutationMethod(name: string): name is (typeof MUTATION_METHODS)[number] {
  return MUTATION_METHODS.some((method) => method === name);
}

function isExported(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  return ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function hasActiveAuthCall(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
      node.expression.text === "requireApiKey") {
    return true;
  }
  return ts.forEachChild(node, hasActiveAuthCall) === true;
}

/**
 * Return exported mutation handlers without an active requireApiKey call
 * inside that handler. TypeScript's parser ignores comments and string
 * literals, and checking each handler avoids a GET call covering a POST.
 * This is a syntactic guard; route behavior tests must still verify denial.
 */
export function detectUnprotectedRoutes(routes: RouteFile[]): UnprotectedRoute[] {
  const unprotected: UnprotectedRoute[] = [];

  for (const route of routes) {
    const sourceFile = ts.createSourceFile(
      route.path, route.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
    );
    const missing: string[] = [];

    for (const statement of sourceFile.statements) {
      if (!isExported(statement)) continue;

      if (ts.isFunctionDeclaration(statement) && statement.name &&
          isMutationMethod(statement.name.text)) {
        if (!statement.body || !hasActiveAuthCall(statement.body)) {
          missing.push(statement.name.text);
        }
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) ||
              !isMutationMethod(declaration.name.text)) continue;
          if (!declaration.initializer || !hasActiveAuthCall(declaration.initializer)) {
            missing.push(declaration.name.text);
          }
        }
      }
    }

    if (missing.length > 0) {
      unprotected.push({ path: route.path, methods: missing });
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

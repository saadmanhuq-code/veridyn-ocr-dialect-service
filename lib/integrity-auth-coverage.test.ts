/**
 * AUTH-COVERAGE integrity gate — three assertions required:
 *
 *   1. Planted-defect: a POST handler with no requireApiKey → flagged as unprotected.
 *      This test FAILS if the detector is broken or vacuous.
 *
 *   2. Planted-clean: a POST handler with requireApiKey → NOT flagged.
 *      This test prevents false positives.
 *
 *   3. Real-codebase: run the FS collector against app/api/; assert zero unprotected routes.
 *      This produces the PASS verdict against the live code. Temporarily removing a
 *      `requireApiKey` call from any real route.ts must fail this test (proved in the
 *      PR description; not asserted here since it requires mutating a live route file).
 *
 * Guards exercised:
 *   - AUTH-COVERAGE (this file)
 *   - REQUIRED-ENV: N/A — all env vars are optional-chained (?.) with no module-top-level
 *     throw; the service fails-closed via requireApiKey / provider fallback at request time.
 *   - NO-ORPHAN-HANDLER: N/A — file-based routing (Next.js app router) auto-wires any
 *     exported HTTP method from route.ts; framework handles dispatch, not a manual registry.
 *   - BOOT/WIRING: N/A — no composition root / DI container; Next.js bootstraps from file
 *     structure.
 *   - MONEY/FSM/AUDIT/LEDGER: N/A — no monetary transactions, no FSM, corpus-log is
 *     fire-and-forget append (not double-entry ledger).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { detectUnprotectedRoutes, collectRouteFiles } from "./integrity-auth-coverage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Repo root is one level above lib/
const REPO_ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// 1. Planted-defect test — detector MUST flag a POST with no requireApiKey
// ---------------------------------------------------------------------------
test("AUTH-COVERAGE planted-defect: POST without requireApiKey is flagged", () => {
  const fixtures = [
    {
      path: "app/api/test-unprotected/route.ts",
      source: `
import { NextRequest, NextResponse } from "next/server";
// requireApiKey intentionally omitted — planted defect
export async function POST(req: NextRequest) {
  return NextResponse.json({ ok: true });
}
      `.trim(),
    },
  ];

  const found = detectUnprotectedRoutes(fixtures);

  assert.equal(
    found.length,
    1,
    `Planted-defect: expected 1 unprotected route, got ${found.length}. ` +
      `Detector is broken or not checking for requireApiKey.`,
  );
  assert.deepEqual(found[0].methods, ["POST"]);
  assert.ok(
    found[0].path.includes("test-unprotected"),
    "Unprotected route path should reference the planted fixture.",
  );
});

// ---------------------------------------------------------------------------
// 1b. Planted-defect (arrow/const export form) — same contract, different syntax
// ---------------------------------------------------------------------------
test("AUTH-COVERAGE planted-defect: exported const POST without requireApiKey is flagged", () => {
  const fixtures = [
    {
      path: "app/api/test-unprotected-const/route.ts",
      source: `
import { NextResponse } from "next/server";
// requireApiKey intentionally omitted — planted defect, const-export form
export const POST = async (req) => {
  return NextResponse.json({ ok: true });
};
      `.trim(),
    },
  ];

  const found = detectUnprotectedRoutes(fixtures);

  assert.equal(
    found.length,
    1,
    `Planted-defect (const form): expected 1 unprotected route, got ${found.length}.`,
  );
  assert.deepEqual(found[0].methods, ["POST"]);
});

// ---------------------------------------------------------------------------
// 2. Planted-clean test — detector must NOT flag a properly-auth'd POST
// ---------------------------------------------------------------------------
test("AUTH-COVERAGE planted-clean: POST with requireApiKey is NOT flagged", () => {
  const fixtures = [
    {
      path: "app/api/test-protected/route.ts",
      source: `
import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth";
import { corsHeaders } from "@/lib/cors";

export async function POST(req: NextRequest) {
  const authBlock = requireApiKey(req.headers);
  if (authBlock) return authBlock;
  return NextResponse.json({ ok: true });
}
      `.trim(),
    },
  ];

  const found = detectUnprotectedRoutes(fixtures);

  assert.equal(
    found.length,
    0,
    `Planted-clean: expected 0 unprotected routes, got ${found.length}. ` +
      `Detector is producing false positives.`,
  );
});

// ---------------------------------------------------------------------------
// 3. Real-codebase scan — must PASS with zero unprotected routes
// ---------------------------------------------------------------------------
test("AUTH-COVERAGE real-codebase: all mutation routes in app/api/ call requireApiKey", () => {
  const appApiDir = join(REPO_ROOT, "app", "api");
  const routes = collectRouteFiles(appApiDir);

  assert.ok(
    routes.length > 0,
    `FS collector returned zero route files under ${appApiDir}. ` +
      `Either the path is wrong or all route files have been removed.`,
  );

  const unprotected = detectUnprotectedRoutes(routes);

  if (unprotected.length > 0) {
    const detail = unprotected
      .map((r) => `  - ${r.path} [${r.methods.join(", ")}]`)
      .join("\n");
    assert.fail(
      `AUTH-COVERAGE FAIL: ${unprotected.length} route(s) expose mutation methods ` +
        `without calling requireApiKey:\n${detail}\n\n` +
        `Every POST/PUT/PATCH/DELETE route must gate behind requireApiKey(req.headers).`,
    );
  }

  // Emit summary to stdout so the CI log records what was checked.
  console.log(
    `AUTH-COVERAGE PASS: ${routes.length} route file(s) scanned, ` +
      `0 unprotected mutation handlers found.`,
  );
});

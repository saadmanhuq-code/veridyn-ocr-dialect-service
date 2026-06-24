/**
 * Standalone integrity gate runner — emits the verdict JSON required by the PR.
 *
 * Usage:
 *   npx tsx scripts/integrity-gate.ts
 *
 * Exits 0 on PASS, 1 on FAIL/PUSHBACK.
 * Emits JSON to stdout on completion.
 */

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { detectUnprotectedRoutes, collectRouteFiles } from "../lib/integrity-auth-coverage.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function headSha(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Gate: AUTH-COVERAGE
// ---------------------------------------------------------------------------

interface Finding {
  severity: "Blocker" | "Major" | "Minor";
  text: string;
}

interface VerdictJson {
  verdict: "PASS" | "PUSHBACK" | "FAIL";
  findings: Finding[];
  guards_run: string[];
  guards_passed: string[];
  ran_at: string;
  harness_sha: string;
}

const findings: Finding[] = [];
const guardsRun: string[] = [];
const guardsPassed: string[] = [];

// AUTH-COVERAGE guard
guardsRun.push("AUTH-COVERAGE");

const appApiDir = join(REPO_ROOT, "app", "api");
let routeCount = 0;
try {
  const routes = collectRouteFiles(appApiDir);
  routeCount = routes.length;

  if (routes.length === 0) {
    findings.push({
      severity: "Blocker",
      text: `AUTH-COVERAGE: FS collector returned zero route files under ${appApiDir}. Cannot verify auth coverage.`,
    });
  } else {
    const unprotected = detectUnprotectedRoutes(routes);
    if (unprotected.length === 0) {
      guardsPassed.push("AUTH-COVERAGE");
      console.error(
        `AUTH-COVERAGE PASS: ${routes.length} route file(s) scanned, 0 unprotected mutation handlers.`,
      );
    } else {
      for (const r of unprotected) {
        findings.push({
          severity: "Blocker",
          text: `AUTH-COVERAGE: ${r.path} exposes ${r.methods.join(", ")} without requireApiKey.`,
        });
      }
    }
  }
} catch (e) {
  findings.push({
    severity: "Blocker",
    text: `AUTH-COVERAGE: collector threw — ${e instanceof Error ? e.message : String(e)}`,
  });
}

// N/A guards — documented with rationale
const naGuards = [
  "REQUIRED-ENV (N/A: all env vars are optional-chained; service fails-closed at request time via requireApiKey/provider-fallback, not at boot)",
  "NO-ORPHAN-HANDLER (N/A: Next.js app-router auto-wires every exported HTTP method from route.ts; no manual dispatch registry exists)",
  "BOOT/WIRING (N/A: no composition root or DI container; framework bootstraps from file structure)",
  "MONEY/FSM/AUDIT/LEDGER (N/A: no monetary transactions, no FSM, corpus-log is fire-and-forget append, not a double-entry ledger)",
];

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

let verdict: VerdictJson["verdict"];
if (findings.some((f) => f.severity === "Blocker")) {
  verdict = "FAIL";
} else if (findings.some((f) => f.severity === "Major")) {
  verdict = "PUSHBACK";
} else {
  verdict = "PASS";
}

const result: VerdictJson = {
  verdict,
  findings,
  guards_run: guardsRun,
  guards_passed: guardsPassed,
  ran_at: new Date().toISOString(),
  harness_sha: headSha(),
};

console.log(JSON.stringify(result, null, 2));

// Surface N/A rationales to stderr so they appear in CI logs without polluting the JSON
console.error("\nN/A guards:");
for (const na of naGuards) {
  console.error(`  - ${na}`);
}
console.error(`\nRoutes scanned: ${routeCount}`);

process.exit(verdict === "PASS" ? 0 : 1);

/**
 * Wrapper that sets the ledger-check env var and re-runs the integrity test
 * against the already-generated test report. Windows-friendly alternative to
 * `INTEGRITY_LEDGER_CHECK=1 node ...` which does not work in cmd.exe.
 */

import { spawnSync } from "node:child_process";

process.env.INTEGRITY_LEDGER_CHECK = "1";

const result = spawnSync(
  "node",
  ["--import", "tsx", "--test", "lib/integrity.test.ts"],
  { stdio: "inherit", env: process.env, shell: false }
);

process.exit(result.status ?? 1);

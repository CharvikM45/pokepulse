import { spawnSync } from "node:child_process";
// Executes the deterministic PostgreSQL fixture scenarios: transitions, outage, stale suppression,
// replay dedup, lease recovery, quotas, privacy and isolation. Never calls a retailer.
const run = spawnSync(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "tests/integration/database.test.ts",
    "--reporter=verbose",
  ],
  { stdio: "inherit", env: process.env },
);
process.exitCode = run.status ?? 1;

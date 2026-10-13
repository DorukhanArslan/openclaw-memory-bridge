import "../src/load-env.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Lab, PROJECT } from "../src/lab.ts";
import {
  createLifecycleLedger,
  readLifecycleLedger,
} from "../src/lifecycle-request-budget.ts";

if (process.argv.length !== 2)
  throw new Error("Fixed Maya maintenance takes no arguments.");
const evidence = join(PROJECT, "evidence/maya-maintenance-2026-10-13");
await mkdir(evidence, { recursive: true, mode: 0o700 });
const ledger = join(evidence, "request-ledger.json");
try {
  createLifecycleLedger(ledger, "maintenance");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  const stored = readLifecycleLedger(ledger);
  if (
    stored.profile !== "maintenance" ||
    stored.requests ||
    stored.inputBytes ||
    stored.outputTokens
  )
    throw new Error(
      "Continuation ledger is consumed. Preserve it; do not reset or automatically replay.",
    );
}
const lab = await new Lab(
  "w-c4b42d5e46db88eb0f9c6660f653a2158b1cfe11",
  join(PROJECT, ".lab-test-e2e-conversation"),
).init();
let last = "";
try {
  const result = await lab.boundedMayaMaintenance(ledger, async (value) => {
    await writeFile(
      join(evidence, "acceptance.json"),
      JSON.stringify(value, null, 2),
      { mode: 0o600 },
    );
    const step = (
      value.steps as Array<{
        id: string;
        bot?: string;
        error?: string;
        changes?: Array<{ path: string }>;
      }>
    ).at(-1);
    if (step && step.id !== last) {
      last = step.id;
      console.log(
        JSON.stringify({
          step: step.id,
          bot: step.bot ?? null,
          failed: Boolean(step.error),
          changedFiles: step.changes?.map((c) => c.path),
          ledger: value.requestLedger,
        }),
      );
    }
  });
  console.log(
    JSON.stringify({
      stages: result.stages,
      failed: Boolean(result.error),
      beforeBudget: result.beforeBudget,
      afterBudget: result.afterBudget,
      ledger: result.requestLedger,
    }),
  );
  if (result.error) process.exitCode = 2;
} finally {
  await lab.close();
}

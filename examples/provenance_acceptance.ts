import "../src/load-env.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Lab, PROJECT } from "../src/lab.ts";
import { createLifecycleLedger } from "../src/lifecycle-request-budget.ts";

if (process.argv.length !== 2)
  throw new Error("Fixed acceptance takes no arguments.");
const evidence = join(PROJECT, "evidence/provenance-bounded-acceptance");
await mkdir(evidence, { recursive: true, mode: 0o700 });
const ledger = join(evidence, "request-ledger.json");
try {
  createLifecycleLedger(ledger, "consolidation");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  const prior = JSON.parse(await readFile(ledger, "utf8"));
  if (prior.requests || prior.inputBytes || prior.outputTokens)
    throw new Error("Dispatched acceptance cannot be repeated automatically.");
}
// Retain the native session and its workspace for audit. Never copy its sources
// into another workspace and never alter the native memory database.
const lab = await new Lab(
  "provenance",
  join(PROJECT, ".lab-test-provenance-bounded"),
).init();
try {
  const result = await lab.boundedProvenanceAcceptance(ledger);
  await writeFile(
    join(evidence, "acceptance.json"),
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      stages: result.stages,
      error: result.error,
      beforeBudget: result.beforeBudget,
      afterBudget: result.afterBudget,
      ledger: result.requestLedger,
    }),
  );
  if (
    result.error ||
    Object.values(result.stages as object).some((value) => value !== "pass")
  )
    process.exitCode = 2;
} finally {
  await lab.close();
}

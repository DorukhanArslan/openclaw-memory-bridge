import "../src/load-env.ts";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Lab, PROJECT } from "../src/lab.ts";
import { createLifecycleLedger } from "../src/lifecycle-request-budget.ts";
import { requireEnvironment } from "../src/project-env.ts";

requireEnvironment(["OPENROUTER_API_KEY"]);
if (process.argv.length !== 2)
  throw new Error("Fixed acceptance takes no arguments.");
const evidence = join(PROJECT, "evidence/lifecycle-acceptance");
await mkdir(evidence, { recursive: true, mode: 0o700 });
const ledger = join(evidence, "request-ledger-consolidation.json");
try {
  createLifecycleLedger(ledger);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  const prior = JSON.parse(await readFile(ledger, "utf8"));
  if (
    prior.requests !== 0 ||
    prior.inputBytes !== 0 ||
    prior.outputTokens !== 0
  )
    throw new Error(
      "Dispatched consolidation acceptance cannot be repeated automatically.",
    );
}
const root = await mkdtemp(join(PROJECT, ".lab-test-consolidation-"));
const lab = await new Lab("consolidation", root).init();
try {
  const result = await lab.boundedConsolidation(ledger);
  await writeFile(
    join(evidence, "consolidation.json"),
    JSON.stringify(result, null, 2),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      stages: result.stages,
      error: result.error,
      beforeBudget: result.beforeBudget,
      afterBudget: result.afterBudget,
      requests: result.requestLedger,
    }),
  );
  if (
    result.error ||
    Object.values(result.stages as object).some(
      (value) => typeof value === "string" && value !== "pass",
    )
  )
    process.exitCode = 2;
} finally {
  await lab.close();
  await rm(root, { recursive: true, force: true });
}

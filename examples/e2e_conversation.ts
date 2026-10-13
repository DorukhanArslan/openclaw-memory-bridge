import "../src/load-env.ts";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Lab, PROJECT } from "../src/lab.ts";
import { createLifecycleLedger } from "../src/lifecycle-request-budget.ts";

if (process.argv.length !== 2)
  throw new Error("This fixed conversation takes no execution arguments.");
const evidence = join(PROJECT, "evidence/e2e-conversation");
await mkdir(evidence, { recursive: true, mode: 0o700 });
const ledger = join(evidence, "request-ledger.json");
// New explicit scenario, never reuse, reset, or rename an old consumed ledger.
createLifecycleLedger(ledger, "conversation");
const name =
  "w-" +
  createHash("sha256")
    .update(JSON.stringify(["chat-demo", "maya"]))
    .digest("hex")
    .slice(0, 40);
const root = join(PROJECT, ".lab-test-e2e-conversation");
const lab = await new Lab(name, root).init();
let lastStep = "";
try {
  const result = await lab.boundedConversationDemo(ledger, async (value) => {
    await writeFile(
      join(evidence, "conversation.json"),
      JSON.stringify(value, null, 2),
      { mode: 0o600 },
    );
    const steps = value.steps as Array<{
      id: string;
      bot?: string;
      changes?: Array<{ path: string }>;
    }>;
    const step = steps.at(-1);
    if (step && step.id !== lastStep) {
      lastStep = step.id;
      console.log(
        JSON.stringify({
          step: step.id,
          bot: step.bot ?? null,
          changedFiles: step.changes?.map((change) => change.path),
          ledger: value.requestLedger,
        }),
      );
    }
  });
  console.log(
    JSON.stringify({
      stages: result.stages,
      error: result.error,
      beforeBudget: result.beforeBudget,
      afterBudget: result.afterBudget,
      ledger: result.requestLedger,
    }),
  );
  if (result.error) process.exitCode = 2;
} finally {
  await lab.close();
}

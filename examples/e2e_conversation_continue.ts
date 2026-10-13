import "../src/load-env.ts";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Lab, PROJECT } from "../src/lab.ts";
import { readLifecycleLedger } from "../src/lifecycle-request-budget.ts";

if (process.argv.length !== 2)
  throw new Error("Fixed continuation takes no arguments.");
const evidence = join(PROJECT, "evidence/e2e-conversation");
const ledger = join(evidence, "request-ledger.json");
const before = readLifecycleLedger(ledger);
if (
  before.requests !== 11 ||
  before.inputBytes !== 199505 ||
  before.outputTokens !== 5632
)
  throw new Error(
    "Retained partial ledger mismatch; no reset or rename is allowed.",
  );
const previous = JSON.parse(
  await readFile(join(evidence, "conversation.json"), "utf8"),
);
await writeFile(
  join(evidence, "initial-attempt.json"),
  JSON.stringify(previous, null, 2),
  { flag: "wx", mode: 0o600 },
);
const name =
  "w-" +
  createHash("sha256")
    .update(JSON.stringify(["chat-demo", "maya"]))
    .digest("hex")
    .slice(0, 40);
const lab = await new Lab(
  name,
  join(PROJECT, ".lab-test-e2e-conversation"),
).init();
let last = "";
try {
  const result = await lab.boundedConversationDemo(
    ledger,
    async (value) => {
      await writeFile(
        join(evidence, "conversation.json"),
        JSON.stringify(value, null, 2),
        { mode: 0o600 },
      );
      const step = (
        value.steps as Array<{
          id: string;
          bot?: string;
          changes?: Array<{ path: string }>;
        }>
      ).at(-1);
      if (step && step.id !== last) {
        last = step.id;
        console.log(
          JSON.stringify({
            step: step.id,
            bot: step.bot ?? null,
            changedFiles: step.changes?.map((c) => c.path),
            ledger: value.requestLedger,
          }),
        );
      }
    },
    previous,
  );
  console.log(
    JSON.stringify({
      stages: result.stages,
      error: result.error,
      beforeBudget: result.beforeBudget,
      continuationBudget: result.continuationBudget,
      afterBudget: result.afterBudget,
      ledger: result.requestLedger,
    }),
  );
  if (result.error) process.exitCode = 2;
} finally {
  await lab.close();
}

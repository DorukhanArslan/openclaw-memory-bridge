import "../src/load-env.ts";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Lab, PROJECT } from "../src/lab.ts";

if (process.argv.length !== 2)
  throw new Error("The fixed final adapter takes no arguments.");
const evidence = join(PROJECT, "evidence/e2e-conversation");
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
try {
  const result = await lab.boundedConversationFinalAnswer(
    join(evidence, "request-ledger.json"),
  );
  await writeFile(
    join(evidence, "final-answer.json"),
    JSON.stringify(result, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    JSON.stringify({
      bot: result.bot,
      adapter: result.adapter,
      ledger: result.requestLedger,
    }),
  );
} catch (error) {
  console.error(JSON.stringify({ error: (error as Error).message }));
  process.exitCode = 2;
} finally {
  await lab.close();
}

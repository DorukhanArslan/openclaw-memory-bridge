import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { PAID_SELECTION, probeBudget } from "../src/budget-preflight.ts";
import { Lab, PROJECT } from "../src/lab.ts";

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== "--key-limit-confirmed") {
  console.info("Usage: npm run budget:preflight -- --key-limit-confirmed");
  console.info(
    "Confirm the provider key limit is 5 USD with reset disabled before this read-only native quota check. It never starts paid tests.",
  );
  process.exitCode = 2;
} else {
  let root: string | undefined;
  let lab: Lab | undefined;
  try {
    root = await mkdtemp(join(PROJECT, ".lab-test-"));
    lab = await new Lab("budget", root).init();
    await lab.configureNativeModel(PAID_SELECTION.chat, PAID_SELECTION.keyEnv);
    const owner = lab;
    const result = await probeBudget(true, () => owner.providerUsage());
    console.info(
      JSON.stringify(
        {
          ...result,
          selection: {
            chat: PAID_SELECTION.chat,
            embedding: PAID_SELECTION.embedding,
          },
          inference: { requests: 0, tokens: 0, retries: 0, backgroundJobs: 0 },
          unsupported: [
            "Native usage omits explicit raw limit_reset=null evidence.",
            "Native status is a snapshot, not an atomic spend reservation.",
            "No verified hook bounds all agent, utility and embedding requests.",
          ],
        },
        null,
        2,
      ),
    );
    process.exitCode = 3; // Eligible snapshot still grants no paid-run admission.
  } catch {
    console.error(
      "Native budget preflight unavailable; paid execution denied.",
    );
    process.exitCode = 3;
  } finally {
    await lab?.close();
    if (root) await rm(root, { recursive: true, force: true });
  }
}

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { PAID_SELECTION, probeBudget } from "../src/budget-preflight.ts";
import { Lab, PROJECT } from "../src/lab.ts";
import {
  MissingEnvironmentError,
  requireEnvironment,
} from "../src/project-env.ts";

const args = process.argv.slice(2);
const expectedLimit = args.includes("--provider-limit=50") ? 50 : 5;
if (
  !args.includes("--key-limit-confirmed") ||
  args.length !== (expectedLimit === 50 ? 2 : 1)
) {
  console.info(
    "Usage: npm run budget:preflight -- --key-limit-confirmed [--provider-limit=50]",
  );
  console.info(
    "Confirm the exact provider key limit (default 5 USD; explicit 50 USD) before this read-only quota check. The test budget remains 5 USD; this never starts paid tests.",
  );
  process.exitCode = 2;
} else {
  let root: string | undefined;
  let lab: Lab | undefined;
  try {
    requireEnvironment([PAID_SELECTION.keyEnv]);
    root = await mkdtemp(join(PROJECT, ".lab-test-"));
    lab = await new Lab("budget", root).init();
    await lab.configureNativeModel(PAID_SELECTION.chat, PAID_SELECTION.keyEnv);
    const owner = lab;
    const result = await probeBudget(
      true,
      () => owner.providerUsage(),
      undefined,
      expectedLimit,
    );
    console.info(
      JSON.stringify(
        {
          ...result,
          providerLimitUsd: expectedLimit,
          testBudgetUsd: 5,
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
  } catch (error) {
    if (error instanceof MissingEnvironmentError) console.error(error.message);
    console.error(
      "Native budget preflight unavailable; paid execution denied.",
    );
    process.exitCode = 3;
  } finally {
    await lab?.close();
    if (root) await rm(root, { recursive: true, force: true });
  }
}

import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Lab, PROJECT } from "../src/lab.ts";
import {
  confirmSmoke,
  SMOKE,
  type SmokeConfirmations,
} from "../src/paid-smoke.ts";
import {
  MissingEnvironmentError,
  requireEnvironment,
} from "../src/project-env.ts";

// The user approved a 5 USD test budget and reported this exact 50 USD key cap.
// No reset/exclusive-use claim is needed for the finite run estimate.
const policy: SmokeConfirmations = {
  keyLimit: true,
  providerLimitUsd: 50,
  prices: SMOKE.prices,
};
let lab: Lab | undefined;
let root: string | undefined;
try {
  if (process.argv.length !== 2)
    throw new Error(
      "This smoke has no configurable model or execution arguments.",
    );
  confirmSmoke(policy);
  requireEnvironment(["OPENROUTER_API_KEY"]);
  root = await mkdtemp(join(PROJECT, ".lab-test-smoke-"));
  lab = await new Lab("smoke", root).init();
  console.log(JSON.stringify(await lab.boundedSmoke(policy), null, 2));
} catch (error) {
  if (error instanceof MissingEnvironmentError) console.error(error.message);
  // No raw provider status, native error, account labels or credentials are printed.
  console.error(
    JSON.stringify({
      mode: "failed",
      chatEmbedding: "not accepted",
      consolidation: "pending",
    }),
  );
  process.exitCode = 2;
} finally {
  await lab?.close();
  if (root) await rm(root, { recursive: true, force: true });
}

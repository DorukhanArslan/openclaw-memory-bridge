import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Lab, ONE_RUN_SMOKE_RESULT, PROJECT } from "../src/lab.ts";
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
// A durable pre-dispatch receipt admits the current run once. It is not a
// reconstruction of historical spending or a cumulative-budget acceptance.
const policy: SmokeConfirmations = {
  keyLimit: true,
  providerLimitUsd: 50,
  prices: SMOKE.prices,
};
let lab: Lab | undefined;
let root: string | undefined;
let completed = false;
try {
  if (process.argv.length !== 2)
    throw new Error(
      "This smoke has no configurable model or execution arguments.",
    );
  confirmSmoke(policy);
  requireEnvironment(["OPENROUTER_API_KEY"]);
  root = await mkdtemp(join(PROJECT, ".lab-test-smoke-"));
  lab = await new Lab("smoke", root).init();
  const result = await lab.boundedSmoke(policy);
  await writeFile(
    ONE_RUN_SMOKE_RESULT,
    `${JSON.stringify(result, null, 2)}\n`,
    {
      flag: "wx",
      mode: 0o600,
    },
  );
  console.log(JSON.stringify(result, null, 2));
  completed = true;
} catch (error) {
  if (error instanceof MissingEnvironmentError) console.error(error.message);
  // No raw provider status, native error, account labels or credentials are printed.
  console.error(
    JSON.stringify({
      mode: "failed",
      chatEmbedding: "not accepted",
      consolidation: "pending",
      ...(root ? { diagnostics: relative(PROJECT, root) } : {}),
    }),
  );
  process.exitCode = 2;
} finally {
  await lab?.close();
  if (root && completed) await rm(root, { recursive: true, force: true });
}

import "../src/load-env.ts";
import { mkdir, mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PAID_SELECTION } from "../src/budget-preflight.ts";
import { Lab, PROJECT } from "../src/lab.ts";
import {
  createOneUserAdmission,
  inspectOneUserQuota,
  ONE_USER_DIRECTORY,
  ONE_USER_LIMITS,
  ONE_USER_REPORT,
} from "../src/one-user-budget.ts";
import { ONE_USER_REQUIRED_STAGES } from "../src/one-user-lifecycle.ts";
import { verifyOneUserPrices } from "../src/one-user-prices.ts";
import { verifySmokeRuntime } from "../src/paid-smoke.ts";
import { requireEnvironment } from "../src/project-env.ts";

if (process.argv.length !== 2)
  throw new Error(
    "The fixed one-user acceptance takes no execution arguments.",
  );

let probeRoot: string | undefined;
let probe: Lab | undefined;
let lab: Lab | undefined;
let admitted = false;
let lastStep = "";
let phase = "configuration";

async function checkpoint(value: Record<string, unknown>) {
  const next = `${ONE_USER_REPORT}.next`;
  const file = await open(next, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(next, ONE_USER_REPORT);
  const directory = await open(ONE_USER_DIRECTORY, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  const steps = Array.isArray(value.steps) ? value.steps : [];
  const step = steps.at(-1) as { id?: string } | undefined;
  if (step?.id && step.id !== lastStep) {
    lastStep = step.id;
    console.log(
      JSON.stringify({
        step: step.id,
        stages: value.stages,
        requests: value.requestLedger,
      }),
    );
  }
}

try {
  requireEnvironment([PAID_SELECTION.keyEnv]);
  await verifySmokeRuntime();
  phase = "price metadata";
  const prices = await verifyOneUserPrices();
  // Configuration and native quota metadata only. No live approval or model
  // permission is consumed if a prerequisite fails in this temporary probe.
  probeRoot = await mkdtemp(join(PROJECT, ".lab-test-one-user-quota-"));
  phase = "native quota";
  probe = await new Lab("quota", probeRoot).init();
  await probe.configureNativeModel(PAID_SELECTION.chat, PAID_SELECTION.keyEnv);
  const quota = inspectOneUserQuota(await probe.providerUsage());
  await probe.close();
  probe = undefined;
  await rm(probeRoot, { recursive: true, force: true });
  probeRoot = undefined;

  await mkdir(dirname(ONE_USER_DIRECTORY), { recursive: true, mode: 0o700 });
  phase = "scenario admission";
  // A distinct current scenario, never the consumed smoke or a reconstructed
  // historical lifecycle. Even a partial directory denies automatic replay.
  createOneUserAdmission(ONE_USER_DIRECTORY, quota);
  admitted = true;
  await writeFile(
    join(ONE_USER_DIRECTORY, "preflight.json"),
    `${JSON.stringify({ quota, prices, limits: ONE_USER_LIMITS }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      scenario: "one-user-lifecycle",
      admitted: true,
      estimatedUsd: ONE_USER_LIMITS.estimatedUsd,
      currentWorkEstimateUsd: ONE_USER_LIMITS.currentWorkEstimateUsd,
      estimateIsHardCap: false,
      observedPeriod: quota.observedPeriod,
      cumulativeHistoryVerified: false,
    }),
  );
  lab = await new Lab("one-user", join(ONE_USER_DIRECTORY, "corpus")).init();
  phase = "native lifecycle";
  const result = await lab.boundedOneUserLifecycle(checkpoint);
  const stages = result.stages as Record<string, unknown>;
  const accepted =
    result.ok === true &&
    !result.error &&
    !result.evidenceError &&
    !result.cleanupError &&
    ONE_USER_REQUIRED_STAGES.every((stage) => stages[stage] === "pass");
  console.log(
    JSON.stringify({
      accepted,
      stages,
      error: result.error,
      evidenceError: result.evidenceError,
      cleanupError: result.cleanupError,
      requests: result.requestLedger,
      report: ".lab/one-user-lifecycle/report.json",
    }),
  );
  if (!accepted) process.exitCode = 2;
} catch {
  console.error(
    JSON.stringify({
      accepted: false,
      admitted,
      phase,
      error:
        "One-user acceptance stopped; preserve any existing admission and evidence.",
      diagnostics: admitted ? ".lab/one-user-lifecycle" : "preflight only",
    }),
  );
  process.exitCode = 2;
} finally {
  await lab?.close();
  await probe?.close();
  if (probeRoot) await rm(probeRoot, { recursive: true, force: true });
}

import "../src/load-env.ts";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PAID_SELECTION } from "../src/budget-preflight.ts";
import { Lab, PROJECT } from "../src/lab.ts";
import { ONE_USER_DIRECTORY } from "../src/one-user-budget.ts";
import { ONE_USER_FOLLOWUP_REQUIRED_STAGES } from "../src/one-user-followup.ts";
import {
  createOneUserFollowupAdmission,
  inspectOneUserFollowupPredecessor,
  inspectOneUserFollowupQuota,
  ONE_USER_FOLLOWUP_DIRECTORY,
  ONE_USER_FOLLOWUP_LIMITS,
  ONE_USER_FOLLOWUP_REPORT,
} from "../src/one-user-followup-budget.ts";
import { verifyOneUserPrices } from "../src/one-user-prices.ts";
import { verifySmokeRuntime } from "../src/paid-smoke.ts";
import { requireEnvironment } from "../src/project-env.ts";

if (process.argv.length !== 2)
  throw new Error("The fixed maintenance follow-up takes no arguments.");

let probeRoot: string | undefined;
let probe: Lab | undefined;
let lab: Lab | undefined;
let admitted = false;
let phase = "configuration";
let lastStep = "";

async function checkpoint(value: Record<string, unknown>) {
  const next = `${ONE_USER_FOLLOWUP_REPORT}.next`;
  const file = await open(next, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(next, ONE_USER_FOLLOWUP_REPORT);
  const directory = await open(ONE_USER_FOLLOWUP_DIRECTORY, "r");
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
  if (existsSync(ONE_USER_FOLLOWUP_DIRECTORY))
    throw new Error("Existing follow-up context; automatic replay denied.");
  phase = "predecessor evidence";
  const predecessor = inspectOneUserFollowupPredecessor();
  phase = "price metadata";
  const prices = await verifyOneUserPrices();
  probeRoot = await mkdtemp(
    join(PROJECT, ".lab-test-one-user-followup-quota-"),
  );
  phase = "native quota";
  probe = await new Lab("quota", probeRoot).init();
  await probe.configureNativeModel(PAID_SELECTION.chat, PAID_SELECTION.keyEnv);
  const quota = inspectOneUserFollowupQuota(await probe.providerUsage());
  await probe.close();
  probe = undefined;
  await rm(probeRoot, { recursive: true, force: true });
  probeRoot = undefined;
  phase = "follow-up admission";
  await mkdir(dirname(ONE_USER_FOLLOWUP_DIRECTORY), {
    recursive: true,
    mode: 0o700,
  });
  // This new explicit continuation binds every consumed predecessor reservation.
  // It never resets, resumes or renames the original lifecycle allowance.
  createOneUserFollowupAdmission(ONE_USER_FOLLOWUP_DIRECTORY, quota);
  admitted = true;
  await writeFile(
    join(ONE_USER_FOLLOWUP_DIRECTORY, "preflight.json"),
    `${JSON.stringify({ quota, prices, predecessor, limits: ONE_USER_FOLLOWUP_LIMITS }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      scenario: "one-user-maintenance-followup",
      admitted: true,
      estimatedUsd: ONE_USER_FOLLOWUP_LIMITS.estimatedUsd,
      combinedEstimateUsd: predecessor.combinedEstimateUsd,
      refundApplied: false,
      estimateIsHardCap: false,
    }),
  );
  lab = await new Lab("one-user", join(ONE_USER_DIRECTORY, "corpus")).init();
  phase = "native maintenance follow-up";
  const result = await lab.boundedOneUserFollowup(checkpoint);
  const stages = result.stages as Record<string, unknown>;
  const accepted =
    result.ok === true &&
    !result.error &&
    !result.evidenceError &&
    !result.cleanupError &&
    ONE_USER_FOLLOWUP_REQUIRED_STAGES.every(
      (stage) => stages[stage] === "pass",
    );
  console.log(
    JSON.stringify({
      accepted,
      stages,
      error: result.error,
      evidenceError: result.evidenceError,
      cleanupError: result.cleanupError,
      requests: result.requestLedger,
      report: ".lab/one-user-maintenance-followup/report.json",
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
        "Maintenance follow-up stopped; preserve all original and follow-up evidence.",
      diagnostics: admitted
        ? ".lab/one-user-maintenance-followup"
        : "preflight only",
    }),
  );
  process.exitCode = 2;
} finally {
  await lab?.close();
  await probe?.close();
  if (probeRoot) await rm(probeRoot, { recursive: true, force: true });
}

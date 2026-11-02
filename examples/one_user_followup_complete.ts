import "../src/load-env.ts";
import { existsSync } from "node:fs";
import { mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PAID_SELECTION } from "../src/budget-preflight.ts";
import { Lab, PROJECT } from "../src/lab.ts";
import { ONE_USER_DIRECTORY } from "../src/one-user-budget.ts";
import { ONE_USER_FOLLOWUP_REQUIRED_STAGES } from "../src/one-user-followup.ts";
import {
  inspectOneUserFollowupQuota,
  ONE_USER_FOLLOWUP_COMPLETION,
  ONE_USER_FOLLOWUP_COMPLETION_REPORT,
  ONE_USER_FOLLOWUP_DIRECTORY,
  ONE_USER_FOLLOWUP_LEDGER,
  readOneUserFollowupLedger,
} from "../src/one-user-followup-budget.ts";
import { verifyOneUserPrices } from "../src/one-user-prices.ts";
import { verifySmokeRuntime } from "../src/paid-smoke.ts";
import { requireEnvironment } from "../src/project-env.ts";

if (process.argv.length !== 2)
  throw new Error("The fixed remaining-stage completion takes no arguments.");
let probeRoot: string | undefined;
let probe: Lab | undefined;
let lab: Lab | undefined;
let phase = "owned-source checkpoint";
let lastStep = "";
async function checkpoint(value: Record<string, unknown>) {
  const next = `${ONE_USER_FOLLOWUP_COMPLETION_REPORT}.next`;
  const file = await open(next, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(next, ONE_USER_FOLLOWUP_COMPLETION_REPORT);
  const directory = await open(ONE_USER_FOLLOWUP_DIRECTORY, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  const step = Array.isArray(value.steps)
    ? (value.steps.at(-1) as { id?: string })
    : undefined;
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
  if (existsSync(ONE_USER_FOLLOWUP_COMPLETION))
    throw new Error("Completion checkpoint already consumed; no replay.");
  const ledger = readOneUserFollowupLedger(ONE_USER_FOLLOWUP_LEDGER);
  if (!ledger.chatRequests)
    throw new Error(
      "Completion requires the verified owned-source checkpoint.",
    );
  phase = "price metadata";
  const prices = await verifyOneUserPrices();
  phase = "native quota";
  probeRoot = await mkdtemp(join(PROJECT, ".lab-test-followup-repair-quota-"));
  probe = await new Lab("quota", probeRoot).init();
  await probe.configureNativeModel(PAID_SELECTION.chat, PAID_SELECTION.keyEnv);
  const quota = inspectOneUserFollowupQuota(await probe.providerUsage());
  await probe.close();
  probe = undefined;
  await rm(probeRoot, { recursive: true, force: true });
  probeRoot = undefined;
  await writeFile(
    join(ONE_USER_FOLLOWUP_DIRECTORY, "completion-preflight.json"),
    `${JSON.stringify({ quota, prices, sameLedger: true, counterReset: false, limitIncrease: false }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  phase = "exclusive corpus and completion checkpoint";
  lab = await new Lab("one-user", join(ONE_USER_DIRECTORY, "corpus")).init();
  const result = await lab.completeOneUserFollowup(quota, checkpoint);
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
      report: ".lab/one-user-maintenance-followup/completion-report.json",
    }),
  );
  if (!accepted) process.exitCode = 2;
} catch {
  console.error(
    JSON.stringify({
      accepted: false,
      phase,
      error:
        "Checkpoint completion stopped; keep all consumed records, counters and reports.",
    }),
  );
  process.exitCode = 2;
} finally {
  await lab?.close();
  await probe?.close();
  if (probeRoot) await rm(probeRoot, { recursive: true, force: true });
}

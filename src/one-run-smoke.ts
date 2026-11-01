import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { PAID_SELECTION } from "./budget-preflight.ts";
import { confirmSmoke, SMOKE, type SmokeConfirmations } from "./paid-smoke.ts";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const PERIODS = ["daily", "weekly", "monthly"] as const;
type ResetPeriod = (typeof PERIODS)[number];

export type OneRunSmokeBudget = Readonly<{
  limitUsd: number;
  usedUsd: number;
  remainingUsd: number;
  snapshotUpdatedAt: number;
  observedPeriod: ResetPeriod | "not-reported";
  usageScope: "reset-window" | "native-reported";
  approvalScope: "one-run-fixed-smoke";
  cumulativeHistoryVerified: false;
}>;

function fresh(timestamp: unknown, now: number): timestamp is number {
  return (
    typeof timestamp === "number" &&
    Number.isFinite(timestamp) &&
    Number.isFinite(now) &&
    timestamp <= now + 1000 &&
    now - timestamp <= 30000
  );
}

function resetPeriod(value: unknown): value is ResetPeriod {
  return PERIODS.some((period) => value === period);
}

/** Eligibility for the fixed smoke only; this never establishes historical spend. */
export function oneRunSmokeBudget(
  status: unknown,
  confirmations: SmokeConfirmations,
  now = Date.now(),
): OneRunSmokeBudget {
  confirmSmoke(confirmations);
  if (
    !record(status) ||
    !record(status.usage) ||
    !fresh(status.usage.updatedAt, now) ||
    !Array.isArray(status.usage.providers)
  )
    throw new Error("One-run smoke denied: missing or stale native usage.");
  const providers = status.usage.providers.filter(
    (provider) => record(provider) && provider.provider === "openrouter",
  );
  const provider = providers[0];
  if (
    providers.length !== 1 ||
    !record(provider) ||
    provider.error ||
    !Array.isArray(provider.billing)
  )
    throw new Error("One-run smoke denied: unavailable or ambiguous provider.");
  const budgets = provider.billing.filter(
    (budget) =>
      record(budget) &&
      budget.type === "budget" &&
      budget.label === "API key budget",
  );
  const budget = budgets[0];
  if (budgets.length !== 1 || !record(budget))
    throw new Error("One-run smoke denied: missing or ambiguous key budget.");
  const period = budget.period;
  if (period !== undefined && !resetPeriod(period))
    throw new Error("One-run smoke denied: unknown quota period.");
  if (
    budget.unit !== "USD" ||
    typeof budget.limit !== "number" ||
    !Number.isFinite(budget.limit) ||
    budget.limit !== (confirmations.providerLimitUsd ?? 5) ||
    typeof budget.used !== "number" ||
    !Number.isFinite(budget.used) ||
    budget.used < 0
  )
    throw new Error("One-run smoke denied: invalid or wrong key limit.");
  const remainingUsd = budget.limit - budget.used;
  if (
    remainingUsd < PAID_SELECTION.minimumHeadroomUsd ||
    remainingUsd < SMOKE.estimatedUsd
  )
    throw new Error(
      "One-run smoke denied: insufficient current quota headroom.",
    );
  return Object.freeze({
    limitUsd: budget.limit,
    usedUsd: budget.used,
    remainingUsd,
    snapshotUpdatedAt: status.usage.updatedAt,
    observedPeriod: period ?? "not-reported",
    usageScope: period === undefined ? "native-reported" : "reset-window",
    approvalScope: "one-run-fixed-smoke",
    cumulativeHistoryVerified: false,
  });
}

/** A durable pre-dispatch claim. Existing or uncertain claims are never repaired. */
export function claimOneRunSmoke(
  path: string,
  budget: OneRunSmokeBudget,
): void {
  if (
    !record(budget) ||
    ![5, 50].includes(budget.limitUsd) ||
    !Number.isFinite(budget.usedUsd) ||
    budget.usedUsd < 0 ||
    !Number.isFinite(budget.remainingUsd) ||
    budget.remainingUsd !== budget.limitUsd - budget.usedUsd ||
    budget.remainingUsd < PAID_SELECTION.minimumHeadroomUsd ||
    budget.remainingUsd < SMOKE.estimatedUsd ||
    !fresh(budget.snapshotUpdatedAt, Date.now()) ||
    !(
      (budget.observedPeriod === "not-reported" &&
        budget.usageScope === "native-reported") ||
      (resetPeriod(budget.observedPeriod) &&
        budget.usageScope === "reset-window")
    ) ||
    budget.approvalScope !== "one-run-fixed-smoke" ||
    budget.cumulativeHistoryVerified !== false ||
    SMOKE.estimatedUsd >= SMOKE.testCeilingUsd
  )
    throw new Error(
      "One-run smoke claim denied: invalid or stale fixed budget.",
    );

  const policy = {
    approvalScope: "one-run-fixed-smoke",
    chatModel: PAID_SELECTION.chat,
    embeddingModel: PAID_SELECTION.embedding,
    prompt: SMOKE.prompt,
    note: SMOKE.note,
    query: SMOKE.query,
    sourcePath: SMOKE.path,
    maxChatRequests: 1,
    maxInputTokens: SMOKE.maxInputTokens,
    maxOutputTokens: SMOKE.maxOutputTokens,
    completionTimeoutMs: SMOKE.timeoutMs,
    estimatedUsd: SMOKE.estimatedUsd,
    confirmedPrices: SMOKE.prices,
    testCeilingUsd: SMOKE.testCeilingUsd,
    estimateIsHardCap: false,
    wrapperRetries: 0,
  };
  const receipt = {
    schemaVersion: 1,
    kind: "one-run-fixed-smoke-admission",
    state: "consumed-before-dispatch",
    claimedAt: new Date().toISOString(),
    quota: {
      limitUsd: budget.limitUsd,
      usedUsd: budget.usedUsd,
      remainingUsd: budget.remainingUsd,
      snapshotUpdatedAt: budget.snapshotUpdatedAt,
      observedPeriod: budget.observedPeriod,
      usageScope: budget.usageScope,
      approvalScope: budget.approvalScope,
      cumulativeHistoryVerified: budget.cumulativeHistoryVerified,
    },
    policy,
    policySha256: createHash("sha256")
      .update(JSON.stringify(policy))
      .digest("hex"),
    automaticReplayAllowed: false,
    cumulativeHistoryVerified: false,
  };
  const target = resolve(path);
  const parent = dirname(target);
  let directory: number;
  try {
    if (
      typeof constants.O_NOFOLLOW !== "number" ||
      typeof constants.O_DIRECTORY !== "number" ||
      realpathSync(parent) !== parent ||
      !lstatSync(parent).isDirectory()
    )
      throw new Error();
    directory = openSync(
      parent,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
  } catch {
    throw new Error(
      "One-run smoke claim denied: unsafe or missing receipt directory.",
    );
  }
  let file: number | undefined;
  try {
    file = openSync(
      target,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
      0o600,
    );
    const state = fstatSync(file);
    if (!state.isFile() || state.nlink !== 1) throw new Error();
    writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
    fsyncSync(file);
    fsyncSync(directory);
  } catch {
    // Even an empty/partial claim is consumed: never unlink after uncertain work.
    throw new Error(
      "One-run smoke claim denied: existing or uncertain admission.",
    );
  } finally {
    if (file !== undefined) closeSync(file);
    closeSync(directory);
  }
}

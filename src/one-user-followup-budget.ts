import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ONE_USER_ADMISSION,
  ONE_USER_DIRECTORY,
  ONE_USER_LEDGER,
  ONE_USER_REPORT,
  ONE_USER_LIMITS as PREDECESSOR_LIMITS,
  readOneUserLedger,
  validateOneUserContext,
} from "./one-user-budget.ts";
import { SMOKE } from "./paid-smoke.ts";

const PROJECT = fileURLToPath(new URL("../", import.meta.url));
export const ONE_USER_FOLLOWUP_DIRECTORY = join(
  PROJECT,
  ".lab/one-user-maintenance-followup",
);
export const ONE_USER_FOLLOWUP_ADMISSION = join(
  ONE_USER_FOLLOWUP_DIRECTORY,
  "admission.json",
);
export const ONE_USER_FOLLOWUP_LEDGER = join(
  ONE_USER_FOLLOWUP_DIRECTORY,
  "ledger.json",
);
export const ONE_USER_FOLLOWUP_REPORT = join(
  ONE_USER_FOLLOWUP_DIRECTORY,
  "report.json",
);
export const ONE_USER_FOLLOWUP_PREPARATION_REPAIR = join(
  ONE_USER_FOLLOWUP_DIRECTORY,
  "preparation-repair.json",
);
export const ONE_USER_FOLLOWUP_PREPARATION_REPAIR_REPORT = join(
  ONE_USER_FOLLOWUP_DIRECTORY,
  "preparation-repair-report.json",
);
export const ONE_USER_FOLLOWUP_COMPLETION = join(
  ONE_USER_FOLLOWUP_DIRECTORY,
  "completion.json",
);
export const ONE_USER_FOLLOWUP_COMPLETION_REPORT = join(
  ONE_USER_FOLLOWUP_DIRECTORY,
  "completion-report.json",
);
export const ONE_USER_FOLLOWUP_LIMITS = Object.freeze({
  chatRequests: 14,
  chatInputBytes: 180000,
  chatInputBytesPerRequest: 100000,
  chatFramingTokensPerRequest: 1024,
  chatOutputPerRequest: 2048,
  chatOutputTokens: 18000,
  embeddingRequests: 32,
  embeddingInputBytes: 100000,
  embeddingBytesPerRequest: 32768,
  embeddingInputsPerRequest: 128,
  embeddingFramingTokensPerRequest: 256,
  utilityOutputTokens: 1024,
  inputUsdPerMillion: 9,
  outputUsdPerMillion: 20,
  embeddingUsdPerMillion: 0.02,
  estimatedUsd:
    ((180000 + 14 * 1024) * 9 + 18000 * 20 + (100000 + 32 * 256) * 0.02) / 1e6,
  knownPriorSmokeEstimateUsd: SMOKE.estimatedUsd,
  testCeilingUsd: 5,
});
export const ONE_USER_FOLLOWUP_PRICE_CEILINGS = Object.freeze({
  inputUsdPerMillion: ONE_USER_FOLLOWUP_LIMITS.inputUsdPerMillion,
  outputUsdPerMillion: ONE_USER_FOLLOWUP_LIMITS.outputUsdPerMillion,
  embeddingUsdPerMillion: ONE_USER_FOLLOWUP_LIMITS.embeddingUsdPerMillion,
});

const SCOPE = "one-user-maintenance-followup";
const CHAT_MODEL = "openai/gpt-6-sol";
const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const POLICY = Object.freeze({
  scope: SCOPE,
  version: 1,
  chatModel: CHAT_MODEL,
  embeddingModel: EMBEDDING_MODEL,
  origin: "https://openrouter.ai",
  limits: ONE_USER_FOLLOWUP_LIMITS,
  estimateIsHardCap: false,
  automaticReplayAllowed: false,
  cumulativeHistoryVerified: false,
});
const policyBytes = JSON.stringify(POLICY);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const POLICY_HASH = hash(policyBytes);
type Dict = Record<string, unknown>;
const record = (x: unknown): x is Dict =>
  x !== null && typeof x === "object" && !Array.isArray(x);
const integer = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const period = (x: unknown): x is "daily" | "weekly" | "monthly" =>
  x === "daily" || x === "weekly" || x === "monthly";
const fresh = (x: unknown, now: number): x is number =>
  typeof x === "number" &&
  Number.isFinite(x) &&
  Number.isFinite(now) &&
  x <= now + 1000 &&
  now - x <= 30000;

export type OneUserFollowupQuota = Readonly<{
  limitUsd: 50;
  usedUsd: number;
  remainingUsd: number;
  snapshotUpdatedAt: number;
  observedPeriod: "daily" | "weekly" | "monthly" | "not-reported";
  usageScope: "reset-window" | "native-reported";
  approvalScope: "one-user-maintenance-followup";
  cumulativeHistoryVerified: false;
}>;
export type OneUserFollowupLedger = {
  schemaVersion: 1;
  kind: "one-user-maintenance-followup-ledger";
  scope: "one-user-maintenance-followup";
  policySha256: string;
  admissionSha256: string;
  requests: number;
  inputBytes: number;
  outputTokens: number;
  chatRequests: number;
  chatInputBytes: number;
  embeddingRequests: number;
  embeddingInputBytes: number;
  updatedAt: string;
  lastDenial?: { code: string; at: string };
};

function validQuota(x: unknown, now?: number): x is OneUserFollowupQuota {
  return (
    record(x) &&
    x.limitUsd === 50 &&
    typeof x.usedUsd === "number" &&
    Number.isFinite(x.usedUsd) &&
    x.usedUsd >= 0 &&
    typeof x.remainingUsd === "number" &&
    x.remainingUsd === 50 - x.usedUsd &&
    x.remainingUsd >= ONE_USER_FOLLOWUP_LIMITS.estimatedUsd &&
    typeof x.snapshotUpdatedAt === "number" &&
    Number.isFinite(x.snapshotUpdatedAt) &&
    (now === undefined || fresh(x.snapshotUpdatedAt, now)) &&
    ((x.observedPeriod === "not-reported" &&
      x.usageScope === "native-reported") ||
      (period(x.observedPeriod) && x.usageScope === "reset-window")) &&
    x.approvalScope === SCOPE &&
    x.cumulativeHistoryVerified === false
  );
}

/** Current provider window only; this does not reconstruct historical spending. */
export function inspectOneUserFollowupQuota(
  status: unknown,
  now = Date.now(),
): OneUserFollowupQuota {
  if (
    !record(status) ||
    !record(status.usage) ||
    !fresh(status.usage.updatedAt, now) ||
    !Array.isArray(status.usage.providers)
  )
    throw new Error(
      "One-user follow-up quota denied: missing or stale native usage.",
    );
  const providers = status.usage.providers.filter(
    (x) => record(x) && x.provider === "openrouter",
  );
  const provider = providers[0];
  if (
    providers.length !== 1 ||
    !record(provider) ||
    provider.error ||
    !Array.isArray(provider.billing)
  )
    throw new Error(
      "One-user follow-up quota denied: unavailable or ambiguous provider.",
    );
  const budgets = provider.billing.filter(
    (x) => record(x) && x.type === "budget" && x.label === "API key budget",
  );
  const b = budgets[0];
  if (
    budgets.length !== 1 ||
    !record(b) ||
    b.unit !== "USD" ||
    b.limit !== 50 ||
    typeof b.used !== "number" ||
    !Number.isFinite(b.used) ||
    b.used < 0 ||
    (b.period !== undefined && !period(b.period))
  )
    throw new Error(
      "One-user follow-up quota denied: invalid or ambiguous key budget.",
    );
  const quota: OneUserFollowupQuota = Object.freeze({
    limitUsd: 50,
    usedUsd: b.used,
    remainingUsd: 50 - b.used,
    snapshotUpdatedAt: status.usage.updatedAt,
    observedPeriod: b.period ?? "not-reported",
    usageScope: b.period === undefined ? "native-reported" : "reset-window",
    approvalScope: SCOPE,
    cumulativeHistoryVerified: false,
  });
  if (
    !validQuota(quota, now) ||
    ONE_USER_FOLLOWUP_LIMITS.estimatedUsd >=
      ONE_USER_FOLLOWUP_LIMITS.testCeilingUsd
  )
    throw new Error(
      "One-user follow-up quota denied: insufficient scenario headroom.",
    );
  const balances = provider.billing.filter(
    (x) => record(x) && x.type === "balance",
  );
  if (
    balances.length > 1 ||
    (balances.length === 1 &&
      (!record(balances[0]) ||
        balances[0].unit !== "USD" ||
        typeof balances[0].amount !== "number" ||
        !Number.isFinite(balances[0].amount) ||
        balances[0].amount < ONE_USER_FOLLOWUP_LIMITS.estimatedUsd))
  )
    throw new Error(
      "One-user follow-up quota denied: insufficient or ambiguous account balance.",
    );
  return quota;
}

function directory(path: string) {
  const target = resolve(path);
  if (
    realpathSync(target) !== target ||
    !lstatSync(target).isDirectory() ||
    (lstatSync(target).mode & 0o077) !== 0
  )
    throw new Error("One-user follow-up context denied: unsafe directory.");
  return target;
}
function syncDirectory(path: string) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function exclusive(path: string, value: unknown) {
  const fd = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o600,
  );
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1) throw new Error();
    writeFileSync(fd, `${JSON.stringify(value)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function safeText(
  path: string,
  replaceableLedger = false,
  maximumBytes = 65536,
) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const st = fstatSync(fd);
    if (
      !st.isFile() ||
      (st.nlink !== 1 && !(replaceableLedger && st.nlink === 0)) ||
      st.size > maximumBytes ||
      (st.mode & 0o077) !== 0
    )
      throw new Error();
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}
function parsed(text: string): Dict {
  const x: unknown = JSON.parse(text);
  if (!record(x)) throw new Error();
  return x;
}

const zeroCounters = (ledger: Dict | OneUserFollowupLedger) =>
  [
    ledger.requests,
    ledger.inputBytes,
    ledger.outputTokens,
    ledger.chatRequests,
    ledger.chatInputBytes,
    ledger.embeddingRequests,
    ledger.embeddingInputBytes,
  ].every((value) => value === 0);
const COUNTER_KEYS = [
  "requests",
  "inputBytes",
  "outputTokens",
  "chatRequests",
  "chatInputBytes",
  "embeddingRequests",
  "embeddingInputBytes",
] as const;
const PREPARATION_STAGES = [
  "sourceOwnerWrite",
  "semanticRecall",
  "promotionEligible",
  "nativeMaintenance",
  "durablePromotion",
  "restartRecall",
  "sessionContinuity",
  "previousEvidencePreserved",
];

function preparationFailure(
  text: string,
  initialLedger: Dict,
  claimedAt: number,
) {
  const report = parsed(text);
  const day = new Date(claimedAt).toISOString().slice(0, 10);
  const sourcePath = `memory/${day}.md`;
  if (
    report.schemaVersion !== 1 ||
    report.kind !== "one-user-owner-maintenance-followup" ||
    report.ok !== false ||
    report.originalAttemptReplayed !== false ||
    report.harnessSourceWrites !== false ||
    report.evidenceError !== undefined ||
    report.cleanupError !== undefined ||
    report.nativeSourceDayUtc !== day ||
    report.sourcePath !== sourcePath ||
    report.sourceSessionKey !== "agent:main:owner-followup" ||
    report.originalMainSessionKey !== "agent:main:main" ||
    !Array.isArray(report.steps) ||
    report.steps.length !== 0 ||
    !record(report.stages) ||
    Object.keys(report.stages).length !== PREPARATION_STAGES.length ||
    !PREPARATION_STAGES.every(
      (stage) =>
        (report.stages as Dict)[stage] ===
        (stage === "previousEvidencePreserved" ? "pass" : "not-run"),
    ) ||
    !record(report.initialWorkspace) ||
    !record(report.finalWorkspace) ||
    JSON.stringify(report.initialWorkspace) !==
      JSON.stringify(report.finalWorkspace) ||
    report.initialWorkspace[sourcePath] !== undefined ||
    report.finalWorkspace[sourcePath] !== undefined ||
    JSON.stringify(report.requestLedger) !== JSON.stringify(initialLedger) ||
    typeof report.startedAt !== "string" ||
    typeof report.finishedAt !== "string" ||
    !Number.isFinite(Date.parse(report.startedAt)) ||
    !Number.isFinite(Date.parse(report.finishedAt)) ||
    Date.parse(report.startedAt) > Date.parse(report.finishedAt) ||
    Date.parse(report.finishedAt) > claimedAt + 1000 ||
    typeof report.error !== "string" ||
    !report.error.startsWith("Memory not ready: ")
  )
    throw new Error();
  const payload = report.error
    .slice("Memory not ready: ".length)
    .split("\nGateway diagnostics: ");
  if (payload.length > 2 || (payload.length === 2 && payload[1] !== ""))
    throw new Error();
  const readiness = parsed(payload[0] ?? "");
  if (
    readiness.disabled !== true ||
    readiness.unavailable !== true ||
    !Array.isArray(readiness.results) ||
    readiness.results.length !== 0 ||
    readiness.error !==
      "index was built for model fts-only, expected openai/text-embedding-3-small"
  )
    throw new Error();
  return sourcePath;
}

function validatePreparationRepair(
  parent: string,
  ledger: OneUserFollowupLedger,
  admission: Dict,
) {
  const repairPath = join(parent, "preparation-repair.json");
  try {
    lstatSync(repairPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const repair = parsed(safeText(repairPath));
  if (
    repair.schemaVersion !== 1 ||
    repair.kind !== "one-user-followup-preparation-repair" ||
    repair.scope !== SCOPE ||
    repair.state !== "consumed-before-preparation-repair" ||
    repair.ledger !== join(parent, "ledger.json") ||
    repair.admissionSha256 !== ledger.admissionSha256 ||
    repair.policySha256 !== POLICY_HASH ||
    repair.activationSha256 !==
      hash(safeText(join(parent, "activation.json"))) ||
    repair.failedReportSha256 !==
      hash(safeText(join(parent, "report.json"), false, 4 * 1024 * 1024)) ||
    repair.reportPath !== join(parent, "preparation-repair-report.json") ||
    repair.automaticReplayAllowed !== false ||
    repair.newAllowanceCreated !== false ||
    typeof repair.claimedAt !== "string" ||
    !Number.isFinite(Date.parse(repair.claimedAt)) ||
    !validQuota(repair.quota, Date.parse(repair.claimedAt)) ||
    !record(repair.initialLedger) ||
    !zeroCounters(repair.initialLedger) ||
    repair.initialLedger.admissionSha256 !== ledger.admissionSha256 ||
    repair.initialLedger.policySha256 !== POLICY_HASH ||
    repair.initialLedgerSha256 !==
      hash(`${JSON.stringify(repair.initialLedger)}\n`) ||
    !record(admission.predecessor) ||
    JSON.stringify(repair.predecessorEvidenceSha256) !==
      JSON.stringify(admission.predecessor.evidenceSha256)
  )
    throw new Error();
  const sourcePath = preparationFailure(
    safeText(join(parent, "report.json"), false, 4 * 1024 * 1024),
    repair.initialLedger,
    Date.parse(repair.claimedAt),
  );
  if (repair.sourcePath !== sourcePath) throw new Error();
}

function sourceIdentity(relativePath: string) {
  if (!/^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(relativePath)) throw new Error();
  const workspace = directory(
    join(ONE_USER_DIRECTORY, "corpus/one-user/workspace"),
  );
  directory(join(workspace, "memory"));
  const fd = openSync(
    join(workspace, relativePath),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > 100000) throw new Error();
    return {
      workspaceKey: hash(workspace),
      fileHash: createHash("sha256").update(readFileSync(fd)).digest("hex"),
    };
  } finally {
    closeSync(fd);
  }
}

function completionBoundary(
  text: string,
  checkpointLedger: Dict,
  claimedAt: number,
  repair: Dict,
) {
  const report = parsed(text);
  const expectedSource = repair.sourcePath;
  if (
    typeof expectedSource !== "string" ||
    !/^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(expectedSource)
  )
    throw new Error();
  const expectedPass = new Set([
    "sourceOwnerWrite",
    "semanticRecall",
    "previousEvidencePreserved",
  ]);
  if (
    report.schemaVersion !== 1 ||
    report.kind !== "one-user-owner-maintenance-followup" ||
    report.ok !== false ||
    report.error !==
      `Unexpected token 's', "[secrets] m"... is not valid JSON` ||
    report.evidenceError !== undefined ||
    report.cleanupError !== undefined ||
    report.originalAttemptReplayed !== false ||
    report.harnessSourceWrites !== false ||
    report.sourceSessionKey !== "agent:main:owner-followup" ||
    report.originalMainSessionKey !== "agent:main:main" ||
    report.sourcePath !== expectedSource ||
    report.nativeSourceDayUtc !== expectedSource.slice(7, 17) ||
    !record(report.stages) ||
    Object.keys(report.stages).length !== PREPARATION_STAGES.length ||
    !PREPARATION_STAGES.every(
      (stage) =>
        (report.stages as Dict)[stage] ===
        (expectedPass.has(stage) ? "pass" : "not-run"),
    ) ||
    !Array.isArray(report.steps) ||
    report.steps.length !== 1 ||
    report.nativePromotionPreview !== undefined ||
    report.maintenance !== undefined ||
    report.restart !== undefined ||
    report.finalRecall !== undefined ||
    report.sourceSessionAfter !== undefined ||
    JSON.stringify(report.requestLedger) !== JSON.stringify(checkpointLedger) ||
    checkpointLedger.requests === 0 ||
    checkpointLedger.chatRequests === 0 ||
    checkpointLedger.embeddingRequests === 0 ||
    checkpointLedger.outputTokens === 0 ||
    checkpointLedger.lastDenial !== undefined ||
    typeof report.startedAt !== "string" ||
    typeof report.finishedAt !== "string" ||
    !Number.isFinite(Date.parse(report.startedAt)) ||
    !Number.isFinite(Date.parse(report.finishedAt)) ||
    Date.parse(report.startedAt) > Date.parse(report.finishedAt) ||
    Date.parse(report.finishedAt) > claimedAt + 1000 ||
    !record(report.initialWorkspace) ||
    !record(report.finalWorkspace) ||
    report.initialWorkspace[expectedSource] !== undefined ||
    typeof report.finalWorkspace[expectedSource] !== "string"
  )
    throw new Error();
  const step = report.steps[0];
  if (
    !record(step) ||
    step.id !== "owner-confirmed-new-day-source" ||
    step.session !== "owner-followup" ||
    step.error !== undefined ||
    !Array.isArray(step.changes) ||
    JSON.stringify(step.changes) !== JSON.stringify([expectedSource]) ||
    !record(step.before) ||
    step.before[expectedSource] !== undefined ||
    !record(step.after) ||
    step.after[expectedSource] !== report.finalWorkspace[expectedSource] ||
    !record(report.sourceProvenance) ||
    !record(report.sourceSession) ||
    !record(report.sourceSession.state) ||
    !record(report.sourceSession.state.session) ||
    !Array.isArray(report.sourceSession.initialMessages) ||
    report.sourceSession.initialMessages.length !== 0 ||
    !record(report.originalMainBefore) ||
    !record(report.originalMainBefore.session)
  )
    throw new Error();
  const provenance = report.sourceProvenance,
    session = report.sourceSession.state.session;
  const previous = parsed(safeText(ONE_USER_REPORT, false, 4 * 1024 * 1024));
  const previousSession =
    record(previous.sourceSessionBefore) &&
    record(previous.sourceSessionBefore.session)
      ? previous.sourceSessionBefore.session
      : undefined;
  const actual = sourceIdentity(expectedSource);
  if (
    !previousSession ||
    typeof previousSession.sessionId !== "string" ||
    report.originalMainBefore.session.sessionId !== previousSession.sessionId ||
    session.parentSessionKey !== "agent:main:main" ||
    session.parentSessionId !== previousSession.sessionId ||
    session.key !== "agent:main:owner-followup" ||
    typeof session.sessionId !== "string" ||
    !session.sessionId ||
    provenance.version !== 1 ||
    provenance.originClass !== "agent" ||
    provenance.relativePath !== expectedSource ||
    provenance.workspaceKey !== actual.workspaceKey ||
    provenance.fileHash !== actual.fileHash ||
    provenance.fileHash !==
      hash(report.finalWorkspace[expectedSource] as string) ||
    provenance.sessionKey !== "agent:main:owner-followup" ||
    provenance.sessionId !== session.sessionId ||
    typeof provenance.reservationId !== "string" ||
    !provenance.reservationId ||
    typeof provenance.observedAt !== "number" ||
    provenance.observedAt < Date.parse(report.startedAt) ||
    provenance.observedAt > Date.parse(report.finishedAt)
  )
    throw new Error();
  return {
    version: 1,
    relativePath: expectedSource,
    workspaceKey: actual.workspaceKey,
    fileHash: actual.fileHash,
    originClass: "agent",
    sessionKey: provenance.sessionKey,
    sessionId: provenance.sessionId,
    reservationId: provenance.reservationId,
    observedAt: provenance.observedAt,
  };
}

function validateCompletion(
  parent: string,
  ledger: OneUserFollowupLedger,
  admission: Dict,
) {
  const path = join(parent, "completion.json");
  try {
    lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const completion = parsed(safeText(path));
  const checkpoint = completion.checkpointLedger;
  if (
    completion.schemaVersion !== 1 ||
    completion.kind !== "one-user-followup-completion-checkpoint" ||
    completion.scope !== SCOPE ||
    completion.state !== "consumed-before-completion" ||
    completion.ledger !== join(parent, "ledger.json") ||
    completion.admissionSha256 !== ledger.admissionSha256 ||
    completion.policySha256 !== POLICY_HASH ||
    completion.activationSha256 !==
      hash(safeText(join(parent, "activation.json"))) ||
    completion.preparationRepairSha256 !==
      hash(safeText(join(parent, "preparation-repair.json"))) ||
    completion.partialReportSha256 !==
      hash(
        safeText(
          join(parent, "preparation-repair-report.json"),
          false,
          4 * 1024 * 1024,
        ),
      ) ||
    completion.reportPath !== join(parent, "completion-report.json") ||
    completion.automaticReplayAllowed !== false ||
    completion.newAllowanceCreated !== false ||
    completion.sourceReplayAllowed !== false ||
    typeof completion.claimedAt !== "string" ||
    !Number.isFinite(Date.parse(completion.claimedAt)) ||
    !validQuota(completion.quota, Date.parse(completion.claimedAt)) ||
    !record(checkpoint) ||
    checkpoint.admissionSha256 !== ledger.admissionSha256 ||
    checkpoint.policySha256 !== POLICY_HASH ||
    !COUNTER_KEYS.every(
      (key) => integer(checkpoint[key]) && ledger[key] >= checkpoint[key],
    ) ||
    completion.checkpointLedgerSha256 !==
      hash(`${JSON.stringify(checkpoint)}\n`) ||
    !record(admission.predecessor) ||
    JSON.stringify(completion.predecessorEvidenceSha256) !==
      JSON.stringify(admission.predecessor.evidenceSha256)
  )
    throw new Error();
  const source = completionBoundary(
    safeText(
      join(parent, "preparation-repair-report.json"),
      false,
      4 * 1024 * 1024,
    ),
    checkpoint,
    Date.parse(completion.claimedAt),
    parsed(safeText(join(parent, "preparation-repair.json"))),
  );
  if (JSON.stringify(completion.source) !== JSON.stringify(source))
    throw new Error();
}

export type OneUserFollowupPredecessor = {
  kind: "consumed-one-user-maintenance-boundary";
  directory: string;
  evidenceSha256: Record<string, string>;
  reservedCounters: {
    chatRequests: number;
    chatInputBytes: number;
    outputTokens: number;
    embeddingRequests: number;
    embeddingInputBytes: number;
  };
  reservedEstimateUsd: number;
  priorSmokeEstimateUsd: number;
  followupEstimateUsd: number;
  combinedEstimateUsd: number;
  testCeilingUsd: 5;
  refundApplied: false;
};

/** Immutable binding to the consumed attempt; all reservations remain charged. */
export function inspectOneUserFollowupPredecessor(): OneUserFollowupPredecessor {
  try {
    const parent = directory(ONE_USER_DIRECTORY);
    const paths = {
      admission: ONE_USER_ADMISSION,
      activation: join(parent, "activation.json"),
      ledger: ONE_USER_LEDGER,
      report: ONE_USER_REPORT,
    };
    const evidenceSha256 = Object.fromEntries(
      Object.entries(paths).map(([name, path]) => [
        name,
        hash(
          safeText(path, false, name === "report" ? 4 * 1024 * 1024 : 65536),
        ),
      ]),
    );
    validateOneUserContext(ONE_USER_LEDGER);
    const ledger = readOneUserLedger(ONE_USER_LEDGER);
    const report = parsed(safeText(ONE_USER_REPORT, false, 4 * 1024 * 1024));
    if (
      ledger.requests < 1 ||
      report.kind !== "current-one-user-native-lifecycle" ||
      report.ok !== false ||
      typeof report.error !== "string" ||
      !report.error.startsWith("One-user nativeMaintenance:") ||
      typeof report.finishedAt !== "string" ||
      !Number.isFinite(Date.parse(report.finishedAt)) ||
      !record(report.stages) ||
      typeof report.stages.nativeMaintenance !== "string" ||
      !report.stages.nativeMaintenance.startsWith("fail:")
    )
      throw new Error();
    for (const [name, path] of Object.entries(paths))
      if (
        hash(
          safeText(path, false, name === "report" ? 4 * 1024 * 1024 : 65536),
        ) !== evidenceSha256[name]
      )
        throw new Error();
    const reservedCounters = {
      chatRequests: ledger.chatRequests,
      chatInputBytes: ledger.chatInputBytes,
      outputTokens: ledger.outputTokens,
      embeddingRequests: ledger.embeddingRequests,
      embeddingInputBytes: ledger.embeddingInputBytes,
    };
    const reservedEstimateUsd =
      ((ledger.chatInputBytes +
        ledger.chatRequests * PREDECESSOR_LIMITS.chatFramingTokensPerRequest) *
        PREDECESSOR_LIMITS.inputUsdPerMillion +
        ledger.outputTokens * PREDECESSOR_LIMITS.outputUsdPerMillion +
        (ledger.embeddingInputBytes +
          ledger.embeddingRequests *
            PREDECESSOR_LIMITS.embeddingFramingTokensPerRequest) *
          PREDECESSOR_LIMITS.embeddingUsdPerMillion) /
      1e6;
    const combinedEstimateUsd =
      reservedEstimateUsd +
      SMOKE.estimatedUsd +
      ONE_USER_FOLLOWUP_LIMITS.estimatedUsd;
    if (
      !Number.isFinite(combinedEstimateUsd) ||
      combinedEstimateUsd >= ONE_USER_FOLLOWUP_LIMITS.testCeilingUsd
    )
      throw new Error();
    return {
      kind: "consumed-one-user-maintenance-boundary",
      directory: parent,
      evidenceSha256,
      reservedCounters,
      reservedEstimateUsd,
      priorSmokeEstimateUsd: SMOKE.estimatedUsd,
      followupEstimateUsd: ONE_USER_FOLLOWUP_LIMITS.estimatedUsd,
      combinedEstimateUsd,
      testCeilingUsd: 5,
      refundApplied: false,
    };
  } catch {
    throw new Error(
      "One-user follow-up denied: predecessor evidence or cumulative estimate is uncertain.",
    );
  }
}

/** New authorization directory, never an absent historical ledger allowance. */
export function createOneUserFollowupAdmission(
  path: string,
  quota: OneUserFollowupQuota,
): void {
  if (
    !validQuota(quota, Date.now()) ||
    ONE_USER_FOLLOWUP_LIMITS.estimatedUsd >=
      ONE_USER_FOLLOWUP_LIMITS.testCeilingUsd
  )
    throw new Error(
      "One-user follow-up admission denied: invalid or stale quota.",
    );
  const target = resolve(path);
  if (target !== resolve(ONE_USER_FOLLOWUP_DIRECTORY))
    throw new Error(
      "One-user follow-up admission denied: fixed directory required.",
    );
  const predecessor = inspectOneUserFollowupPredecessor();
  try {
    directory(dirname(target));
    mkdirSync(target, { mode: 0o700 });
    syncDirectory(dirname(target));
    const admission = {
      schemaVersion: 1,
      kind: "one-user-maintenance-followup-admission",
      scope: SCOPE,
      directory: target,
      state: "consumed-before-scenario",
      claimedAt: new Date().toISOString(),
      predecessor,
      quota: {
        limitUsd: quota.limitUsd,
        usedUsd: quota.usedUsd,
        remainingUsd: quota.remainingUsd,
        snapshotUpdatedAt: quota.snapshotUpdatedAt,
        observedPeriod: quota.observedPeriod,
        usageScope: quota.usageScope,
        approvalScope: quota.approvalScope,
        cumulativeHistoryVerified: quota.cumulativeHistoryVerified,
      },
      policy: POLICY,
      policySha256: POLICY_HASH,
      automaticReplayAllowed: false,
      cumulativeHistoryVerified: false,
    };
    exclusive(join(target, "admission.json"), admission);
    const bytes = safeText(join(target, "admission.json"));
    const ledger: OneUserFollowupLedger = {
      schemaVersion: 1,
      kind: "one-user-maintenance-followup-ledger",
      scope: SCOPE,
      policySha256: POLICY_HASH,
      admissionSha256: hash(bytes),
      requests: 0,
      inputBytes: 0,
      outputTokens: 0,
      chatRequests: 0,
      chatInputBytes: 0,
      embeddingRequests: 0,
      embeddingInputBytes: 0,
      updatedAt: new Date().toISOString(),
    };
    exclusive(join(target, "ledger.json"), ledger);
    syncDirectory(target);
  } catch {
    // A partial directory is consumed too. Do not unlink or recreate it.
    throw new Error(
      "One-user follow-up admission denied: existing or uncertain context.",
    );
  }
}

function context(
  path: string,
  activationRequired: boolean,
): OneUserFollowupLedger {
  try {
    const target = resolve(path),
      parent = directory(dirname(target));
    if (
      target !== join(parent, "ledger.json") ||
      parent !== resolve(ONE_USER_FOLLOWUP_DIRECTORY)
    )
      throw new Error();
    const admissionText = safeText(join(parent, "admission.json"));
    const admission = parsed(admissionText);
    if (
      admission.schemaVersion !== 1 ||
      admission.kind !== "one-user-maintenance-followup-admission" ||
      admission.scope !== SCOPE ||
      admission.directory !== parent ||
      admission.state !== "consumed-before-scenario" ||
      admission.automaticReplayAllowed !== false ||
      admission.cumulativeHistoryVerified !== false ||
      admission.policySha256 !== POLICY_HASH ||
      JSON.stringify(admission.policy) !== policyBytes ||
      typeof admission.claimedAt !== "string" ||
      !validQuota(admission.quota, Date.parse(admission.claimedAt)) ||
      JSON.stringify(admission.predecessor) !==
        JSON.stringify(inspectOneUserFollowupPredecessor())
    )
      throw new Error();
    // An already-open ledger can be unlinked by a concurrent atomic replacement.
    // Its complete snapshot is safe to inspect; admission rereads under the lock.
    const ledger = parsed(safeText(target, true));
    if (
      ledger.schemaVersion !== 1 ||
      ledger.kind !== "one-user-maintenance-followup-ledger" ||
      ledger.scope !== SCOPE ||
      ledger.policySha256 !== POLICY_HASH ||
      ledger.admissionSha256 !== hash(admissionText) ||
      ![
        ledger.requests,
        ledger.inputBytes,
        ledger.outputTokens,
        ledger.chatRequests,
        ledger.chatInputBytes,
        ledger.embeddingRequests,
        ledger.embeddingInputBytes,
      ].every(integer) ||
      typeof ledger.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(ledger.updatedAt))
    )
      throw new Error();
    const counts = ledger as unknown as OneUserFollowupLedger;
    if (
      counts.requests !== counts.chatRequests + counts.embeddingRequests ||
      counts.inputBytes !==
        counts.chatInputBytes + counts.embeddingInputBytes ||
      counts.chatRequests > ONE_USER_FOLLOWUP_LIMITS.chatRequests ||
      counts.chatInputBytes > ONE_USER_FOLLOWUP_LIMITS.chatInputBytes ||
      counts.outputTokens > ONE_USER_FOLLOWUP_LIMITS.chatOutputTokens ||
      counts.embeddingRequests > ONE_USER_FOLLOWUP_LIMITS.embeddingRequests ||
      counts.embeddingInputBytes > ONE_USER_FOLLOWUP_LIMITS.embeddingInputBytes
    )
      throw new Error();
    if (activationRequired) {
      const activation = parsed(safeText(join(parent, "activation.json")));
      if (
        activation.schemaVersion !== 1 ||
        activation.kind !== "one-user-maintenance-followup-activation" ||
        activation.state !== "consumed-before-controller" ||
        activation.admissionSha256 !== ledger.admissionSha256 ||
        activation.policySha256 !== POLICY_HASH ||
        activation.ledger !== target ||
        activation.automaticReplayAllowed !== false ||
        typeof activation.claimedAt !== "string" ||
        !Number.isFinite(Date.parse(activation.claimedAt))
      )
        throw new Error();
    }
    validatePreparationRepair(parent, counts, admission);
    validateCompletion(parent, counts, admission);
    return counts;
  } catch {
    throw new Error(
      "One-user follow-up context denied: invalid or uncertain admission/ledger.",
    );
  }
}

export function readOneUserFollowupLedger(path: string): OneUserFollowupLedger {
  return context(path, false);
}
export function validateOneUserFollowupContext(path: string): void {
  context(path, true);
}
export function assertFreshOneUserFollowupContext(path: string): void {
  const ledger = context(path, false);
  if (ledger.requests || ledger.inputBytes || ledger.outputTokens)
    throw new Error(
      "One-user follow-up context already dispatched; automatic resume denied.",
    );
  try {
    lstatSync(join(dirname(resolve(path)), "activation.json"));
    throw new Error(
      "One-user follow-up context already activated; automatic resume denied.",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
/** Atomic direct-method activation, including zero-dispatch uncertain failures. */
export function claimOneUserFollowupActivation(path: string): void {
  assertFreshOneUserFollowupContext(path);
  const target = resolve(path),
    ledger = context(target, false);
  const admissionText = safeText(join(dirname(target), "admission.json"));
  if (
    hash(admissionText) !== ledger.admissionSha256 ||
    !validQuota(parsed(admissionText).quota, Date.now())
  )
    throw new Error(
      "One-user follow-up activation denied: stale or uncertain quota.",
    );
  try {
    exclusive(join(dirname(target), "activation.json"), {
      schemaVersion: 1,
      kind: "one-user-maintenance-followup-activation",
      state: "consumed-before-controller",
      ledger: target,
      admissionSha256: ledger.admissionSha256,
      policySha256: POLICY_HASH,
      claimedAt: new Date().toISOString(),
      automaticReplayAllowed: false,
    });
    syncDirectory(dirname(target));
  } catch {
    throw new Error(
      "One-user follow-up context already activated or uncertain; automatic resume denied.",
    );
  }
}

/** One explicit readiness repair before any paid attempt; the allowance is unchanged. */
export function claimOneUserFollowupPreparationRepair(
  path: string,
  quota: OneUserFollowupQuota,
): void {
  const target = resolve(path);
  context(target, true);
  locked(target, (ledger) => {
    const parent = dirname(target),
      now = Date.now();
    if (!zeroCounters(ledger) || !validQuota(quota, now))
      throw new Error(
        "One-user follow-up preparation repair denied: nonzero attempts or stale quota.",
      );
    for (const name of [
      "preparation-repair.json",
      "preparation-repair-report.json",
    ])
      try {
        lstatSync(join(parent, name));
        throw new Error(
          "One-user follow-up preparation repair already consumed or uncertain.",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    const failedReport = safeText(
      join(parent, "report.json"),
      false,
      4 * 1024 * 1024,
    );
    let sourcePath: string;
    try {
      sourcePath = preparationFailure(
        failedReport,
        ledger as unknown as Dict,
        now,
      );
    } catch {
      throw new Error(
        "One-user follow-up preparation repair denied: failure was not a zero-dispatch readiness mismatch.",
      );
    }
    const workspace = directory(
      join(ONE_USER_DIRECTORY, "corpus/one-user/workspace"),
    );
    try {
      lstatSync(join(workspace, sourcePath));
      throw new Error(
        "One-user follow-up preparation repair denied: current source already exists.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const initialLedgerText = safeText(target);
    if (initialLedgerText !== `${JSON.stringify(ledger)}\n`)
      throw new Error(
        "One-user follow-up preparation repair denied: ledger changed or uncertain.",
      );
    const admission = parsed(safeText(join(parent, "admission.json")));
    if (!record(admission.predecessor)) throw new Error();
    exclusive(join(parent, "preparation-repair.json"), {
      schemaVersion: 1,
      kind: "one-user-followup-preparation-repair",
      scope: SCOPE,
      state: "consumed-before-preparation-repair",
      ledger: target,
      admissionSha256: ledger.admissionSha256,
      policySha256: POLICY_HASH,
      activationSha256: hash(safeText(join(parent, "activation.json"))),
      failedReportSha256: hash(failedReport),
      initialLedgerSha256: hash(initialLedgerText),
      initialLedger: ledger,
      predecessorEvidenceSha256: admission.predecessor.evidenceSha256,
      sourcePath,
      reportPath: join(parent, "preparation-repair-report.json"),
      claimedAt: new Date(now).toISOString(),
      quota: {
        limitUsd: quota.limitUsd,
        usedUsd: quota.usedUsd,
        remainingUsd: quota.remainingUsd,
        snapshotUpdatedAt: quota.snapshotUpdatedAt,
        observedPeriod: quota.observedPeriod,
        usageScope: quota.usageScope,
        approvalScope: quota.approvalScope,
        cumulativeHistoryVerified: false,
      },
      automaticReplayAllowed: false,
      newAllowanceCreated: false,
    });
    syncDirectory(parent);
  });
}

/** Continue only after the recorded local preview decoder failure; never repeat source work. */
export function claimOneUserFollowupCompletion(
  path: string,
  quota: OneUserFollowupQuota,
): void {
  const target = resolve(path);
  context(target, true);
  locked(target, (ledger) => {
    const parent = dirname(target),
      now = Date.now();
    if (!validQuota(quota, now))
      throw new Error("One-user follow-up completion denied: stale quota.");
    for (const name of ["completion.json", "completion-report.json"])
      try {
        lstatSync(join(parent, name));
        throw new Error(
          "One-user follow-up completion already consumed or uncertain.",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    const repairText = safeText(join(parent, "preparation-repair.json"));
    const partialText = safeText(
      join(parent, "preparation-repair-report.json"),
      false,
      4 * 1024 * 1024,
    );
    let source: ReturnType<typeof completionBoundary>;
    try {
      source = completionBoundary(
        partialText,
        ledger as unknown as Dict,
        now,
        parsed(repairText),
      );
    } catch {
      throw new Error(
        "One-user follow-up completion denied: not the known incomplete preview boundary.",
      );
    }
    const ledgerText = safeText(target);
    if (ledgerText !== `${JSON.stringify(ledger)}\n`)
      throw new Error(
        "One-user follow-up completion denied: ledger changed or uncertain.",
      );
    const admission = parsed(safeText(join(parent, "admission.json")));
    if (!record(admission.predecessor)) throw new Error();
    exclusive(join(parent, "completion.json"), {
      schemaVersion: 1,
      kind: "one-user-followup-completion-checkpoint",
      scope: SCOPE,
      state: "consumed-before-completion",
      ledger: target,
      admissionSha256: ledger.admissionSha256,
      policySha256: POLICY_HASH,
      activationSha256: hash(safeText(join(parent, "activation.json"))),
      preparationRepairSha256: hash(repairText),
      partialReportSha256: hash(partialText),
      checkpointLedgerSha256: hash(ledgerText),
      checkpointLedger: ledger,
      predecessorEvidenceSha256: admission.predecessor.evidenceSha256,
      source,
      reportPath: join(parent, "completion-report.json"),
      claimedAt: new Date(now).toISOString(),
      quota: {
        limitUsd: quota.limitUsd,
        usedUsd: quota.usedUsd,
        remainingUsd: quota.remainingUsd,
        snapshotUpdatedAt: quota.snapshotUpdatedAt,
        observedPeriod: quota.observedPeriod,
        usageScope: quota.usageScope,
        approvalScope: quota.approvalScope,
        cumulativeHistoryVerified: false,
      },
      automaticReplayAllowed: false,
      newAllowanceCreated: false,
      sourceReplayAllowed: false,
    });
    syncDirectory(parent);
  });
}

function update(path: string, ledger: OneUserFollowupLedger) {
  const parent = dirname(resolve(path)),
    next = join(parent, "ledger.next");
  exclusive(next, ledger);
  renameSync(next, path);
  syncDirectory(parent);
}
const waiter = new Int32Array(new SharedArrayBuffer(4));
function locked<T>(path: string, use: (ledger: OneUserFollowupLedger) => T): T {
  const target = resolve(path),
    parent = directory(dirname(target));
  const lock = join(parent, "ledger.lock");
  const deadline = Date.now() + 1000;
  let fd: number;
  for (;;) {
    try {
      fd = openSync(
        lock,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      break;
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "EEXIST" ||
        Date.now() >= deadline
      )
        throw new Error(
          "One-user follow-up ledger locked or uncertain; dispatch denied.",
        );
      Atomics.wait(waiter, 0, 0, 10);
    }
  }
  try {
    return use(context(target, true));
  } finally {
    closeSync(fd);
    unlinkSync(lock);
    syncDirectory(parent);
  }
}

function request(input: string | URL | Request, init?: RequestInit) {
  let url: URL;
  try {
    url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
  } catch {
    throw new Error("One-user follow-up request denied: invalid destination.");
  }
  if (
    url.origin !== "https://openrouter.ai" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("One-user follow-up request denied: destination.");
  const method = (init?.method ?? "GET").toUpperCase();
  if (
    method === "GET" &&
    ["/api/v1/key", "/api/v1/credits"].includes(url.pathname)
  )
    return { kind: "metadata" as const };
  if (
    method !== "POST" ||
    !["/api/v1/chat/completions", "/api/v1/embeddings"].includes(
      url.pathname,
    ) ||
    !(typeof init?.body === "string" || init?.body instanceof Uint8Array)
  )
    throw new Error("One-user follow-up request denied: unsupported shape.");
  let text: string, body: Dict;
  try {
    text =
      typeof init.body === "string"
        ? init.body
        : new TextDecoder("utf-8", { fatal: true }).decode(
            init.body as Uint8Array,
          );
    body = parsed(text);
  } catch {
    throw new Error("One-user follow-up request denied: malformed JSON.");
  }
  const bytes = Buffer.byteLength(text);
  if (url.pathname === "/api/v1/embeddings") {
    const inputs = typeof body.input === "string" ? [body.input] : body.input;
    if (
      body.model !== EMBEDDING_MODEL ||
      bytes > ONE_USER_FOLLOWUP_LIMITS.embeddingBytesPerRequest ||
      !Array.isArray(inputs) ||
      inputs.length < 1 ||
      inputs.length > ONE_USER_FOLLOWUP_LIMITS.embeddingInputsPerRequest ||
      !inputs.every((x) => typeof x === "string" && x.trim().length > 0)
    )
      throw new Error(
        "One-user follow-up request denied: embedding model/input.",
      );
    return { kind: "embedding" as const, bytes };
  }
  const output = body.max_completion_tokens ?? body.max_tokens;
  if (
    body.model !== CHAT_MODEL ||
    bytes > ONE_USER_FOLLOWUP_LIMITS.chatInputBytesPerRequest ||
    (body.max_completion_tokens !== undefined &&
      body.max_tokens !== undefined) ||
    !integer(output) ||
    output < 1 ||
    output > ONE_USER_FOLLOWUP_LIMITS.chatOutputPerRequest ||
    body.plugins !== undefined ||
    body.web_search_options !== undefined ||
    body.audio !== undefined ||
    (body.modalities !== undefined &&
      JSON.stringify(body.modalities) !== '["text"]') ||
    (body.tools !== undefined &&
      (!Array.isArray(body.tools) ||
        !body.tools.every((tool) => record(tool) && tool.type === "function")))
  )
    throw new Error(
      "One-user follow-up request denied: chat model/output/capability.",
    );
  return { kind: "chat" as const, bytes, output };
}

/** Reserve every native attempt before fetch; failures and retries are not refunded. */
export function admitOneUserFollowupRequest(
  path: string,
  input: string | URL | Request,
  init?: RequestInit,
): void {
  validateOneUserFollowupContext(path);
  const delta = request(input, init);
  if (delta.kind === "metadata") return;
  locked(path, (ledger) => {
    const next = { ...ledger, updatedAt: new Date().toISOString() };
    if (delta.kind === "chat") {
      next.chatRequests++;
      next.chatInputBytes += delta.bytes;
      next.outputTokens += delta.output;
    } else {
      next.embeddingRequests++;
      next.embeddingInputBytes += delta.bytes;
    }
    next.requests++;
    next.inputBytes += delta.bytes;
    let code: string | undefined;
    if (next.chatRequests > ONE_USER_FOLLOWUP_LIMITS.chatRequests)
      code = "chat_requests";
    else if (next.chatInputBytes > ONE_USER_FOLLOWUP_LIMITS.chatInputBytes)
      code = "chat_input_bytes";
    else if (next.outputTokens > ONE_USER_FOLLOWUP_LIMITS.chatOutputTokens)
      code = "chat_output_tokens";
    else if (
      next.embeddingRequests > ONE_USER_FOLLOWUP_LIMITS.embeddingRequests
    )
      code = "embedding_requests";
    else if (
      next.embeddingInputBytes > ONE_USER_FOLLOWUP_LIMITS.embeddingInputBytes
    )
      code = "embedding_input_bytes";
    if (code) {
      update(path, {
        ...ledger,
        lastDenial: { code, at: new Date().toISOString() },
      });
      throw new Error(`One-user follow-up request budget exhausted: ${code}.`);
    }
    update(path, next);
  });
}

/** Only add the finite missing native utility bound; preserve messages/tools/model. */
export function boundOneUserFollowupUtilityRequest(
  path: string,
  input: string | URL | Request,
  init?: RequestInit,
): RequestInit | undefined {
  validateOneUserFollowupContext(path);
  let url: URL;
  try {
    url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
  } catch {
    return init;
  }
  if (
    url.href !== "https://openrouter.ai/api/v1/chat/completions" ||
    (init?.method ?? "GET").toUpperCase() !== "POST" ||
    !(typeof init?.body === "string" || init?.body instanceof Uint8Array)
  )
    return init;
  let body: Dict;
  try {
    body = parsed(
      typeof init.body === "string"
        ? init.body
        : new TextDecoder("utf-8", { fatal: true }).decode(
            init.body as Uint8Array,
          ),
    );
  } catch {
    throw new Error(
      "One-user follow-up utility request denied: malformed JSON.",
    );
  }
  if (
    body.model !== CHAT_MODEL ||
    body.max_completion_tokens !== undefined ||
    body.max_tokens !== undefined
  )
    return init;
  const headers = new Headers(init.headers);
  headers.delete("content-length");
  return {
    ...init,
    headers,
    body: JSON.stringify({
      ...body,
      max_completion_tokens: ONE_USER_FOLLOWUP_LIMITS.utilityOutputTokens,
    }),
  };
}

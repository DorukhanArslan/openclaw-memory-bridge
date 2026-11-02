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
import { SMOKE } from "./paid-smoke.ts";

const PROJECT = fileURLToPath(new URL("../", import.meta.url));
export const ONE_USER_DIRECTORY = join(PROJECT, ".lab/one-user-lifecycle");
export const ONE_USER_ADMISSION = join(ONE_USER_DIRECTORY, "admission.json");
export const ONE_USER_LEDGER = join(ONE_USER_DIRECTORY, "ledger.json");
export const ONE_USER_REPORT = join(ONE_USER_DIRECTORY, "report.json");
export const ONE_USER_LIMITS = Object.freeze({
  chatRequests: 32,
  chatInputBytes: 450000,
  chatInputBytesPerRequest: 100000,
  chatFramingTokensPerRequest: 1024,
  chatOutputPerRequest: 2048,
  chatOutputTokens: 26000,
  embeddingRequests: 64,
  embeddingInputBytes: 1000000,
  embeddingBytesPerRequest: 32768,
  embeddingInputsPerRequest: 128,
  embeddingFramingTokensPerRequest: 256,
  utilityOutputTokens: 1024,
  inputUsdPerMillion: 9,
  outputUsdPerMillion: 20,
  embeddingUsdPerMillion: 0.02,
  estimatedUsd:
    ((450000 + 32 * 1024) * 9 + 26000 * 20 + (1000000 + 64 * 256) * 0.02) / 1e6,
  knownPriorSmokeEstimateUsd: SMOKE.estimatedUsd,
  currentWorkEstimateUsd:
    ((450000 + 32 * 1024) * 9 + 26000 * 20 + (1000000 + 64 * 256) * 0.02) /
      1e6 +
    SMOKE.estimatedUsd,
  testCeilingUsd: 5,
});
export const ONE_USER_PRICE_CEILINGS = Object.freeze({
  inputUsdPerMillion: ONE_USER_LIMITS.inputUsdPerMillion,
  outputUsdPerMillion: ONE_USER_LIMITS.outputUsdPerMillion,
  embeddingUsdPerMillion: ONE_USER_LIMITS.embeddingUsdPerMillion,
});

const SCOPE = "one-user-lifecycle";
const CHAT_MODEL = "openai/gpt-6-sol";
const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const POLICY = Object.freeze({
  scope: SCOPE,
  version: 1,
  chatModel: CHAT_MODEL,
  embeddingModel: EMBEDDING_MODEL,
  origin: "https://openrouter.ai",
  limits: ONE_USER_LIMITS,
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

export type OneUserQuota = Readonly<{
  limitUsd: 50;
  usedUsd: number;
  remainingUsd: number;
  snapshotUpdatedAt: number;
  observedPeriod: "daily" | "weekly" | "monthly" | "not-reported";
  usageScope: "reset-window" | "native-reported";
  approvalScope: "one-user-lifecycle";
  cumulativeHistoryVerified: false;
}>;
export type OneUserLedger = {
  schemaVersion: 1;
  kind: "one-user-lifecycle-ledger";
  scope: "one-user-lifecycle";
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

function validQuota(x: unknown, now?: number): x is OneUserQuota {
  return (
    record(x) &&
    x.limitUsd === 50 &&
    typeof x.usedUsd === "number" &&
    Number.isFinite(x.usedUsd) &&
    x.usedUsd >= 0 &&
    typeof x.remainingUsd === "number" &&
    x.remainingUsd === 50 - x.usedUsd &&
    x.remainingUsd >= ONE_USER_LIMITS.estimatedUsd &&
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
export function inspectOneUserQuota(
  status: unknown,
  now = Date.now(),
): OneUserQuota {
  if (
    !record(status) ||
    !record(status.usage) ||
    !fresh(status.usage.updatedAt, now) ||
    !Array.isArray(status.usage.providers)
  )
    throw new Error("One-user quota denied: missing or stale native usage.");
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
      "One-user quota denied: unavailable or ambiguous provider.",
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
    throw new Error("One-user quota denied: invalid or ambiguous key budget.");
  const quota: OneUserQuota = Object.freeze({
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
    ONE_USER_LIMITS.currentWorkEstimateUsd >= ONE_USER_LIMITS.testCeilingUsd
  )
    throw new Error("One-user quota denied: insufficient scenario headroom.");
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
        balances[0].amount < ONE_USER_LIMITS.estimatedUsd))
  )
    throw new Error(
      "One-user quota denied: insufficient or ambiguous account balance.",
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
    throw new Error("One-user context denied: unsafe directory.");
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
function safeText(path: string, replaceableLedger = false) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const st = fstatSync(fd);
    if (
      !st.isFile() ||
      (st.nlink !== 1 && !(replaceableLedger && st.nlink === 0)) ||
      st.size > 65536 ||
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

/** New authorization directory, never an absent historical ledger allowance. */
export function createOneUserAdmission(
  path: string,
  quota: OneUserQuota,
): void {
  if (
    !validQuota(quota, Date.now()) ||
    ONE_USER_LIMITS.currentWorkEstimateUsd >= ONE_USER_LIMITS.testCeilingUsd
  )
    throw new Error("One-user admission denied: invalid or stale quota.");
  const target = resolve(path);
  try {
    directory(dirname(target));
    mkdirSync(target, { mode: 0o700 });
    syncDirectory(dirname(target));
    const admission = {
      schemaVersion: 1,
      kind: "one-user-lifecycle-admission",
      scope: SCOPE,
      directory: target,
      state: "consumed-before-scenario",
      claimedAt: new Date().toISOString(),
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
    const ledger: OneUserLedger = {
      schemaVersion: 1,
      kind: "one-user-lifecycle-ledger",
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
      "One-user admission denied: existing or uncertain context.",
    );
  }
}

function context(path: string, activationRequired: boolean): OneUserLedger {
  try {
    const target = resolve(path),
      parent = directory(dirname(target));
    if (target !== join(parent, "ledger.json")) throw new Error();
    const admissionText = safeText(join(parent, "admission.json"));
    const admission = parsed(admissionText);
    if (
      admission.schemaVersion !== 1 ||
      admission.kind !== "one-user-lifecycle-admission" ||
      admission.scope !== SCOPE ||
      admission.directory !== parent ||
      admission.state !== "consumed-before-scenario" ||
      admission.automaticReplayAllowed !== false ||
      admission.cumulativeHistoryVerified !== false ||
      admission.policySha256 !== POLICY_HASH ||
      JSON.stringify(admission.policy) !== policyBytes ||
      typeof admission.claimedAt !== "string" ||
      !validQuota(admission.quota, Date.parse(admission.claimedAt))
    )
      throw new Error();
    // An already-open ledger can be unlinked by a concurrent atomic replacement.
    // Its complete snapshot is safe to inspect; admission rereads under the lock.
    const ledger = parsed(safeText(target, true));
    if (
      ledger.schemaVersion !== 1 ||
      ledger.kind !== "one-user-lifecycle-ledger" ||
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
    const counts = ledger as unknown as OneUserLedger;
    if (
      counts.requests !== counts.chatRequests + counts.embeddingRequests ||
      counts.inputBytes !==
        counts.chatInputBytes + counts.embeddingInputBytes ||
      counts.chatRequests > ONE_USER_LIMITS.chatRequests ||
      counts.chatInputBytes > ONE_USER_LIMITS.chatInputBytes ||
      counts.outputTokens > ONE_USER_LIMITS.chatOutputTokens ||
      counts.embeddingRequests > ONE_USER_LIMITS.embeddingRequests ||
      counts.embeddingInputBytes > ONE_USER_LIMITS.embeddingInputBytes
    )
      throw new Error();
    if (activationRequired) {
      const activation = parsed(safeText(join(parent, "activation.json")));
      if (
        activation.schemaVersion !== 1 ||
        activation.kind !== "one-user-lifecycle-activation" ||
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
    return counts;
  } catch {
    throw new Error(
      "One-user context denied: invalid or uncertain admission/ledger.",
    );
  }
}

export function readOneUserLedger(path: string): OneUserLedger {
  return context(path, false);
}
export function validateOneUserContext(path: string): void {
  context(path, true);
}
export function assertFreshOneUserContext(path: string): void {
  const ledger = context(path, false);
  if (ledger.requests || ledger.inputBytes || ledger.outputTokens)
    throw new Error(
      "One-user context already dispatched; automatic resume denied.",
    );
  try {
    lstatSync(join(dirname(resolve(path)), "activation.json"));
    throw new Error(
      "One-user context already activated; automatic resume denied.",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
/** Atomic direct-method activation, including zero-dispatch uncertain failures. */
export function claimOneUserActivation(path: string): void {
  assertFreshOneUserContext(path);
  const target = resolve(path),
    ledger = context(target, false);
  const admissionText = safeText(join(dirname(target), "admission.json"));
  if (
    hash(admissionText) !== ledger.admissionSha256 ||
    !validQuota(parsed(admissionText).quota, Date.now())
  )
    throw new Error("One-user activation denied: stale or uncertain quota.");
  try {
    exclusive(join(dirname(target), "activation.json"), {
      schemaVersion: 1,
      kind: "one-user-lifecycle-activation",
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
      "One-user context already activated or uncertain; automatic resume denied.",
    );
  }
}

function update(path: string, ledger: OneUserLedger) {
  const parent = dirname(resolve(path)),
    next = join(parent, "ledger.next");
  exclusive(next, ledger);
  renameSync(next, path);
  syncDirectory(parent);
}
const waiter = new Int32Array(new SharedArrayBuffer(4));
function locked<T>(path: string, use: (ledger: OneUserLedger) => T): T {
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
          "One-user ledger locked or uncertain; dispatch denied.",
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
    throw new Error("One-user request denied: invalid destination.");
  }
  if (
    url.origin !== "https://openrouter.ai" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("One-user request denied: destination.");
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
    throw new Error("One-user request denied: unsupported shape.");
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
    throw new Error("One-user request denied: malformed JSON.");
  }
  const bytes = Buffer.byteLength(text);
  if (url.pathname === "/api/v1/embeddings") {
    const inputs = typeof body.input === "string" ? [body.input] : body.input;
    if (
      body.model !== EMBEDDING_MODEL ||
      bytes > ONE_USER_LIMITS.embeddingBytesPerRequest ||
      !Array.isArray(inputs) ||
      inputs.length < 1 ||
      inputs.length > ONE_USER_LIMITS.embeddingInputsPerRequest ||
      !inputs.every((x) => typeof x === "string" && x.trim().length > 0)
    )
      throw new Error("One-user request denied: embedding model/input.");
    return { kind: "embedding" as const, bytes };
  }
  const output = body.max_completion_tokens ?? body.max_tokens;
  if (
    body.model !== CHAT_MODEL ||
    bytes > ONE_USER_LIMITS.chatInputBytesPerRequest ||
    (body.max_completion_tokens !== undefined &&
      body.max_tokens !== undefined) ||
    !integer(output) ||
    output < 1 ||
    output > ONE_USER_LIMITS.chatOutputPerRequest ||
    body.plugins !== undefined ||
    body.web_search_options !== undefined ||
    body.audio !== undefined ||
    (body.modalities !== undefined &&
      JSON.stringify(body.modalities) !== '["text"]') ||
    (body.tools !== undefined &&
      (!Array.isArray(body.tools) ||
        !body.tools.every((tool) => record(tool) && tool.type === "function")))
  )
    throw new Error("One-user request denied: chat model/output/capability.");
  return { kind: "chat" as const, bytes, output };
}

/** Reserve every native attempt before fetch; failures and retries are not refunded. */
export function admitOneUserRequest(
  path: string,
  input: string | URL | Request,
  init?: RequestInit,
): void {
  validateOneUserContext(path);
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
    if (next.chatRequests > ONE_USER_LIMITS.chatRequests)
      code = "chat_requests";
    else if (next.chatInputBytes > ONE_USER_LIMITS.chatInputBytes)
      code = "chat_input_bytes";
    else if (next.outputTokens > ONE_USER_LIMITS.chatOutputTokens)
      code = "chat_output_tokens";
    else if (next.embeddingRequests > ONE_USER_LIMITS.embeddingRequests)
      code = "embedding_requests";
    else if (next.embeddingInputBytes > ONE_USER_LIMITS.embeddingInputBytes)
      code = "embedding_input_bytes";
    if (code) {
      update(path, {
        ...ledger,
        lastDenial: { code, at: new Date().toISOString() },
      });
      throw new Error(`One-user request budget exhausted: ${code}.`);
    }
    update(path, next);
  });
}

/** Only add the finite missing native utility bound; preserve messages/tools/model. */
export function boundOneUserUtilityRequest(
  path: string,
  input: string | URL | Request,
  init?: RequestInit,
): RequestInit | undefined {
  validateOneUserContext(path);
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
    throw new Error("One-user utility request denied: malformed JSON.");
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
      max_completion_tokens: ONE_USER_LIMITS.utilityOutputTokens,
    }),
  };
}

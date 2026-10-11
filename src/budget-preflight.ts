/** Native quota snapshot inspection. This is not a currency reservation system. */
export const PAID_SELECTION = Object.freeze({
  chat: "openrouter/openai/gpt-6-sol",
  embedding: "openai/text-embedding-3-small",
  embeddingUrl: "https://openrouter.ai/api/v1",
  keyEnv: "OPENROUTER_API_KEY",
  ceilingUsd: 5,
  minimumHeadroomUsd: 1,
});

type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export type Preflight = {
  snapshotEligible: boolean;
  modelRequestsAllowed: false;
  code: string;
  keyBudget?: { limitUsd: number; usedUsd: number; remainingUsd: number };
};

const deny = (code: string): Preflight => ({
  snapshotEligible: false,
  modelRequestsAllowed: false,
  code,
});

export function inspectBudget(status: unknown, now = Date.now()): Preflight {
  if (!record(status) || !record(status.usage)) return deny("usage_missing");
  const { usage } = status;
  if (
    !Number.isFinite(usage.updatedAt) ||
    typeof usage.updatedAt !== "number" ||
    usage.updatedAt > now + 1000 ||
    now - usage.updatedAt > 30000
  )
    return deny("usage_stale_or_missing_timestamp");
  if (!Array.isArray(usage.providers)) return deny("usage_missing");
  const providers = usage.providers.filter(
    (p) => record(p) && p.provider === "openrouter",
  );
  if (providers.length !== 1 || !record(providers[0]) || providers[0].error)
    return deny("usage_unavailable_or_ambiguous");
  const provider = providers[0];
  if (!Array.isArray(provider.billing)) return deny("key_budget_missing");
  const budgets = provider.billing.filter(
    (b) => record(b) && b.type === "budget" && b.label === "API key budget",
  );
  if (budgets.length !== 1 || !record(budgets[0]))
    return deny("key_budget_missing_or_ambiguous");
  const budget = budgets[0];
  if (budget.period !== undefined) return deny("periodic_or_unknown_reset");
  if (
    budget.unit !== "USD" ||
    typeof budget.limit !== "number" ||
    typeof budget.used !== "number" ||
    !Number.isFinite(budget.limit) ||
    !Number.isFinite(budget.used) ||
    budget.limit !== PAID_SELECTION.ceilingUsd ||
    budget.used < 0
  )
    return deny("invalid_or_wrong_key_limit");
  const remaining = budget.limit - budget.used;
  if (remaining <= 0) return deny("key_budget_exhausted");
  if (remaining < PAID_SELECTION.minimumHeadroomUsd)
    return deny("insufficient_headroom");
  return {
    snapshotEligible: true,
    modelRequestsAllowed: false,
    code: "native_spend_reservation_unavailable",
    keyBudget: {
      limitUsd: budget.limit,
      usedUsd: budget.used,
      remainingUsd: remaining,
    },
  };
}

export async function probeBudget(
  confirmed: boolean,
  nativeStatus: () => Promise<unknown>,
  now?: number,
): Promise<Preflight> {
  if (!confirmed) return deny("operator_key_limit_confirmation_required");
  try {
    return inspectBudget(await nativeStatus(), now ?? Date.now());
  } catch {
    return deny("native_usage_unavailable");
  }
}

/** These existing native CLI calls inspect config/quota without model inference. */
export function assertNativeOperationAllowed(
  selectedCredentials: boolean,
  args: string[],
) {
  if (!selectedCredentials) return;
  const safe = [
    ["config", "validate", "--json"],
    ["status", "--usage", "--json", "--agent", "main", "--timeout", "10000"],
  ];
  if (
    safe.some(
      (allowed) =>
        allowed.length === args.length &&
        allowed.every((arg, i) => arg === args[i]),
    )
  )
    return;
  throw new Error(
    "Paid native operations are blocked: strict spending reservation is unavailable in this harness.",
  );
}

export function assertGatewayAllowed(selectedCredentials: boolean) {
  if (selectedCredentials)
    throw new Error(
      "Paid Gateway startup is blocked: automatic model/embedding work has no strict spending reservation.",
    );
}

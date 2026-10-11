import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertGatewayAllowed,
  assertNativeOperationAllowed,
  inspectBudget,
  PAID_SELECTION,
  probeBudget,
} from "../src/budget-preflight.ts";
import { modelGate } from "./model-selection.ts";

const NOW = 1900000000000;
function snapshot(limit: unknown = 5, used: unknown = 0, extra = {}) {
  return {
    usage: {
      updatedAt: NOW,
      providers: [
        {
          provider: "openrouter",
          billing: [
            {
              type: "budget",
              label: "API key budget",
              unit: "USD",
              limit,
              used,
              ...extra,
            },
          ],
        },
      ],
    },
  };
}

test("BUDGET: valid native USD snapshot is evidence, never paid admission", () => {
  const result = inspectBudget(snapshot(), NOW);
  assert.equal(result.snapshotEligible, true);
  assert.equal(result.modelRequestsAllowed, false);
  assert.deepEqual(result.keyBudget, {
    limitUsd: 5,
    usedUsd: 0,
    remainingUsd: 5,
  });
  assert.equal(result.code, "native_spend_reservation_unavailable");
  assert.equal(PAID_SELECTION.chat, "openrouter/openai/gpt-6-sol");
  assert.equal(PAID_SELECTION.embedding, "openai/text-embedding-3-small");
});

test("BUDGET: missing/stale/future/error/ambiguous usage fails closed", () => {
  const malformed: unknown[] = [
    null,
    {},
    { usage: {} },
    { usage: { updatedAt: NOW, providers: [] } },
    { usage: { updatedAt: NOW - 30001, providers: [] } },
    { usage: { updatedAt: NOW + 1001, providers: [] } },
    {
      usage: {
        updatedAt: NOW,
        providers: [{ provider: "openrouter", error: "dummy-private-error" }],
      },
    },
    {
      usage: {
        updatedAt: NOW,
        providers: [
          { provider: "openrouter", billing: [] },
          { provider: "openrouter", billing: [] },
        ],
      },
    },
  ];
  for (const data of malformed) {
    const result = inspectBudget(data, NOW);
    assert.equal(result.snapshotEligible, false);
    assert.equal(result.modelRequestsAllowed, false);
    assert.doesNotMatch(JSON.stringify(result), /dummy-private-error/);
  }
});

test("BUDGET: unlimited/wrong/resetting/currency/malformed limits are rejected", () => {
  for (const limit of [null, 0, 4, 5.01, Infinity, "5"])
    assert.equal(inspectBudget(snapshot(limit), NOW).snapshotEligible, false);
  assert.equal(
    inspectBudget(snapshot(5, 0, { limit: undefined }), NOW).snapshotEligible,
    false,
  );
  for (const period of ["daily", "weekly", "monthly", "unknown", null])
    assert.equal(
      inspectBudget(snapshot(5, 0, { period }), NOW).code,
      "periodic_or_unknown_reset",
    );
  for (const used of [-1, Infinity, NaN, "0"])
    assert.equal(inspectBudget(snapshot(5, used), NOW).snapshotEligible, false);
  assert.equal(
    inspectBudget(snapshot(5, 0, { unit: "EUR" }), NOW).snapshotEligible,
    false,
  );
});

test("BUDGET: exhausted and near-limit budgets reject new work; headroom is not a cost guarantee", () => {
  for (const used of [5, 5.01, 8])
    assert.equal(
      inspectBudget(snapshot(5, used), NOW).code,
      "key_budget_exhausted",
    );
  assert.equal(
    inspectBudget(snapshot(5, 4.001), NOW).code,
    "insufficient_headroom",
  );
  const boundary = inspectBudget(snapshot(5, 4), NOW);
  assert.equal(boundary.snapshotEligible, true);
  assert.equal(boundary.modelRequestsAllowed, false);
});

test("BUDGET: native probe requires operator confirmation, sanitizes failure, never dispatches models", async () => {
  let metadataReads = 0;
  const nativeStatus = async () => {
    metadataReads++;
    return snapshot();
  };
  assert.equal(
    (await probeBudget(false, nativeStatus, NOW)).code,
    "operator_key_limit_confirmation_required",
  );
  assert.equal(metadataReads, 0);
  assert.equal(
    (await probeBudget(true, nativeStatus, NOW)).modelRequestsAllowed,
    false,
  );
  assert.equal(metadataReads, 1);
  const error = await probeBudget(
    true,
    async () => {
      throw new Error("dummy-private-secret");
    },
    NOW,
  );
  assert.equal(error.code, "native_usage_unavailable");
  assert.doesNotMatch(JSON.stringify(error), /dummy-private-secret/);
});

test("BUDGET: selected-provider native commands and Gateway start are blocked before dispatch", () => {
  assert.doesNotThrow(() =>
    assertNativeOperationAllowed(true, ["config", "validate", "--json"]),
  );
  assert.doesNotThrow(() =>
    assertNativeOperationAllowed(true, [
      "status",
      "--usage",
      "--json",
      "--agent",
      "main",
      "--timeout",
      "10000",
    ]),
  );
  for (const args of [
    ["memory", "index"],
    ["gateway"],
    ["cron", "run", "job"],
    ["status", "--usage", "--json", "--deep"],
  ])
    assert.throws(
      () => assertNativeOperationAllowed(true, args),
      /strict spending reservation/,
    );
  assert.throws(() => assertGatewayAllowed(true), /Paid Gateway startup/);
  assert.doesNotThrow(() => assertGatewayAllowed(false));
  assert.doesNotThrow(() =>
    assertNativeOperationAllowed(false, ["memory", "index"]),
  );
});

test("BUDGET: native opt-in cannot bypass unavailable hard-spend admission", () => {
  assert.match(
    String(
      modelGate("text", {
        LAB_NATIVE_MODEL_REF: PAID_SELECTION.chat,
        LAB_NATIVE_KEY_ENV: PAID_SELECTION.keyEnv,
        LAB_ALLOW_MODEL_REQUESTS: "1",
      }),
    ),
    /strict spending reservation/,
  );
  assert.match(
    String(
      modelGate("vector", {
        LAB_NATIVE_VECTOR_URL: PAID_SELECTION.embeddingUrl,
        LAB_NATIVE_VECTOR_MODEL: PAID_SELECTION.embedding,
        LAB_NATIVE_VECTOR_KEY_ENV: PAID_SELECTION.keyEnv,
        LAB_ALLOW_MODEL_REQUESTS: "1",
      }),
    ),
    /strict spending reservation/,
  );
});

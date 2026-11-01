import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inspectBudget } from "../src/budget-preflight.ts";
import {
  claimOneRunSmoke,
  type OneRunSmokeBudget,
  oneRunSmokeBudget,
} from "../src/one-run-smoke.ts";
import { SMOKE, smokeBudget } from "../src/paid-smoke.ts";

const NOW = 1900000000000;
const CONFIRMATION = {
  keyLimit: true,
  providerLimitUsd: 50 as const,
  prices: SMOKE.prices,
};

function snapshot(extra: Record<string, unknown> = {}, now = NOW) {
  return {
    usage: {
      updatedAt: now,
      providers: [
        {
          provider: "openrouter",
          billing: [
            {
              type: "budget",
              label: "API key budget",
              unit: "USD",
              limit: 50,
              used: 0,
              ...extra,
            },
          ],
        },
      ],
    },
  };
}

function currentBudget() {
  return oneRunSmokeBudget(
    snapshot({ period: "weekly" }, Date.now()),
    CONFIRMATION,
  );
}

test("ONE RUN: periodic quota scopes one fixed smoke without historical clearance", () => {
  for (const period of ["daily", "weekly", "monthly"] as const) {
    const source = snapshot({ period });
    const before = JSON.stringify(source);
    const budget = oneRunSmokeBudget(source, CONFIRMATION, NOW);
    assert.equal(budget.observedPeriod, period);
    assert.equal(budget.usageScope, "reset-window");
    assert.equal(budget.approvalScope, "one-run-fixed-smoke");
    assert.equal(budget.cumulativeHistoryVerified, false);
    assert.equal(budget.snapshotUpdatedAt, NOW);
    assert.deepEqual(
      [budget.limitUsd, budget.usedUsd, budget.remainingUsd],
      [50, 0, 50],
    );
    assert.equal(JSON.stringify(source), before);
    assert.equal(Object.isFrozen(budget), true);
    assert.equal(
      inspectBudget(source, NOW, 50).code,
      "periodic_or_unknown_reset",
    );
    assert.throws(
      () => smokeBudget(snapshot({ period }, Date.now()), CONFIRMATION),
      /periodic_or_unknown_reset/,
    );
  }
  const absent = oneRunSmokeBudget(snapshot(), CONFIRMATION, NOW);
  assert.equal(absent.observedPeriod, "not-reported");
  assert.equal(absent.usageScope, "native-reported");
  assert.equal(absent.cumulativeHistoryVerified, false);
});

test("ONE RUN: malformed, stale, ambiguous and insufficient quota never grants eligibility", () => {
  const cases: unknown[] = [
    null,
    {},
    { usage: { updatedAt: NOW, providers: [] } },
    snapshot({}, NOW - 30001),
    snapshot({}, NOW + 1001),
    snapshot({ period: null }),
    snapshot({ period: "unknown" }),
    snapshot({ period: "Weekly" }),
    snapshot({ period: [] }),
    snapshot({ limit: 5 }),
    snapshot({ limit: Infinity }),
    snapshot({ limit: "50" }),
    snapshot({ used: -1 }),
    snapshot({ used: NaN }),
    snapshot({ used: "0" }),
    snapshot({ used: 49.001 }),
    snapshot({ used: 50 }),
    snapshot({ unit: "EUR" }),
  ];
  const duplicateProvider = snapshot();
  const [provider] = duplicateProvider.usage.providers;
  assert.ok(provider);
  duplicateProvider.usage.providers.push(provider);
  cases.push(duplicateProvider);
  const duplicateBudget = snapshot();
  const [budgetProvider] = duplicateBudget.usage.providers;
  assert.ok(budgetProvider);
  const [budget] = budgetProvider.billing;
  assert.ok(budget);
  budgetProvider.billing.push(budget);
  cases.push(duplicateBudget);
  const failedProvider = snapshot() as unknown as {
    usage: { updatedAt: number; providers: Array<Record<string, unknown>> };
  };
  const [failed] = failedProvider.usage.providers;
  assert.ok(failed);
  failed.error = "synthetic-private-provider-body";
  cases.push(failedProvider);
  for (const value of cases) {
    assert.throws(
      () => oneRunSmokeBudget(value, CONFIRMATION, NOW),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /synthetic-private-provider-body/);
        return true;
      },
    );
  }
  assert.throws(() => oneRunSmokeBudget(snapshot(), CONFIRMATION, NaN));
  assert.throws(() =>
    oneRunSmokeBudget(snapshot(), { ...CONFIRMATION, keyLimit: false }, NOW),
  );
  assert.throws(() =>
    oneRunSmokeBudget(snapshot(), { ...CONFIRMATION, prices: "wrong" }, NOW),
  );
});

test("ONE RUN: durable admission binds fixed work and consumes before any outcome", async () => {
  const root = await mkdtemp(join(tmpdir(), "one-run-smoke-"));
  try {
    const path = join(root, "admission.json");
    const budget = currentBudget();
    claimOneRunSmoke(path, {
      ...budget,
      privateProviderField: "synthetic-private-value",
    } as OneRunSmokeBudget);
    const before = readFileSync(path, "utf8");
    const receipt = JSON.parse(before);
    assert.equal(receipt.state, "consumed-before-dispatch");
    assert.equal(receipt.automaticReplayAllowed, false);
    assert.equal(receipt.quota.observedPeriod, "weekly");
    assert.equal(receipt.quota.cumulativeHistoryVerified, false);
    assert.equal(receipt.policy.chatModel, "openrouter/openai/gpt-6-sol");
    assert.equal(
      receipt.policy.embeddingModel,
      "openai/text-embedding-3-small",
    );
    assert.equal(receipt.policy.maxChatRequests, 1);
    assert.equal(receipt.policy.maxOutputTokens, 128);
    assert.equal(receipt.policy.estimatedUsd, SMOKE.estimatedUsd);
    assert.equal(receipt.policy.estimateIsHardCap, false);
    assert.doesNotMatch(before, /synthetic-private-value|privateProviderField/);
    assert.match(receipt.policySha256, /^[a-f0-9]{64}$/);
    assert.equal(lstatSync(path).mode & 0o777, 0o600);
    // A failed or interrupted dispatch after this point must not free admission.
    assert.throws(() => claimOneRunSmoke(path, currentBudget()), /admission/);
    assert.equal(readFileSync(path, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ONE RUN: existing malformed, empty, linked and directory targets are never repaired", async () => {
  const root = await mkdtemp(join(tmpdir(), "one-run-existing-"));
  try {
    for (const [name, content] of [
      ["empty.json", ""],
      ["malformed.json", "not json"],
      ["consumed.json", '{"state":"unknown-outcome"}'],
    ] as const) {
      const path = join(root, name);
      writeFileSync(path, content);
      assert.throws(() => claimOneRunSmoke(path, currentBudget()), /admission/);
      assert.equal(readFileSync(path, "utf8"), content);
    }
    const outside = join(root, "outside.json");
    writeFileSync(outside, "synthetic outside content");
    const linked = join(root, "symlink.json");
    symlinkSync(outside, linked);
    assert.throws(() => claimOneRunSmoke(linked, currentBudget()), /admission/);
    assert.equal(readFileSync(outside, "utf8"), "synthetic outside content");
    const hardlink = join(root, "hardlink.json");
    linkSync(outside, hardlink);
    assert.throws(
      () => claimOneRunSmoke(hardlink, currentBudget()),
      /admission/,
    );
    assert.equal(readFileSync(outside, "utf8"), "synthetic outside content");
    const dangling = join(root, "dangling.json");
    symlinkSync(join(root, "absent.json"), dangling);
    assert.throws(
      () => claimOneRunSmoke(dangling, currentBudget()),
      /admission/,
    );
    assert.equal(existsSync(join(root, "absent.json")), false);
    const directory = join(root, "directory.json");
    mkdirSync(directory);
    assert.throws(
      () => claimOneRunSmoke(directory, currentBudget()),
      /admission/,
    );
    const parentAlias = join(root, "parent-alias");
    symlinkSync(root, parentAlias, "dir");
    assert.throws(
      () => claimOneRunSmoke(join(parentAlias, "new.json"), currentBudget()),
      /directory/,
    );
    assert.equal(existsSync(join(root, "new.json")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ONE RUN: stale or widened claims fail before creating a receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "one-run-invalid-"));
  try {
    const path = join(root, "admission.json");
    for (const changes of [
      { snapshotUpdatedAt: Date.now() - 30001 },
      { observedPeriod: null },
      { cumulativeHistoryVerified: true },
      { approvalScope: "general-paid" },
      { limitUsd: 500 },
      { remainingUsd: 500 },
    ]) {
      assert.throws(() =>
        claimOneRunSmoke(path, {
          ...currentBudget(),
          ...changes,
        } as unknown as OneRunSmokeBudget),
      );
      assert.equal(existsSync(path), false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ONE RUN: concurrent processes admit at most one contender", {
  timeout: 20000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "one-run-race-"));
  try {
    const path = join(root, "admission.json");
    const moduleUrl = new URL("../src/one-run-smoke.ts", import.meta.url).href;
    const script = `
      const {claimOneRunSmoke,oneRunSmokeBudget}=await import(process.argv[1]);
      const status={usage:{updatedAt:Date.now(),providers:[{provider:'openrouter',billing:[{type:'budget',label:'API key budget',unit:'USD',limit:50,used:0,period:'weekly'}]}]}};
      const budget=oneRunSmokeBudget(status,{keyLimit:true,providerLimitUsd:50,prices:'8,30,10,0.02'});
      try{claimOneRunSmoke(process.argv[2],budget);process.exitCode=0;}catch{process.exitCode=3;}
    `;
    const contenders = Array.from({ length: 4 }, async () => {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "-e", script, moduleUrl, path],
        { env: {}, stdio: "ignore" },
      );
      const [code] = await once(child, "exit");
      return code;
    });
    const codes = await Promise.all(contenders);
    assert.equal(codes.filter((code) => code === 0).length, 1);
    assert.equal(codes.filter((code) => code === 3).length, 3);
    assert.equal(
      JSON.parse(readFileSync(path, "utf8")).state,
      "consumed-before-dispatch",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

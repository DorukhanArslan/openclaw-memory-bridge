import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const report = JSON.parse(
  readFileSync(
    new URL("../reports/host-agent-memory.json", import.meta.url),
    "utf8",
  ),
);

test("recorded independent Python host used actual model tools and canonical writes", () => {
  assert.equal(report.model, "openai/gpt-6-sol");
  const results = report.conversation.flatMap(
    (turn: {
      calls: Array<{
        results: Array<{ name: string; result: { path?: string } }>;
      }>;
    }) => turn.calls.flatMap((call) => call.results),
  );
  for (const name of [
    "memory_save",
    "memory_save_daily",
    "memory_search",
    "memory_get",
  ])
    assert.ok(results.some((result: { name: string }) => result.name === name));
  assert.match(report.before.preference.text, /ginger/);
  assert.match(report.afterUpdate.text, /lemon/);
  assert.match(report.conversation[2].reply, /memory\/preference.md#L1/);
  assert.match(report.conversation.at(-1).reply, /cobalt/);
});

test("recorded native maintenance distinguishes cron receipt, accepted consolidation and model diary publication", () => {
  assert.equal(report.maintenance.sweep.completed, true);
  assert.equal(report.maintenance.sweep.completionStatus, "succeeded");
  assert.deepEqual(report.maintenance.publishers, {
    light: "completed",
    rem: "completed",
    deep: "completed",
  });
  assert.match(report.durable.text, /Consolidated Memory/);
  assert.match(report.durable.text, /Source: memory\/2026-10-13.md#L1-L2/);
  assert.match(
    report.maintenanceRounds[0].diary.content,
    /details were unavailable/,
  );
  assert.equal(report.maintenanceRounds.length, 2);
});

test("recorded same-ledger continuation keeps cumulative costs and attempted calls", () => {
  assert.equal(report.configuration.budget.limitUsd, 50);
  assert.ok(report.configuration.budget.usedUsd > 0.42501892);
  assert.ok(report.afterBudget.usedUsd > report.configuration.budget.usedUsd);
  assert.ok(report.afterBudget.usedUsd < 50);
  assert.equal(report.hostLedger.requests, 20);
  assert.equal(report.maintenanceRounds[0].receipt.ledger.requests, 4);
  assert.equal(report.maintenance.ledger.requests, 8);
});

test("recorded host restart and route checks pass with explicit foreign-context and security limits", () => {
  assert.equal(report.ok, true);
  assert.equal(Object.keys(report.checks).length, 10);
  assert.ok(Object.values(report.checks).every((value) => value === true));
  assert.deepEqual(report.otherUser.results, []);
  assert.deepEqual(report.otherWorkspace.results, []);
  assert.match(report.limitations.externalContext, /foreign Python/);
  assert.match(report.limitations.routing, /no auth/);
  assert.match(report.limitations.supersession, /Not verified/);
});

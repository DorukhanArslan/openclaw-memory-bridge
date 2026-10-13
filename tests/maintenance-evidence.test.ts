import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const report = JSON.parse(
  readFileSync(
    new URL("../reports/maya-maintenance.json", import.meta.url),
    "utf8",
  ),
);
const step = (id: string) =>
  report.steps.find((s: { id: string }) => s.id === id);

test("real native Maya continuation preserves original session and consumed ledger", () => {
  assert.equal(report.sessionIdentityBefore, report.sessionIdentityAfter);
  assert.equal(report.budget.priorLedger.requests, 24);
  assert.deepEqual(report.budget.priorLedgerAfter, report.budget.priorLedger);
  assert.equal(report.budget.priorLedgerIntegrity, "pass");
  assert.equal(report.budget.phaseLedger.requests, 20);
  assert.equal(report.budget.approvedCumulativeUsd, 50);
  assert.ok(report.budget.after.usedUsd < 50);
});

test("native successful flush marker is distinct from the observed daily agent write", () => {
  const chat = step("native-chat-and-flush");
  const flush = step("observe-native-flush");
  assert.equal(flush.maintenance.memoryFlush.kind, "succeeded");
  assert.equal(chat.bot, chat.responseEvidence.terminalReply.text);
  const change = chat.changes.find(
    (c: { path: string }) => c.path === "memory/2026-10-13.md",
  );
  assert.equal(change.before, null);
  assert.match(change.after, /thermometer at 08:00/);
  const writer = chat.observedWriters.find(
    (c: { name: string }) => c.name === "write",
  );
  assert.equal(writer.arguments.content, change.after);
  assert.ok(
    chat.writerResults.some(
      (r: { toolCallId: string; isError: boolean }) =>
        r.toolCallId === writer.id && !r.isError,
    ),
  );
  assert.match(
    report.limitations.flushWriteAttribution,
    /No distinct flush-only file write/,
  );
});

test("committed compaction reduces context while current source overrides older summary state", () => {
  const compact = step("native-compaction");
  assert.equal(compact.native.compacted, true);
  assert.equal(compact.native.result.tokensBefore, 9447);
  assert.equal(compact.native.result.tokensAfter, 1182);
  assert.match(compact.native.result.summary, /USER.md.*still says mint tea/);
  assert.match(report.finalWorkspace["USER.md"], /currently prefers rooibos/);
  const recall = step("recall-after-compaction");
  assert.equal(recall.bot, recall.responseEvidence.terminalReply.text);
  assert.match(recall.bot, /rooibos/);
  assert.match(recall.bot, /Monday/);
});

test("real new-session agent recalls current profile and daily source after dreaming and restart", () => {
  const final = step("new-session-after-dream-and-restart");
  assert.equal(final.responseEvidence.status, "ok");
  assert.equal(
    final.responseEvidence.terminalReceipt.effective.model,
    "openai/gpt-6-sol",
  );
  assert.equal(final.bot, final.responseEvidence.terminalReply.text);
  for (const text of [
    "rooibos",
    "Monday",
    "thermometer",
    "USER.md#L6-L7",
    "memory/2026-10-13.md#L1-L3",
  ])
    assert.ok(final.bot.includes(text));
  assert.deepEqual(final.changes, []);
  assert.equal(step("native-dreaming").native.completionStatus, "succeeded");
  assert.equal(report.nativeDreaming.promotedToday, 0);
});

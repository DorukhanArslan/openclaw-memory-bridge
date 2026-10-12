import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const report = JSON.parse(
  readFileSync(
    new URL("../reports/chatbot-memory-demo.json", import.meta.url),
    "utf8",
  ),
);
const step = (id: string) =>
  report.steps.find((s: { id: string }) => s.id === id);

test("recorded native conversation starts without harness-written notes", () => {
  assert.ok(Object.values(report.initialWorkspace).every((v) => v === null));
  for (const id of ["turn-1", "turn-2", "turn-3-continuation", "turn-4"]) {
    const s = step(id);
    assert.ok(
      s.responseEvidence.some((p: { text?: string }) => p.text === s.bot),
    );
  }
});

test("native write and edit results match actual profile and daily diffs", () => {
  const first = step("turn-1");
  const write = first.toolCalls.find(
    (t: { name: string }) => t.name === "write",
  );
  assert.equal(write.arguments.content, first.changes[0].after);
  assert.ok(
    first.toolResults.some(
      (r: { toolCallId: string; isError: boolean }) =>
        r.toolCallId === write.id && !r.isError,
    ),
  );
  const second = step("turn-2");
  assert.equal(
    second.toolCalls.find((t: { name: string }) => t.name === "write").arguments
      .content,
    second.changes.find((c: { path: string }) => c.path.startsWith("memory/"))
      .after,
  );
  const updated = step("turn-3-continuation").changes[0];
  assert.match(updated.before, /prefers mint tea/);
  assert.match(updated.after, /currently prefers rooibos tea/);
});

test("new session genuinely recalls update and native trace proves profile loading", () => {
  const s = step("turn-4");
  assert.match(s.bot, /rooibos tea/);
  assert.match(s.bot, /Monday/);
  assert.match(s.bot, /USER.md#L6-L7/);
  assert.deepEqual(s.changes, []);
  const profile = s.bootstrapTrace.files.find(
    (f: { name: string }) => f.name === "USER.md",
  );
  assert.equal(profile.missing, false);
  assert.equal(profile.rawChars, 262);
  assert.equal(profile.injectedChars, 262);
  const bootstrap = s.bootstrapTrace.files.find(
    (f: { name: string }) => f.name === "BOOTSTRAP.md",
  );
  assert.equal(bootstrap.missing, true);
  assert.equal(bootstrap.injectedChars, 0);
});

test("native dreaming promotes event while stale diary is not current preference", () => {
  const s = step("dreaming");
  assert.equal(s.sweep.completionStatus, "succeeded");
  assert.match(
    s.changes.find((c: { path: string }) => c.path === "MEMORY.md").after,
    /Source: memory\/2026-10-12.md#L1-L4/,
  );
  assert.match(
    s.changes.find((c: { path: string }) => c.path === "DREAMS.md").after,
    /Added: 1\n- Merged: 0\n- Superseded: 0/,
  );
  assert.match(s.currentTruthWarning, /older mint-tea/);
  assert.equal(s.diaryPhaseEvents.length, 3);
});

test("failed native turns have no invented assistant and retained ledger remains cumulative", () => {
  assert.equal(step("turn-3-blocked").bot, null);
  assert.equal(step("turn-5-native-blocked").bot, null);
  assert.equal(report.retainedPriorLedger.requests, 11);
  assert.ok(report.ledger.requests >= 23);
  assert.ok(report.ledger.inputBytes >= 385357);
  assert.ok(report.ledger.inputBytes <= report.limits.inputBytes);
  assert.ok(report.ledger.outputTokens <= report.limits.outputTokens);
  assert.equal(step("sdk-recall").sdk.provider, "none");
  assert.ok(
    step("sdk-recall").sdk.sources.some((s: { snippet: string }) =>
      /rooibos/.test(s.snippet),
    ),
  );
});

test("post-dream answer is real native output grounded in SDK context", () => {
  const s = step("application-final-answer");
  assert.equal(s.responseEvidence.provider, "openrouter");
  assert.equal(s.responseEvidence.model, "openai/gpt-6-sol");
  assert.equal(s.bot, s.responseEvidence.json.answer);
  assert.match(s.bot, /rooibos tea/);
  assert.match(s.bot, /USER.md/);
  assert.deepEqual(s.changes, []);
  assert.deepEqual(s.before, s.after);
});

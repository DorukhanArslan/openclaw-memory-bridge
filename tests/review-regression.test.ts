import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { consolidationCheckpoint } from "../src/consolidation-checkpoint.ts";
import {
  admitLifecycleRequest,
  boundConsolidationUtilityRequest,
  createLifecycleLedger,
  readLifecycleLedger,
} from "../src/lifecycle-request-budget.ts";

const note = "Synthetic Project Borealis uses indigo filters every Thursday.\n";
const checkpoint = {
  stages: { flush: "pass", extraction: "pass" },
  afterFlush: { "memory/2026-10-11.md": note },
};

test("Review 4242092106: prior-day verified checkpoint works just after UTC midnight", () => {
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 12, 0, 0, 1) });
  try {
    assert.deepEqual(consolidationCheckpoint(checkpoint), {
      day: "2026-10-11",
      note,
    });
  } finally {
    mock.timers.reset();
  }
});

test("Review 4242092112: admission cannot overwrite a symlink ledger target", () => {
  const root = mkdtempSync(join(tmpdir(), "ledger-review-"));
  const target = join(root, "unrelated-fixture.json");
  const ledger = join(root, "ledger.json");
  const original = JSON.stringify({
    requests: 0,
    inputBytes: 0,
    outputTokens: 0,
    profile: "consolidation",
  });
  try {
    writeFileSync(target, original);
    symlinkSync(target, ledger);
    for (const model of ["openai/gpt-6-sol", "denied-model"]) {
      let denied = false;
      try {
        admitLifecycleRequest(
          ledger,
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            body: JSON.stringify({ model, max_completion_tokens: 1024 }),
          },
        );
      } catch {
        denied = true;
      }
      assert.equal(
        readFileSync(target, "utf8"),
        original,
        "The unrelated fixture must stay byte-identical.",
      );
      assert.ok(denied, "A symlink ledger must be rejected before dispatch.");
    }
    assert.throws(() =>
      boundConsolidationUtilityRequest(
        ledger,
        "https://openrouter.ai/api/v1/chat/completions",
        { method: "POST", body: JSON.stringify({ model: "openai/gpt-6-sol" }) },
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Checkpoint selection rejects invalid, ambiguous, and unverified artifacts", () => {
  assert.throws(
    () =>
      consolidationCheckpoint({
        ...checkpoint,
        stages: { flush: "fail", extraction: "pass" },
      }),
    /verified/,
  );
  assert.throws(
    () =>
      consolidationCheckpoint({
        ...checkpoint,
        afterFlush: { "memory/2026-02-30.md": note },
      }),
    /dated/,
  );
  assert.throws(
    () =>
      consolidationCheckpoint({
        ...checkpoint,
        afterFlush: { ...checkpoint.afterFlush, "memory/2026-10-10.md": note },
      }),
    /One verified/,
  );
  assert.deepEqual(
    consolidationCheckpoint({
      ...checkpoint,
      afterFlush: {
        ...checkpoint.afterFlush,
        "memory/unrelated.md": "Other synthetic data",
      },
    }),
    { day: "2026-10-11", note },
  );
});

test("Existing ledger reads reject links and nonregular files, and retain regular counters", () => {
  const root = mkdtempSync(join(tmpdir(), "ledger-regular-"));
  try {
    const regular = join(root, "regular.json");
    createLifecycleLedger(regular, "consolidation");
    assert.deepEqual(readLifecycleLedger(regular), {
      requests: 0,
      inputBytes: 0,
      outputTokens: 0,
      profile: "consolidation",
    });
    assert.throws(() => readLifecycleLedger(root), /regular file/);
    const link = join(root, "link.json");
    symlinkSync(regular, link);
    assert.throws(() => readLifecycleLedger(link));
    assert.throws(() => createLifecycleLedger(link, "consolidation"), /EEXIST/);
    const dangling = join(root, "dangling.json");
    symlinkSync(join(root, "missing.json"), dangling);
    assert.throws(() => readLifecycleLedger(dangling));
    assert.deepEqual(readLifecycleLedger(regular), {
      requests: 0,
      inputBytes: 0,
      outputTokens: 0,
      profile: "consolidation",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

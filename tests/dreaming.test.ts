import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { dreamDemo } from "../src/dream-demo.ts";
import { PROJECT } from "../src/lab.ts";

test("REAL native REM staging, complete dreaming sweep, sourced promotion, persistence and recall", {
  timeout: 600000,
}, async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-"));
  try {
    const result = await dreamDemo(root, "dreaming");
    assert.match(JSON.stringify(result.remPreview), /cobalt/);
    assert.ok(
      (result.staged as { stagedShortTermEntries: number })
        .stagedShortTermEntries > 0,
    );
    const sweep = result.sweep as {
      completed: boolean;
      completionStatus: string;
    };
    assert.equal(sweep.completed, true);
    assert.equal(sweep.completionStatus, "succeeded");
    assert.match(JSON.stringify(result.phaseStatus), /"light"/);
    assert.match(JSON.stringify(result.phaseStatus), /"rem"/);
    assert.match(JSON.stringify(result.phaseStatus), /"deep"/);
    const phases = result.phaseStatus as {
      dreaming: { lightPhaseHitCount: number; remPhaseHitCount: number };
    };
    assert.ok(phases.dreaming.lightPhaseHitCount > 0);
    assert.ok(phases.dreaming.remPhaseHitCount > 0);
    assert.ok(
      (result.manualPromotion as { apply: { applied: number } }).apply.applied >
        0,
    );
    const memory = result.durableMemory as { status: string; text: string };
    assert.equal(memory.status, "ok");
    assert.match(memory.text, /cobalt/);
    assert.match(memory.text, /source=memory\/\d{4}-\d{2}-\d{2}\.md:\d+-\d+/);
    assert.ok(
      result.persistedRecall.results.some((hit) => hit.path === "MEMORY.md"),
    );
    assert.match(
      JSON.stringify(result.explanationAfter),
      /provenance|origin|promoted/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

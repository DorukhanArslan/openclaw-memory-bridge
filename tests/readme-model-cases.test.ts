import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Actual provider entry points, not evidence audits or mock providers.
// Select one fixed family only after the existing finite-budget approval.
const selected = process.env.LAB_README_REAL_MODEL_CASE;
const families = ["MODEL-01", "MODEL-02-04", "MODEL-05-06"];
if (selected && !families.includes(selected))
  throw new Error("Select MODEL-01, MODEL-02-04, or MODEL-05-06.");
const project = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);
const gate = (family: string) =>
  selected === family
    ? false
    : "Explicit finite real-model case selection is required. Historical audits are separate.";

async function unconsumedLedger(relative: string) {
  const { readLifecycleLedger } = await import(
    "../src/lifecycle-request-budget.ts"
  );
  try {
    const ledger = readLifecycleLedger(join(project, relative));
    if (ledger.requests || ledger.inputBytes || ledger.outputTokens)
      throw new Error(
        "Measured fixed-run ledger is consumed. Do not reset or rename it for automatic replay.",
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function artifactRun(entry: string, artifact: string) {
  const path = join(project, artifact);
  const before = await stat(path)
    .then((value) => value.mtimeMs)
    .catch(() => 0);
  // Native lifecycle may fail a later unrelated phase after the specific
  // extraction/flush/compaction stages passed. Test those stages explicitly;
  // do not turn the entire CLI exit into an overall success claim.
  let exitCode = 0;
  try {
    await run(process.execPath, [join(project, entry)], {
      cwd: project,
      timeout: 900000,
      maxBuffer: 1000000,
    });
  } catch (error) {
    const failure = error as { code?: number };
    if (typeof failure.code !== "number")
      throw new Error("Fixed native runner did not complete.");
    exitCode = failure.code;
  }
  const after = await stat(path)
    .then((value) => value.mtimeMs)
    .catch(() => 0);
  assert.ok(
    after > before,
    "A fresh native artifact is required; never accept an old record after runner failure.",
  );
  const record = JSON.parse(await readFile(path, "utf8"));
  return { record, exitCode };
}

test("MODEL-01 REAL fixed native embedding search and source read", {
  skip: gate("MODEL-01"),
  timeout: 240000,
}, async () => {
  // The original bounded smoke has a finite per-run bound. Check cumulative
  // usage too before dispatching it; no provider SDK or new model API is used.
  const { Lab } = await import("../src/lab.ts");
  const { PAID_SELECTION } = await import("../src/budget-preflight.ts");
  const { SMOKE, smokeBudget } = await import("../src/paid-smoke.ts");
  const root = await mkdtemp(join(project, ".lab-test-readme-quota-"));
  const probe = await new Lab("quota", root).init();
  try {
    await probe.configureNativeModel(
      PAID_SELECTION.chat,
      PAID_SELECTION.keyEnv,
    );
    const budget = smokeBudget(await probe.providerUsage(), {
      keyLimit: true,
      providerLimitUsd: 50,
      prices: SMOKE.prices,
    });
    assert.ok(
      budget.usedUsd + SMOKE.estimatedUsd <= 5,
      "Finite smoke estimate must fit the cumulative 5 USD ceiling.",
    );
  } finally {
    await probe.close();
    await rm(root, { recursive: true, force: true });
  }
  const { stdout } = await run(
    process.execPath,
    [join(project, "examples/bounded_smoke.ts")],
    { cwd: project, timeout: 180000, maxBuffer: 1000000 },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.mode, "real-provider");
  assert.equal(result.completion.ok, true);
  assert.equal(result.recall.path, "memory/resident.md");
  assert.ok(result.recall.hits > 0);
  // Lab.boundedSmoke itself asserts the selected embedding provider, real
  // bicycle source text, and the exact synonym query before returning.
});

test("MODEL-02/03/04 REAL fixed native conversation, extraction, flush and compaction", {
  skip: gate("MODEL-02-04"),
  timeout: 900000,
}, async (t) => {
  await unconsumedLedger(
    "evidence/lifecycle-acceptance/request-ledger-final.json",
  );
  const { record: d, exitCode } = await artifactRun(
    "examples/lifecycle_acceptance.ts",
    "evidence/lifecycle-acceptance/acceptance.json",
  );
  await t.test("MODEL-02 actual model extraction", () => {
    assert.equal(d.stages.chat, "pass");
    assert.equal(d.stages.extraction, "pass");
    assert.deepEqual(d.beforeConversation, {});
    assert.deepEqual(d.afterFirstConversation, {});
    assert.equal(d.secondConversation.completion.status, "ok");
    assert.match(d.dailySource.text, /indigo/);
  });
  await t.test("MODEL-03 actual successful native flush", () => {
    assert.equal(d.stages.flush, "pass");
    assert.equal(
      d.secondConversation.state.nativeMaintenance.memoryFlush.kind,
      "succeeded",
    );
    assert.match(d.afterFlush[d.dailySource.path], /indigo/);
    assert.ok(
      d.recallBeforeDreaming.every((r: { results: Array<{ path: string }> }) =>
        r.results.some((h) => h.path === d.dailySource.path),
      ),
    );
  });
  await t.test("MODEL-04 actual committed native compaction", () => {
    assert.equal(d.stages.compaction, "pass");
    assert.equal(d.compaction.native.compacted, true);
    assert.ok(d.compaction.native.result.summary);
    assert.ok(d.compaction.state.nativeMaintenance.compactionCount >= 1);
  });
  t.diagnostic(
    `Fixed runner exit: ${exitCode}; only MODEL-02/03/04 stages are asserted, not later consolidation.`,
  );
});

test("MODEL-05/06 REAL fixed native duplicate merge and complete model diary", {
  skip: gate("MODEL-05-06"),
  timeout: 900000,
}, async (t) => {
  await unconsumedLedger(
    "evidence/provenance-merge-acceptance/request-ledger.json",
  );
  const { record: d, exitCode } = await artifactRun(
    "examples/provenance_acceptance.ts",
    "evidence/provenance-merge-acceptance/acceptance.json",
  );
  assert.equal(
    exitCode,
    0,
    "The native merge/diary bundle must complete successfully.",
  );
  await t.test(
    "MODEL-05 actual native duplicate merge and source persistence",
    () => {
      assert.equal(d.stages.modelConsolidation, "pass");
      assert.equal(d.stages.durableMerge, "pass");
      const before = d.before["MEMORY.md"],
        after = d.after["MEMORY.md"];
      assert.notEqual(after, before);
      assert.equal(
        (
          after.match(
            /Synthetic Project Vega uses amber filters every Friday/g,
          ) ?? []
        ).length,
        1,
      );
      assert.match(after, /Source: memory\//);
      assert.match(after, /openclaw-memory-promotion:/);
      for (const fact of [
        "silver notebooks",
        "paper charts",
        "brass clocks",
        "white folders",
      ])
        assert.ok(after.includes(fact));
      for (const [field, count] of [
        ["Added", 0],
        ["Merged", 1],
        ["Superseded", 0],
      ])
        assert.match(d.after["DREAMS.md"], new RegExp(`${field}:\\s+${count}`));
      assert.equal(
        d.sourceSession.session.sessionId,
        d.sessionAfterRestart.session.sessionId,
      );
      assert.ok(
        d.recallAfterRestart.results.some(
          (h: { path: string }) => h.path === "MEMORY.md",
        ),
      );
      assert.ok(
        !d.nativeDiagnostics.some((line: string) =>
          /consolidation.*fallback/.test(line),
        ),
      );
    },
  );
  await t.test("MODEL-06 actual complete model diary publication", () => {
    assert.equal(d.stages.modelDiary, "pass");
    assert.ok(d.after["DREAMS.md"].length > 100);
    for (const phase of ["light", "rem", "deep"])
      assert.ok(
        d.nativeDiagnostics.some((line: string) =>
          line.includes(`dream diary entry written for ${phase} phase`),
        ),
      );
    assert.ok(
      !d.nativeDiagnostics.some((line: string) =>
        /narrative generation (?:failed|used fallback)/.test(line),
      ),
    );
    assert.ok(d.requestLedger.requests <= d.limits.requests);
    assert.ok(d.requestLedger.outputTokens <= d.limits.outputTokens);
    assert.ok(d.afterBudget.usedUsd < 5);
  });
});

test("MODEL-07 changed-fact supersession", {
  skip: "Matching native lineage and an accepted runnable supersession fixture are not verified.",
}, () => {});

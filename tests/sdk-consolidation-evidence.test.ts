import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const report = JSON.parse(
  readFileSync(
    new URL("../reports/sdk-consolidation.json", import.meta.url),
    "utf8",
  ),
);

test("recorded real installed SDK accepts native duplicate merge, not append-only promotion", () => {
  assert.equal(report.ok, true);
  assert.deepEqual(report.newConsolidationSummaries, [["0", "1", "0"]]);
  assert.equal(
    report.before.text.match(
      /Synthetic Project Vega uses amber filters every Friday\./g,
    )?.length,
    1,
  );
  assert.equal(
    report.after.text.match(
      /Synthetic Project Vega uses amber filters every Friday\./g,
    )?.length,
    1,
  );
  assert.match(report.before.text, /Source: memory\/2026-10-11.md/);
  assert.doesNotMatch(report.after.text, /Source: memory\/2026-10-11.md/);
  assert.match(report.after.text, /Source: memory\/2026-10-17.md/);
  assert.deepEqual(report.afterRestart, report.after);
  assert.ok(Object.values(report.checks).every((v) => v === true));
});

test("recorded SDK merge preserves unrelated facts, old counters, and a separate model diary receipt", () => {
  for (const text of [
    "silver notebooks",
    "paper charts",
    "brass clocks",
    "white folders",
  ])
    assert.ok(report.after.text.includes(text));
  assert.deepEqual(report.priorNativeLedgerAfter, report.priorNativeLedger);
  assert.equal(report.priorNativeLedger.requests, 6);
  assert.equal(report.maintenance.ledger.requests, 4);
  assert.equal(report.maintenance.sweep.completed, true);
  assert.deepEqual(report.maintenance.publishers, {
    light: "completed",
    rem: "completed",
    deep: "completed",
  });
  assert.ok(report.afterBudget.usedUsd > report.configuration.budget.usedUsd);
  assert.ok(report.afterBudget.usedUsd < 50);
});

test("pinned Markdown provenance cannot satisfy native supersession's mandatory lineage contract", () => {
  for (const [name, hash] of Object.entries(report.contracts)) {
    const bytes = readFileSync(
      new URL(`../node_modules/openclaw/dist/${name}`, import.meta.url),
    );
    assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
  }
  const preparation = readFileSync(
    new URL(
      "../node_modules/openclaw/dist/manager-index-preparation-wXpJtJiU.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const body = preparation.slice(
    preparation.indexOf("function resolveChunkProvenance"),
  );
  const markdownReturn = body.slice(
    body.lastIndexOf("\n\treturn {"),
    body.indexOf("//#endregion"),
  );
  assert.match(markdownReturn, /originClass: pathOriginClass/);
  assert.doesNotMatch(markdownReturn, /supersedesKey/);
  const native = readFileSync(
    new URL(
      "../node_modules/openclaw/dist/short-term-promotion-MX1vHJuE.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    native,
    /if \(!candidate\.provenance\?\.supersedesKey\) return `output supersedes/,
  );
  assert.match(native, /attachedLineageKey !== operation\.lineageKey/);
  assert.equal(
    report.supersession.status,
    "unsupported by this pinned SDK Markdown path",
  );
});

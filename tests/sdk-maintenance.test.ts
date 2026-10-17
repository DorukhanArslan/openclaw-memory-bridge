import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Lab, PROJECT } from "../src/lab.ts";

test("SDK maintenance rejects missing configuration and unapproved budget before credential access", async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-sdk-maintenance-"));
  const lab = await new Lab("guard", root).init();
  try {
    await assert.rejects(lab.runMaintenance(), /Configure finite/);
    await assert.rejects(
      lab.configureMaintenance(5, 12),
      /authorized cumulative/,
    );
    await assert.rejects(
      lab.configureMaintenance(50, Number.NaN),
      /finite host reserve/,
    );
    await assert.rejects(readFile(join(root, "sdk-maintenance-ledger.json")), {
      code: "ENOENT",
    });
    const config = JSON.parse(await readFile(lab.config, "utf8"));
    assert.equal(
      config.plugins.entries["memory-core"].config.dreaming.enabled,
      false,
    );
  } finally {
    await lab.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical daily note replacement validates date and reports explicit reindex", async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-sdk-daily-"));
  const lab = await new Lab("daily", root).init();
  try {
    await assert.rejects(
      lab.writeDaily("2026-02-30", "Synthetic event"),
      /valid YYYY/,
    );
    await lab.writeDaily("2026-10-13", "Synthetic Maya drinks ginger tea.");
    const result = await lab.writeDaily(
      "2026-10-13",
      "Synthetic Maya drinks lemon tea.",
    );
    assert.equal(result.needsIndex, true);
    assert.equal(
      await readFile(join(lab.notes, "2026-10-13.md"), "utf8"),
      "Synthetic Maya drinks lemon tea.\n",
    );
  } finally {
    await lab.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("SDK maintenance refuses an existing vector selection without silently replacing it", async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-sdk-vector-"));
  const directory = join(root, "vector");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(directory);
  const settings = {
    provider: "openai-compatible",
    model: "synthetic-local-embedding",
    baseUrl: "http://127.0.0.1:19000",
  };
  await writeFile(join(directory, "settings.json"), JSON.stringify(settings));
  const lab = await new Lab("vector", root).init();
  try {
    await assert.rejects(
      lab.configureMaintenance(50, 12),
      /requires explicit keyword mode/,
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, "settings.json"), "utf8")),
      settings,
    );
    await assert.rejects(readFile(join(root, "sdk-maintenance-ledger.json")), {
      code: "ENOENT",
    });
  } finally {
    await lab.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("SDK reconnect rechecks the cumulative budget before native staging (configuration fixture)", async () => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { createLifecycleLedger } = await import(
    "../src/lifecycle-request-budget.ts"
  );
  const root = await mkdtemp(join(PROJECT, ".lab-test-sdk-recheck-"));
  const directory = join(root, "recheck");
  await mkdir(directory);
  createLifecycleLedger(
    join(root, "sdk-maintenance-ledger.json"),
    "maintenance",
  );
  await writeFile(
    join(directory, "settings.json"),
    JSON.stringify({
      provider: "none",
      managedMaintenance: true,
      maintenanceHostReserveUsd: 12,
    }),
  );
  const lab = await new Lab("recheck", root).init();
  let staged = false;
  lab.configureMaintenance = async (limit, reserve) => {
    assert.equal(limit, 50);
    assert.equal(reserve, 12);
    throw new Error("Fixture cumulative budget denied");
  };
  lab.remStage = async () => {
    staged = true;
    return {};
  };
  try {
    await assert.rejects(
      lab.runMaintenance(),
      /Fixture cumulative budget denied/,
    );
    assert.equal(staged, false);
  } finally {
    await lab.close();
    await rm(root, { recursive: true, force: true });
  }
});

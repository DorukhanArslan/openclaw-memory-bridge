import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const moduleUrl =
  process.env.LAB_LEDGER_TEST_MODULE ??
  new URL("../src/lifecycle-request-budget.ts", import.meta.url).href;
const budget = await import(moduleUrl);
const fixture = fileURLToPath(
  new URL("./fixtures/ledger-race-child.ts", import.meta.url),
);
const cases: Array<{
  profile?: "consolidation" | "conversation" | "maintenance";
  kind: string;
}> = [{ kind: "model" }, { profile: "consolidation", kind: "model" }];
if (budget.E2E_LIMITS)
  cases.push(
    { profile: "conversation", kind: "model" },
    { profile: "conversation", kind: "input" },
  );
if (budget.MAINTENANCE_LIMITS)
  cases.push(
    { profile: "maintenance", kind: "model" },
    { profile: "maintenance", kind: "input" },
  );

for (const { profile, kind } of cases) {
  test(`denial preserves concurrent admission: ${profile ?? "lifecycle"}/${kind}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "ledger-race-"));
    const path = join(root, "synthetic-ledger.json");
    try {
      budget.createLifecycleLedger(path, profile);
      const initial = {
        requests: 3,
        inputBytes: 900,
        outputTokens: 1536,
        ...(profile ? { profile } : {}),
      };
      writeFileSync(path, JSON.stringify(initial));
      const child = spawnSync(
        process.execPath,
        [fixture, "deny-after-admission", moduleUrl, path, kind],
        { encoding: "utf8", env: {}, timeout: 10000 },
      );
      assert.equal(child.status, 0, child.stderr);
      const actual = JSON.parse(child.stdout);
      const body = JSON.stringify({
        model: "openai/gpt-6-sol",
        max_completion_tokens: 512,
      });
      assert.equal(
        actual.requests,
        4,
        "denial must preserve the sibling admission",
      );
      assert.equal(
        actual.inputBytes,
        initial.inputBytes + Buffer.byteLength(body),
      );
      assert.equal(actual.outputTokens, initial.outputTokens + 512);
      assert.equal(actual.profile, profile);
      assert.ok(actual.lastDenial);
      const limits =
        profile === "maintenance"
          ? budget.MAINTENANCE_LIMITS
          : profile === "conversation"
            ? budget.E2E_LIMITS
            : profile === "consolidation"
              ? budget.CONSOLIDATION_LIMITS
              : budget.LIFECYCLE_LIMITS;
      const admit = () =>
        budget.admitLifecycleRequest(
          path,
          "https://openrouter.ai/api/v1/chat/completions",
          { method: "POST", body },
        );
      for (let count = actual.requests; count < limits.requests; count++)
        admit();
      assert.throws(admit, /request budget exhausted/);
      assert.equal(
        JSON.parse(readFileSync(path, "utf8")).requests,
        limits.requests,
      );
      assert.throws(
        () => budget.createLifecycleLedger(path, profile),
        /EEXIST/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("denial respects an admission lock without changing counters or stealing the lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "ledger-denial-lock-"));
  const path = join(root, "synthetic-ledger.json");
  try {
    budget.createLifecycleLedger(path);
    const before = readFileSync(path, "utf8");
    const fd = openSync(`${path}.lock`, "wx", 0o600);
    closeSync(fd);
    assert.throws(
      () =>
        budget.admitLifecycleRequest(
          path,
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            body: JSON.stringify({
              model: "wrong-model",
              max_completion_tokens: 512,
            }),
          },
        ),
      /EEXIST/,
    );
    assert.equal(readFileSync(path, "utf8"), before);
    assert.equal(readFileSync(`${path}.lock`, "utf8"), "");
    unlinkSync(`${path}.lock`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

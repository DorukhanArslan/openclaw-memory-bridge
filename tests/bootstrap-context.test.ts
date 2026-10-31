import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const project = fileURLToPath(new URL("../", import.meta.url));
const script = join(project, "examples/bootstrap_context.mjs");

type FileEvidence = {
  name: string;
  missing: boolean;
  rawChars: number;
  injectedChars: number;
  truncated: boolean;
  actualTemplateInPrompt: boolean;
  placeholderInContext: boolean;
  rawSha256: string | null;
};
type ContextEvidence = {
  routing: { bootstrapMode: string; includeBootstrapInSystemContext: boolean };
  files: FileEvidence[];
  contextChars: number;
};

test("BOOTSTRAP: real native templates enter prepared context without a model", {
  timeout: 240000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bootstrap-context-test-"));
  const output = join(root, "capture");
  const options = {
    cwd: root,
    env: { PATH: "/usr/bin:/bin" },
    timeout: 230000,
  };
  try {
    const { stdout } = await run(
      process.execPath,
      [script, "--output-dir", output],
      options,
    );
    const printed = JSON.parse(stdout);
    assert.equal(printed.kind, "native-bootstrap-preparation");
    assert.equal(printed.modelCalls, 0);
    const receiptPath = join(output, "receipt.json");
    const originalReceipt = await readFile(receiptPath, "utf8");
    const receipt = JSON.parse(originalReceipt) as {
      runtime: { node: string; openclaw: string };
      officialTemplateBodiesMatch: Record<string, boolean>;
      contractsVerified: boolean;
      repeatSetupPreserved: boolean;
      positive: ContextEvidence;
      limited: ContextEvidence;
      skipped: ContextEvidence;
      modelCalls: number;
      gatewayStarted: boolean;
      modelResponseVerified: boolean;
      bootstrapWorkflowCompleted: boolean;
    };
    await t.test(
      "official seeded bodies, not placeholders, appear in the native prompt",
      () => {
        assert.deepEqual(receipt.runtime, {
          node: "24.16.0",
          openclaw: "2026.9.9",
        });
        assert.equal(receipt.contractsVerified, true);
        assert.equal(receipt.repeatSetupPreserved, true);
        assert.deepEqual(
          Object.keys(receipt.officialTemplateBodiesMatch).sort(),
          ["AGENTS.md", "BOOTSTRAP.md", "IDENTITY.md", "SOUL.md", "USER.md"],
        );
        assert.ok(
          Object.values(receipt.officialTemplateBodiesMatch).every(Boolean),
        );
        assert.equal(receipt.positive.routing.bootstrapMode, "full");
        assert.equal(
          receipt.positive.routing.includeBootstrapInSystemContext,
          true,
        );
        for (const file of receipt.positive.files) {
          assert.equal(file.missing, false, file.name);
          assert.equal(file.truncated, false, file.name);
          assert.equal(file.placeholderInContext, false, file.name);
          assert.equal(file.actualTemplateInPrompt, true, file.name);
          assert.ok(file.rawChars > 0 && file.injectedChars > 0, file.name);
          assert.match(file.rawSha256 ?? "", /^[0-9a-f]{64}$/);
        }
      },
    );
    await t.test(
      "skip-bootstrap placeholders cannot pass as loaded template content",
      () => {
        assert.equal(receipt.skipped.routing.bootstrapMode, "none");
        assert.equal(
          receipt.skipped.routing.includeBootstrapInSystemContext,
          false,
        );
        assert.ok(
          receipt.skipped.files.every(
            (file) => file.missing && !file.actualTemplateInPrompt,
          ),
        );
        assert.ok(
          receipt.skipped.files.some(
            (file) => file.placeholderInContext && file.injectedChars > 0,
          ),
        );
        const bootstrap = receipt.skipped.files.find(
          (file) => file.name === "BOOTSTRAP.md",
        );
        assert.ok(bootstrap);
        assert.equal(bootstrap.injectedChars, 0);
        assert.equal(bootstrap.placeholderInContext, false);
      },
    );
    await t.test(
      "native context budgets truncate without changing source files",
      () => {
        assert.ok(receipt.limited.contextChars <= 512);
        assert.ok(receipt.limited.files.some((file) => file.truncated));
        for (const file of receipt.limited.files) {
          assert.equal(
            file.rawSha256,
            receipt.positive.files.find(
              (original) => original.name === file.name,
            )?.rawSha256,
          );
          assert.ok(file.injectedChars <= 128);
        }
        assert.equal(receipt.modelCalls, 0);
        assert.equal(receipt.gatewayStarted, false);
        assert.equal(receipt.modelResponseVerified, false);
        assert.equal(receipt.bootstrapWorkflowCompleted, false);
      },
    );
    await t.test(
      "a repeated output directory is refused without overwriting evidence",
      async () => {
        await assert.rejects(
          run(process.execPath, [script, "--output-dir", output], options),
        );
        assert.equal(await readFile(receiptPath, "utf8"), originalReceipt);
      },
    );
    await t.test(
      "invalid invocation does not create another capture",
      async () => {
        const unused = join(root, "unused");
        await assert.rejects(
          run(
            process.execPath,
            [script, "--output-dir", unused, "--unknown"],
            options,
          ),
        );
        assert.deepEqual((await readdir(root)).sort(), ["capture"]);
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

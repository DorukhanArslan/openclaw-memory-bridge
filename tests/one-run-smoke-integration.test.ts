import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const foundation = fileURLToPath(new URL("../", import.meta.url));

test("ONE RUN INTEGRATION: real branch consumes before dispatch and blocks a fresh lab after uncertain failure", {
  timeout: 30000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "one-run-real-branch-"));
  const isolated = join(root, "foundation");
  try {
    await cp(join(foundation, "src"), join(isolated, "src"), {
      recursive: true,
    });
    await copyFile(
      join(foundation, "package.json"),
      join(isolated, "package.json"),
    );
    // Reuse immutable pinned dependencies. All application state and approval
    // paths come from the copied source's own PROJECT, never the real checkout.
    await symlink(
      join(foundation, "node_modules"),
      join(isolated, "node_modules"),
    );
    const program = `
      import assert from 'node:assert/strict';
      import { existsSync } from 'node:fs';
      import { readFile } from 'node:fs/promises';
      import { join, resolve } from 'node:path';
      import { Lab, PROJECT, ONE_RUN_SMOKE_ADMISSION, ONE_RUN_SMOKE_RESULT }
        from ${JSON.stringify(pathToFileURL(join(isolated, "src/lab.ts")).href)};
      import { SMOKE }
        from ${JSON.stringify(pathToFileURL(join(isolated, "src/paid-smoke.ts")).href)};

      assert.equal(resolve(PROJECT), ${JSON.stringify(resolve(isolated))});
      assert.equal(ONE_RUN_SMOKE_ADMISSION, join(PROJECT, '.lab/one-run-smoke-admission.json'));
      assert.ok(!existsSync(ONE_RUN_SMOKE_ADMISSION));
      const policy = { keyLimit: true, providerLimitUsd: 50, prices: SMOKE.prices };
      let wouldDispatch = 0;
      let admissionAtDispatch;
      const labs = [];
      const nativeUsage = () => ({
        usage: { updatedAt: Date.now(), providers: [{ provider: 'openrouter', billing: [{
          type: 'budget', label: 'API key budget', unit: 'USD',
          limit: 50, used: 0, period: 'weekly',
        }] }] },
      });
      async function prepared(id) {
        const lab = await new Lab(id, join(PROJECT, '.lab-test-isolated')).init();
        labs.push(lab);
        lab.validateConfig = async () => ({ valid: true });
        lab.providerUsage = async () => nativeUsage();
        Reflect.set(lab, 'native', async () => {
          wouldDispatch++;
          assert.ok(existsSync(ONE_RUN_SMOKE_ADMISSION), 'Admission must exist before inference can dispatch.');
          admissionAtDispatch = await readFile(ONE_RUN_SMOKE_ADMISSION, 'utf8');
          const receipt = JSON.parse(admissionAtDispatch);
          assert.equal(receipt.state, 'consumed-before-dispatch');
          assert.equal(receipt.quota.observedPeriod, 'weekly');
          assert.equal(receipt.cumulativeHistoryVerified, false);
          throw new Error('Synthetic uncertain dispatch outcome; no native process was started.');
        });
        return lab;
      }
      try {
        const first = await prepared('first');
        // No fixture argument: exercise the real production admission branch,
        // with fake metadata and the actual native dispatch replaced by a stop.
        await assert.rejects(first.boundedSmoke(policy), /Synthetic uncertain dispatch outcome/);
        assert.equal(wouldDispatch, 1);
        assert.equal(await readFile(ONE_RUN_SMOKE_ADMISSION, 'utf8'), admissionAtDispatch);
        assert.ok(!existsSync(ONE_RUN_SMOKE_RESULT), 'An uncertain failure must not create a success receipt.');

        const second = await prepared('second');
        await assert.rejects(second.boundedSmoke(policy), /existing or uncertain admission/);
        assert.equal(wouldDispatch, 1, 'A fresh lab must not dispatch a second request.');
        assert.equal(await readFile(ONE_RUN_SMOKE_ADMISSION, 'utf8'), admissionAtDispatch);
        console.log(JSON.stringify({ realBranch: true, wouldDispatch, replayBlocked: true, inferenceRequests: 0 }));
      } finally {
        await Promise.all(labs.map(lab => lab.close()));
      }
    `;
    const { stdout } = await execute(
      process.execPath,
      ["--input-type=module", "--eval", program],
      {
        cwd: isolated,
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "en_US.UTF-8",
          OPENROUTER_API_KEY: "synthetic-admission-only-key",
        },
        timeout: 25000,
        maxBuffer: 16384,
      },
    );
    assert.deepEqual(JSON.parse(stdout), {
      realBranch: true,
      wouldDispatch: 1,
      replayBlocked: true,
      inferenceRequests: 0,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

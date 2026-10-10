import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { PROJECT } from "../src/lab.ts";

test("REAL Python consumer → JSONL foundation → native OpenClaw memory", {
  timeout: 360000,
}, async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-"));
  const child = spawn(
    "python3",
    [join(PROJECT, "examples/python_consumer.py"), "--root", root],
    { cwd: PROJECT, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  let errors = "";
  let succeeded = false;
  child.stdout.on("data", (data: Buffer) => {
    output += data.toString();
  });
  child.stderr.on("data", (data: Buffer) => {
    errors += data.toString();
  });
  try {
    const [code] = await once(child, "exit");
    assert.equal(code, 0, errors);
    const result = JSON.parse(output);
    assert.equal(result.engine.name, "openclaw");
    assert.equal(result.provider, "none");
    assert.equal(result.real_engine, true);
    assert.equal(result.checks.length, 7);
    succeeded = true;
  } finally {
    child.kill("SIGTERM");
    if (succeeded) await rm(root, { recursive: true, force: true });
    else console.error(`Native protocol diagnostics retained under ${root}`);
  }
});

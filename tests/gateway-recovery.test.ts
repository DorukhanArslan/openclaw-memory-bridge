import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Lab, PROJECT } from "../src/lab.ts";

test("REAL Gateway: a new read replaces a terminated owned child without changing saved sources", {
  timeout: 120000,
}, async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-gateway-recovery-"));
  const lab = await new Lab("native", root).init();
  try {
    await lab.writeNote(
      "probe",
      "Synthetic Gateway recovery uses cobalt markers.",
    );
    await lab.index();
    const initial = await lab.search("cobalt");
    assert.equal(initial.provider, "none");
    assert.ok(initial.results.some((hit) => hit.path === "memory/probe.md"));
    const before = await readFile(join(lab.notes, "probe.md"));
    const oldChild = Reflect.get(lab, "child") as ChildProcess;
    assert.ok(oldChild.pid);

    const closed = once(oldChild, "close");
    assert.equal(oldChild.kill("SIGTERM"), true);
    await closed;
    assert.ok(oldChild.exitCode !== null || oldChild.signalCode !== null);

    // This is a new caller request after termination. There is no retry or
    // replay of a request whose acknowledgement was lost.
    const recalled = await lab.search("cobalt");
    const replacement = Reflect.get(lab, "child") as ChildProcess;
    assert.notEqual(replacement, oldChild);
    assert.notEqual(replacement.pid, oldChild.pid);
    assert.equal(replacement.exitCode, null);
    assert.equal(recalled.provider, "none");
    assert.ok(recalled.results.some((hit) => hit.path === "memory/probe.md"));
    assert.deepEqual(await readFile(join(lab.notes, "probe.md")), before);
  } finally {
    await lab.close();
    await rm(root, { recursive: true, force: true });
  }
});

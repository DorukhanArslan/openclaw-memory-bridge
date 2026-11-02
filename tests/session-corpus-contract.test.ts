import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Lab, PROJECT } from "../src/lab.ts";

test("REAL OpenClaw: memory recall and owned-session history keep separate source contracts", {
  timeout: 240000,
}, async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-session-contract-"));
  const lab = await new Lab("scope", root).init();
  let succeeded = false;
  try {
    const configured = await lab.configureIngestion(true);
    assert.equal(configured.transcriptSearch, false);
    await lab.writeNote(
      "canonical",
      "Synthetic canonical source: cobalt observatory.",
    );
    const fixture = await lab.injectFixture(
      "owned",
      "Synthetic operator transcript fixture only: papaya rehearsal.",
    );
    assert.equal(fixture.modelExecuted, false);
    await lab.index();
    assert.match(
      JSON.stringify(await lab.sessionHistory("owned")),
      /papaya rehearsal/,
    );
    const memory = await lab.search("cobalt", "owned");
    assert.equal(memory.provider, "none");
    assert.ok(memory.results.some((hit) => hit.path === "memory/canonical.md"));
    assert.equal((await lab.search("papaya", "owned")).results.length, 0);
    assert.match(
      JSON.stringify(await lab.get("memory/canonical.md")),
      /cobalt observatory/,
    );
    await assert.rejects(
      lab.get("sessions/transcript.jsonl"),
      /Read a lab note/,
    );
    succeeded = true;
  } finally {
    await lab.close();
    if (succeeded) await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Lab, PROJECT } from "../src/lab.ts";
import { lifecycleDemo } from "../src/lifecycle-demo.ts";

test("REAL no-model lifecycle: native transcript fixture → reset hook → recall → restart", {
  timeout: 300000,
}, async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-"));
  try {
    const result = await lifecycleDemo(root, "lifecycle");
    assert.equal(result.fixture.modelExecuted, false);
    assert.equal(result.state.nativeMaintenance.memoryFlush, null);
    assert.equal(result.state.nativeMaintenance.compactionCount, 0);
    assert.match(result.captured.content, /Session ID/);
    assert.match(result.captured.content, /gateway:sessions.reset/);
    assert.match(result.captured.content, /indigo/);
    assert.ok(
      result.recalled.results.some(
        (hit) => hit.path === result.captured.captured,
      ),
    );
    assert.ok(
      result.persisted.results.some(
        (hit) => hit.path === result.captured.captured,
      ),
    );
    assert.match(JSON.stringify(result.source), /indigo/);

    const beta = await new Lab("other", root).init();
    try {
      await beta.index();
      assert.equal((await beta.search("indigo")).results.length, 0);
      await assert.rejects(
        beta.chat("test", "synthetic text"),
        /Select a local text model/,
      );
      await assert.rejects(beta.configureFlush("test"), /First select/);
      await beta.configureTextModel(
        "http://127.0.0.1:11434/v1",
        "synthetic-unavailable-model",
      );
      await beta.configureFlush("test");
      await beta.configureIngestion(true);
      // Native index validates the actual pinned schema without contacting a text model.
      await beta.index();
      const config = JSON.parse(await readFile(beta.config, "utf8"));
      assert.equal(
        config.agents.defaults.compaction.memoryFlush.model,
        "lab/synthetic-unavailable-model",
      );
      assert.equal(
        config.agents.defaults.compaction.memoryFlush.forceFlushTranscriptBytes,
        1024,
      );
      assert.equal(
        config.hooks.internal.entries["session-memory"].llmSlug,
        false,
      );
      assert.deepEqual(config.gateway.tools.deny, ["read", "write", "edit"]);
      assert.equal(config.tools.fs.workspaceOnly, true);
      await beta.configureKeyword();
      assert.equal(
        JSON.parse(await readFile(beta.config, "utf8")).hooks.internal.enabled,
        true,
      );
    } finally {
      await beta.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

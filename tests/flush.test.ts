import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Lab, PROJECT } from "../src/lab.ts";
import { modelGate, selectTextModel } from "./model-selection.ts";

test("REAL optional selected model: agentic memory flush, compaction, reset capture and recall", {
  skip: modelGate("text", process.env),
  timeout: 600000,
}, async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-"));
  const lab = await new Lab("flush", root).init();
  try {
    await selectTextModel(lab);
    await lab.configureIngestion(true);
    await lab.configureFlush("test");
    const syntheticContext = Array.from(
      { length: 18 },
      (_, i) =>
        `Synthetic context item ${i + 1}: Project Borealis is an imaginary observatory rehearsal used only for this lab.`,
    ).join("\n");
    await lab.chat(
      "conversation",
      `My durable standing preference for synthetic Project Borealis is to use indigo filters every Thursday. Remember that preference for future sessions. Here is synthetic context:\n${syntheticContext}\nAcknowledge briefly.`,
    );
    // A second admitted actual turn guarantees a nonempty >1 KiB transcript for the native byte guard.
    const completed = await lab.chat(
      "conversation",
      "Confirm my standing indigo filter preference without changing it.",
    );
    const state = JSON.stringify(completed.state);
    assert.match(state, /"memoryFlush"/);
    assert.match(state, /"kind":"succeeded"/);
    const day = new Date().toISOString().slice(0, 10);
    const note = await lab.get(`memory/${day}.md`, 1, 200);
    assert.match(
      JSON.stringify(note),
      /indigo/i,
      "A succeeded metadata marker alone does not prove durable extraction.",
    );
    const compact = await lab.compactSession("conversation", true);
    assert.match(
      JSON.stringify(compact.native),
      /"compacted":true/,
      "Native summarizing compaction must actually commit.",
    );
    const capture = await lab.resetSession("conversation");
    assert.match(capture.content, /Session ID/);
    await lab.index();
    assert.ok((await lab.search("indigo")).results.length > 0);
    await lab.restart();
    assert.ok((await lab.search("indigo", "after-restart")).results.length > 0);
  } finally {
    await lab.close();
    await rm(root, { recursive: true, force: true });
  }
});

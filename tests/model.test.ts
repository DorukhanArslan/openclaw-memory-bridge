import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { DAILY_FIXTURE } from "../src/dream-demo.ts";
import { Lab, PROJECT } from "../src/lab.ts";

test("REAL optional local text model: native dreaming narrative", {
  skip:
    !process.env.LAB_MODEL_URL || !process.env.LAB_MODEL_NAME
      ? "Set LAB_MODEL_URL and LAB_MODEL_NAME for an explicitly selected local text model."
      : false,
  timeout: 600000,
}, async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-"));
  const lab = await new Lab("model", root).init();
  try {
    await lab.configureTextModel(
      process.env.LAB_MODEL_URL ?? "",
      process.env.LAB_MODEL_NAME ?? "",
    );
    await lab.writeDaily(new Date().toISOString().slice(0, 10), DAILY_FIXTURE);
    await lab.index();
    await lab.remStage();
    const before = (await lab.dreamDiary()) as { content: string };
    await lab.dreamRun();
    let after = (await lab.dreamDiary()) as { content: string };
    for (
      let attempt = 0;
      attempt < 4 && after.content === before.content;
      attempt++
    ) {
      await delay(2000);
      after = (await lab.dreamDiary()) as { content: string };
    }
    assert.notEqual(
      after.content,
      before.content,
      "The sweep must add actual narrative output beyond grounded replay.",
    );
    const diary = after.content;
    assert.match(diary, /Aurora|cobalt/);
    assert.doesNotMatch(
      diary,
      /subagent runtime is unavailable|No API key|model unavailable|fallback narrative|A memory trace surfaced, but details were unavailable/i,
    );
  } finally {
    await lab.close();
    await rm(root, { recursive: true, force: true });
  }
});

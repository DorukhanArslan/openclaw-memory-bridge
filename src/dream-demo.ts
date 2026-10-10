import { join } from "node:path";
import { Lab, PROJECT } from "./lab.ts";

export const DAILY_FIXTURE =
  "# Synthetic daily journal\n\n## Preferences and standing rules\n- Standing rule: always use the cobalt telescope for Project Aurora rehearsals.\n- Standing rule: rehearsals happen every Tuesday afternoon.\n- Zephyr prefers bicycle travel to the observatory.\n";

/** Everything here delegates to pinned OpenClaw CLI/RPC. No fabricated phase state. */
export async function dreamDemo(
  root = join(PROJECT, ".lab"),
  name = "dream-demo",
) {
  let lab = await new Lab(name, root).init();
  try {
    const day = new Date().toISOString().slice(0, 10);
    await lab.writeDaily(day, DAILY_FIXTURE);
    await lab.index();
    const before = {
      memory: await lab.get("MEMORY.md"),
      status: await lab.dreamStatus(),
    };
    const remPreview = await lab.remPreview();
    const staged = await lab.remStage();
    const explanationBefore = await lab.explain("cobalt");
    const defaultPromotionPreview = await lab.promote();
    const sweep = await lab.dreamRun();
    const phaseStatus = await lab.dreamStatus();
    const diary = await lab.dreamDiary();
    // Explicit test-only flags make promotion repeatable for a tiny synthetic fixture.
    // This native manual append path does not prove model-backed merges/supersessions.
    const manualPromotion = await lab.promote(true, true);
    await lab.index();
    const durableMemory = await lab.get("MEMORY.md", 1, 200);
    const explanationAfter = await lab.explain("cobalt");
    await lab.close();
    lab = await new Lab(name, root).init();
    const persistedRecall = await lab.search("cobalt", "later-session");
    return {
      runtime: "OpenClaw 2026.9.9 — real CLI/RPC, no mocks",
      before,
      remPreview,
      staged,
      explanationBefore,
      defaultPromotionPreview,
      sweep,
      phaseStatus,
      diary,
      manualPromotion,
      durableMemory,
      explanationAfter,
      persistedRecall,
      limitations: [
        "promote-test explicitly overrides native score/count thresholds for this tiny fixture.",
        "Model-backed Dream Diary and consolidation decisions require a configured local text model; inspect native degraded/error/fallback traces.",
        "The grounded REM harness/backfill is deterministic replay; it is separate from the full native sweep.",
        "This scenario checks file-memory persistence; it does not execute chat extraction or compaction flush. Separate model-gated lifecycle controls/tests cover those paths.",
      ],
    };
  } finally {
    await lab.close();
  }
}

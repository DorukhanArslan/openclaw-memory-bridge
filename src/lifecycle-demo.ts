import { join } from "node:path";
import { Lab, PROJECT } from "./lab.ts";

export const CONVERSATION_FIXTURE =
  "Synthetic operator transcript fixture: Zephyr's standing preference is to use indigo telescope filters for Project Borealis every Thursday. This is fixture text, not a model-generated reply.";

/** A real native session-memory hook demonstration with no model completion. */
export async function lifecycleDemo(
  root = join(PROJECT, ".lab"),
  name = "lifecycle-demo",
) {
  let lab = await new Lab(name, root).init();
  try {
    const ingestion = await lab.configureIngestion(true);
    const fixture = await lab.injectFixture(
      "conversation",
      CONVERSATION_FIXTURE,
    );
    const history = await lab.sessionHistory("conversation");
    const state = await lab.sessionState("conversation");
    const captured = await lab.resetSession("conversation");
    const recalled = await lab.search("indigo");
    const source = await lab.get(captured.captured, 1, 200);
    await lab.close();
    lab = await new Lab(name, root).init();
    const persisted = await lab.search("indigo", "later-session");
    return {
      ingestion,
      fixture,
      history,
      state,
      captured,
      recalled,
      source,
      persisted,
      limitations: [
        "The transcript is an explicitly injected synthetic operator fixture. No text model was executed.",
        "The native hook saved filtered conversation excerpts; this is not model-based durable fact extraction.",
        "Actual chat.send, model-backed extraction/flush, and summarizing compaction require a selected tool-capable text model.",
      ],
    };
  } finally {
    await lab.close();
  }
}

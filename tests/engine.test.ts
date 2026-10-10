import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Lab, PROJECT } from "../src/lab.ts";

test("REAL OpenClaw: write, keyword recall, sources, update, deletion, persistence and workspace separation", {
  timeout: 300000,
}, async (t) => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-"));
  let alpha = await new Lab("alpha", root).init();
  const beta = await new Lab("beta", root).init();
  try {
    await t.test("write-to-recall and no-key keyword engine", async () => {
      await alpha.writeNote(
        "observatory",
        "# Synthetic observatory\nAurora stores cobalt telescopes. The rehearsal is Tuesday at 14:00 UTC.",
      );
      await alpha.index();
      const result = await alpha.search("cobalt", "session-one");
      assert.equal(result.provider, "none");
      assert.ok(
        result.results.some(
          (hit) =>
            hit.path === "memory/observatory.md" &&
            hit.snippet.includes("cobalt"),
        ),
      );
      assert.ok(
        result.results.every(
          (hit) => Number.isFinite(hit.score) && hit.startLine >= 1,
        ),
      );
    });
    await t.test("memory_get reads actual source lines", async () => {
      const source = (await alpha.get("memory/observatory.md", 2, 1)) as {
        text: string;
        path: string;
      };
      assert.equal(source.path, "memory/observatory.md");
      assert.match(source.text, /Tuesday at 14:00/);
    });
    await t.test(
      "session keys and actual Gateway restart retain recall",
      async () => {
        assert.ok(
          (await alpha.search("cobalt", "session-two")).results.length > 0,
        );
        await alpha.restart();
        assert.ok(
          (await alpha.search("cobalt", "session-three")).results.some(
            (hit) => hit.path === "memory/observatory.md",
          ),
        );
      },
    );
    await t.test(
      "a new host process object reuses persistent native state",
      async () => {
        await alpha.close();
        alpha = await new Lab("alpha", root).init();
        const status = JSON.stringify(await alpha.status());
        assert.match(status, /"chunks":[1-9]/);
        assert.ok(
          (await alpha.search("cobalt")).results.some(
            (hit) => hit.path === "memory/observatory.md",
          ),
        );
      },
    );
    await t.test(
      "same note ID in independent test workspaces has separate recall",
      async () => {
        await beta.writeNote(
          "observatory",
          "# Synthetic greenhouse\nZephyr grows saffron orchids.",
        );
        await beta.index();
        assert.equal((await beta.search("cobalt")).results.length, 0);
        assert.ok((await beta.search("saffron")).results.length > 0);
        assert.equal((await alpha.search("saffron")).results.length, 0);
      },
    );
    await t.test(
      "updating Markdown plus native rebuild removes old content",
      async () => {
        await alpha.writeNote(
          "observatory",
          "# Synthetic observatory\nAurora stores vermilion telescopes. The rehearsal is Friday at 16:00 UTC.",
        );
        await alpha.index();
        assert.equal((await alpha.search("cobalt")).results.length, 0);
        assert.ok((await alpha.search("vermilion")).results.length > 0);
        assert.match(
          JSON.stringify(await alpha.get("memory/observatory.md")),
          /Friday at 16:00/,
        );
      },
    );
    await t.test(
      "deleting Markdown plus native rebuild removes recall",
      async () => {
        await alpha.deleteNote("observatory");
        await alpha.index();
        assert.equal((await alpha.search("vermilion")).results.length, 0);
        assert.ok((await beta.search("saffron")).results.length > 0);
      },
    );
  } finally {
    await alpha.close();
    await beta.close();
    await rm(root, { recursive: true, force: true });
  }
});

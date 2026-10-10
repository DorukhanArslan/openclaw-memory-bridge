import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Lab, PROJECT } from "../src/lab.ts";

test("REAL optional local embeddings: semantic recall without shared query words", {
  skip:
    !process.env.LAB_VECTOR_URL || !process.env.LAB_VECTOR_MODEL
      ? "Set LAB_VECTOR_URL and LAB_VECTOR_MODEL for an explicitly selected local embeddings server."
      : false,
  timeout: 300000,
}, async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-"));
  const lab = await new Lab("vector", root).init();
  try {
    await lab.writeNote(
      "resident",
      "# Synthetic resident\nZephyr travels to the office by bicycle.",
    );
    await lab.index();
    assert.equal(
      (await lab.search("pedal-powered commuting")).results.length,
      0,
      "The keyword baseline must have no hits before optional embeddings are enabled.",
    );
    await lab.configureVector(
      process.env.LAB_VECTOR_URL ?? "",
      process.env.LAB_VECTOR_MODEL ?? "",
    );
    const result = await lab.search("pedal-powered commuting");
    assert.equal(result.provider, "openai-compatible");
    assert.ok(result.results.some((hit) => hit.path === "memory/resident.md"));
    await lab.restart();
    assert.ok((await lab.search("pedal-powered commuting")).results.length > 0);
  } finally {
    await lab.close();
    await rm(root, { recursive: true, force: true });
  }
});

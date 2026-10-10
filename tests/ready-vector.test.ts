import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { ReadyGateway } from "../src/gateway.ts";
import { Lab, PROJECT } from "../src/lab.ts";

test("REAL optional local embeddings: ready client semantic recall", {
  skip:
    !process.env.LAB_VECTOR_URL || !process.env.LAB_VECTOR_MODEL
      ? "Select LAB_VECTOR_URL and LAB_VECTOR_MODEL for a genuine local embedding service."
      : false,
  timeout: 300000,
}, async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-"));
  const owner = await new Lab("ready-vector", root).init();
  let client: ReadyGateway | undefined;
  try {
    await owner.writeNote(
      "resident",
      "Synthetic Zephyr travels to the office by bicycle.",
    );
    await owner.index();
    await owner.start();
    client = owner.attachMemoryClient();
    assert.equal(
      (await client.search("pedal-powered commuting")).results.length,
      0,
    );
    client.close();
    await owner.configureVector(
      process.env.LAB_VECTOR_URL ?? "",
      process.env.LAB_VECTOR_MODEL ?? "",
    );
    await owner.start();
    client = owner.attachMemoryClient();
    const result = await client.search("pedal-powered commuting");
    assert.equal(result.provider, "openai-compatible");
    assert.ok(result.results.some((hit) => hit.path === "memory/resident.md"));
    assert.match((await client.get("memory/resident.md")).text, /bicycle/);
  } finally {
    client?.close();
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
});

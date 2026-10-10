import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { GatewayError, type ReadyGateway } from "../src/gateway.ts";
import { Lab, PROJECT } from "../src/lab.ts";

test("REAL ready Gateway: native recall, sources, borrowed ownership and connection loss", {
  timeout: 240000,
}, async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-"));
  const owner = await new Lab("ready", root).init();
  let client: ReadyGateway | undefined;
  let succeeded = false;
  try {
    assert.throws(() => owner.attachMemoryClient(), /owner must start/);
    await owner.writeNote(
      "observatory",
      "Synthetic Aurora uses cobalt telescopes every Tuesday.",
    );
    await owner.index();
    const startup = performance.now();
    await owner.start();
    const ownerStartupMs = performance.now() - startup;
    client = owner.attachMemoryClient();
    const first = performance.now();
    const recall = await client.search("cobalt");
    const firstRequestMs = performance.now() - first;
    assert.equal(recall.provider, "none");
    assert.equal(recall.results[0]?.path, "memory/observatory.md");
    assert.ok(recall.results[0]?.score && recall.results[0].score > 0);
    assert.match((await client.get("memory/observatory.md")).text, /cobalt/);
    await assert.rejects(
      client.get("memory/missing.md"),
      (error: unknown) =>
        error instanceof GatewayError && error.code === "not_found",
    );
    const warmMs = [];
    for (let i = 0; i < 5; i++) {
      const before = performance.now();
      assert.ok((await client.search("cobalt")).results.length);
      warmMs.push(performance.now() - before);
    }
    client.close();
    client = owner.attachMemoryClient();
    assert.ok(
      (await client.search("cobalt")).results.length,
      "Closing a borrower must leave the same caller-owned Gateway available.",
    );
    await owner.stop();
    await assert.rejects(
      client.search("cobalt"),
      (error: unknown) =>
        error instanceof GatewayError && error.code === "connection_failed",
    );
    client.close();
    // Only the fixture owner starts a replacement. The client cannot respawn it.
    await owner.start();
    client = owner.attachMemoryClient();
    assert.ok((await client.search("cobalt")).results.length);
    console.info(
      "READY_GATEWAY_MEASUREMENTS",
      JSON.stringify({
        ownerStartupMs,
        firstRequestMs,
        warmMs,
        provider: recall.provider,
        gatewayAliveAfterClientClose: true,
        connectionLossWasError: true,
      }),
    );
    succeeded = true;
  } finally {
    client?.close();
    await owner.close();
    if (succeeded) await rm(root, { recursive: true, force: true });
    else
      console.error(`Native ready-Gateway diagnostics retained under ${root}`);
  }
});

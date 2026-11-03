import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Lab, PROJECT } from "../src/lab.ts";

test("CONFIG: native chat binds one process-local bounded model and native memory lifecycle", async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-native-chat-config-"));
  const lab = await new Lab("chat", root).init();
  try {
    for (const url of [
      "https://example.com/v1",
      "http://example.com/v1",
      "http://user:password@127.0.0.1/v1",
      "http://127.0.0.1/v1?key=x",
    ])
      await assert.rejects(lab.configureChat(url), /127\.0\.0\.1/);
    const result = await lab.configureChat("http://127.0.0.1:9917/v1");
    assert.equal(result.processLocal, true);
    const config = JSON.parse(await readFile(lab.config, "utf8"));
    assert.equal(
      config.models.providers.openrouter.baseUrl,
      "http://127.0.0.1:9917/v1",
    );
    assert.equal(config.models.providers.openrouter.models[0].maxTokens, 512);
    assert.equal(
      config.models.providers.openrouter.models[0].compat.thinkingFormat,
      "openrouter",
    );
    assert.equal(config.agents.defaults.params.maxTokens, 512);
    assert.equal(config.agents.defaults.timeoutSeconds, 60);
    assert.deepEqual(config.agents.defaults.model.fallbacks, []);
    assert.equal(config.agents.defaults.compaction.memoryFlush.enabled, true);
    assert.deepEqual(config.memory.search.sources, ["memory", "sessions"]);
    assert.equal(config.memory.search.provider, "none");
    assert.equal(config.memory.search.rememberAcrossConversations, true);
    assert.equal(config.plugins.entries["active-memory"].enabled, true);
    assert.equal(
      config.plugins.entries["memory-core"].config.dreaming.enabled,
      false,
    );
    assert.equal(config.hooks.internal.entries["session-memory"].enabled, true);
    assert.equal(config.cron.enabled, false);
    for (const tool of [
      "memory_search",
      "memory_get",
      "sessions_search",
      "sessions_history",
      "read",
      "write",
      "edit",
    ])
      assert.ok(config.tools.allow.includes(tool));
    const env = Reflect.get(lab, "env").call(lab);
    assert.equal(env.OPENROUTER_API_KEY, undefined);
    assert.equal(env.OPENCLAW_LAB_LIFECYCLE_LEDGER, undefined);
    assert.equal(env.BRIDGE_ONE_USER_LEDGER, undefined);
    assert.equal(env.BRIDGE_ONE_USER_FOLLOWUP_LEDGER, undefined);
    await lab.stop();
    await Reflect.get(lab, "provision").call(lab);
    assert.equal(
      JSON.parse(await readFile(lab.config, "utf8")).models.providers.openrouter
        .baseUrl,
      "http://127.0.0.1:9917/v1",
    );
    await assert.rejects(readFile(join(lab.directory, "settings.json")), {
      code: "ENOENT",
    });
  } finally {
    await lab.close();
  }
  const reopened = await new Lab("chat", root).init();
  try {
    const config = JSON.parse(await readFile(reopened.config, "utf8"));
    assert.equal(config.models, undefined);
    assert.equal(config.memory.search.rememberAcrossConversations, false);
    assert.equal(config.hooks.internal.enabled, false);
  } finally {
    await reopened.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("PROTOCOL FIXTURE: native chat preserves explicit session identity and returns actual RPC receipts", async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-native-chat-receipts-"));
  const lab = await new Lab("chat", root).init();
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let waits = 0;
  try {
    await lab.configureChat("http://127.0.0.1:9917/v1");
    Reflect.set(
      lab,
      "rpc",
      async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        switch (method) {
          case "sessions.create":
            return {
              sessionId: "fixture-session",
              entry: { compactionCount: 0 },
            };
          case "chat.send":
            return { runId: "fixture-run", status: "started" };
          case "agent.wait":
            return { status: waits++ === 0 ? "pending" : "ok" };
          case "chat.history":
            return {
              messages: [
                {
                  role: "assistant",
                  content: "Labelled protocol fixture; not generated text.",
                },
              ],
            };
          case "sessions.describe":
            return { session: { sessionId: "fixture-session" } };
          default:
            throw new Error(`Unexpected fixture RPC: ${method}`);
        }
      },
    );
    await assert.rejects(lab.chat("one", "x".repeat(8001)), /8000 UTF-8 bytes/);
    assert.equal(calls.length, 0);
    const receipt = await lab.chat(
      "one",
      "A fictional project uses cobalt markers.",
    );
    assert.equal(receipt.accepted.runId, "fixture-run");
    assert.equal(receipt.completion.status, "ok");
    assert.deepEqual(receipt.history, {
      messages: [
        {
          role: "assistant",
          content: "Labelled protocol fixture; not generated text.",
        },
      ],
    });
    assert.equal(calls.filter((call) => call.method === "chat.send").length, 1);
    const send = calls.find((call) => call.method === "chat.send");
    assert.equal(send?.params.sessionKey, "agent:main:explicit:one");
    assert.equal(send?.params.timeoutMs, 60000);
    assert.equal(send?.params.deliver, false);
    assert.equal(typeof send?.params.idempotencyKey, "string");
    for (const call of calls.filter(
      (call) => call.method === "sessions.create",
    )) {
      assert.equal(call.params.key, "agent:main:explicit:one");
      assert.equal(call.params.parentSessionKey, undefined);
      assert.equal(call.params.emitCommandHooks, undefined);
    }
    calls.length = 0;
    await lab.chat("two", "What did I say about the project?");
    assert.equal(
      calls.find((call) => call.method === "chat.send")?.params.sessionKey,
      "agent:main:explicit:two",
    );
    Reflect.set(
      lab,
      "rpc",
      async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        return { aborted: true, runIds: [params.runId] };
      },
    );
    await assert.rejects(lab.abortChat("two", ""), /exact native run ID/);
    const aborted = await lab.abortChat("two", "fixture-exact-run");
    assert.deepEqual(aborted, { aborted: true, runIds: ["fixture-exact-run"] });
    assert.deepEqual(calls.at(-1), {
      method: "chat.abort",
      params: {
        sessionKey: "agent:main:explicit:two",
        agentId: "main",
        runId: "fixture-exact-run",
      },
    });
  } finally {
    await lab.close();
    await rm(root, { recursive: true, force: true });
  }
});

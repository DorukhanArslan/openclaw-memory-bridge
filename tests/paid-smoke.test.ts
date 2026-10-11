import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { Lab, PROJECT } from "../src/lab.ts";
import {
  confirmSmoke,
  inputTokenUpperBound,
  SMOKE,
  type SmokeConfirmations,
  SmokeUnavailable,
  smokeBudget,
  verifySmokeRuntime,
} from "../src/paid-smoke.ts";

const confirmation: SmokeConfirmations = {
  keyLimit: true,
  resetDisabled: true,
  exclusiveKey: true,
  prices: SMOKE.prices,
};
const status = () => ({
  usage: {
    updatedAt: Date.now(),
    providers: [
      {
        provider: "openrouter",
        billing: [
          {
            type: "budget",
            label: "API key budget",
            unit: "USD",
            limit: 5,
            used: 0,
          },
        ],
      },
    ],
  },
});

test("SMOKE POLICY: absent/manual price confirmations and bad native budgets fail closed", async () => {
  for (const key of ["keyLimit", "resetDisabled", "exclusiveKey"] as const)
    assert.throws(
      () => confirmSmoke({ ...confirmation, [key]: false }),
      /Confirm/,
    );
  for (const prices of ["", "2,10,0,0.02", "2,10,2.5,0.03"])
    assert.throws(() => confirmSmoke({ ...confirmation, prices }), /price/);
  assert.throws(() => smokeBudget({}, confirmation), /usage_missing/);
  const low = status();
  const first = low.usage.providers[0]?.billing[0];
  assert.ok(first);
  first.used = 4.01;
  assert.throws(() => smokeBudget(low, confirmation), /insufficient_headroom/);
  assert.equal(smokeBudget(status(), confirmation).remainingUsd, 5);
  const fifty = status();
  const fiftyBudget = fifty.usage.providers[0]?.billing[0];
  assert.ok(fiftyBudget);
  fiftyBudget.limit = 50;
  fiftyBudget.used = 49;
  assert.deepEqual(
    smokeBudget(fifty, { ...confirmation, providerLimitUsd: 50 }),
    { limitUsd: 50, usedUsd: 49, remainingUsd: 1 },
  );
  assert.throws(() => smokeBudget(fifty, confirmation), /wrong_key_limit/);
  assert.ok(SMOKE.estimatedUsd < 5);
  assert.ok((await verifySmokeRuntime()).inputUpperBound <= 1024);
  assert.throws(
    () => inputTokenUpperBound([{ content: "non ASCII: ü" }]),
    /ASCII/,
  );
});

test("SMOKE POLICY: real mode denies before credential handoff, validation or native quota probe", async () => {
  const lab = new Lab("denied");
  let calls = 0;
  lab.validateConfig = async () => {
    calls++;
    return {};
  };
  lab.providerUsage = async () => {
    calls++;
    return status();
  };
  await assert.rejects(
    lab.boundedSmoke(confirmation),
    (error: unknown) =>
      error instanceof SmokeUnavailable &&
      error.code === "native_price_routing_unverified",
  );
  assert.equal(calls, 0);
  await assert.rejects(
    lab.boundedSmoke({ ...confirmation, exclusiveKey: false }),
    /Confirm/,
  );
  assert.equal(calls, 0);
});

type SmokeConfig = {
  cron: { enabled: boolean };
  hooks: { internal: { enabled: boolean } };
  agents: {
    defaults: {
      heartbeat: { every: string };
      compaction: { memoryFlush: { enabled: boolean } };
      model: { fallbacks: string[] };
    };
  };
  plugins: {
    entries: { "memory-core": { config: { dreaming: { enabled: boolean } } } };
  };
};
type Mode =
  | "success"
  | "chat429"
  | "chat503"
  | "chatstall"
  | "index503"
  | "query429";
async function withFixture(
  mode: Mode,
  check: (context: {
    lab: Lab;
    run: () => ReturnType<Lab["boundedSmoke"]>;
    requests: Array<{
      path: string;
      body: Record<string, unknown>;
      started: number;
      closed?: number;
    }>;
    config: () => SmokeConfig | undefined;
  }) => Promise<void>,
) {
  const requests: Array<{
    path: string;
    body: Record<string, unknown>;
    started: number;
    closed?: number;
  }> = [];
  let config: SmokeConfig | undefined;
  let lab: Lab;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    const request = {
      path: req.url ?? "",
      body,
      started: Date.now(),
      closed: undefined as number | undefined,
    };
    requests.push(request);
    res.on("close", () => {
      request.closed = Date.now();
    });
    if (req.url?.endsWith("/chat/completions")) {
      config = JSON.parse(await readFile(lab.config, "utf8"));
      if (mode === "chat429" || mode === "chat503") {
        res.writeHead(mode === "chat429" ? 429 : 503, {
          "content-type": "application/json",
          "retry-after": "0",
        });
        res.end('{"error":{"message":"synthetic failure"}}');
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (mode === "chatstall") {
        res.write(": synthetic stall\n\n");
        return;
      }
      res.write(
        `data: ${JSON.stringify({ id: "synthetic", object: "chat.completion.chunk", model: "openai/gpt-6-sol", choices: [{ index: 0, delta: { role: "assistant", content: '{"ok":true}' }, finish_reason: null }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({ id: "synthetic", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    } else if (req.url?.endsWith("/embeddings")) {
      const inputs =
        typeof body.input === "string"
          ? [body.input]
          : (body.input as string[]);
      if (
        mode === "index503" ||
        (mode === "query429" && inputs.includes(SMOKE.query))
      ) {
        const statusCode = mode === "index503" ? 503 : 429;
        res.writeHead(statusCode, {
          "content-type": "application/json",
          "retry-after": "0",
        });
        res.end(
          JSON.stringify({
            error: { message: `synthetic ${statusCode} failure` },
          }),
        );
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          data: inputs.map((_, index) => ({ index, embedding: [1, 0, 0] })),
          model: "openai/text-embedding-3-small",
          usage: { prompt_tokens: 20, total_tokens: 20 },
        }),
      );
    } else
      res.writeHead(400).end('{"error":{"message":"Unexpected fixture path"}}');
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  process.env.SYNTHETIC_SMOKE_KEY = "synthetic-smoke-placeholder";
  const root = await mkdtemp(join(PROJECT, ".lab-test-"));
  lab = await new Lab("smoke", root).init();
  try {
    await check({
      lab,
      requests,
      config: () => config,
      run: () =>
        lab.boundedSmoke(confirmation, {
          url: `http://127.0.0.1:${address.port}/api/v1`,
          status: status(),
        }),
    });
  } finally {
    await lab.close();
    delete process.env.SYNTHETIC_SMOKE_KEY;
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  }
}

test("NATIVE MOCK SMOKE: fixed completion bounds, one index/query, zero embedding readiness; general gate stays closed", {
  timeout: 120000,
}, async () => {
  await withFixture("success", async ({ lab, requests, run, config }) => {
    const result = await run();
    assert.equal(result.mode, "native-runtime/mock-provider");
    assert.equal(result.estimateIsHardCap, false);
    const chat = requests.filter((r) => r.path.endsWith("/chat/completions"));
    assert.equal(chat.length, 1);
    assert.equal(chat[0]?.body.model, "openai/gpt-6-sol");
    assert.equal(chat[0]?.body.max_completion_tokens, 128);
    assert.equal(chat[0]?.body.max_tokens, undefined);
    assert.equal(
      chat[0]?.body.provider,
      undefined,
      "Native isolated route drops price routing; real mode stays closed.",
    );
    assert.equal(result.nativePriceRoutingVerified, false);
    assert.deepEqual(chat[0]?.body.reasoning, { effort: "none" });
    assert.ok(
      inputTokenUpperBound(
        chat[0]?.body.messages as Array<{ content: string }>,
      ) <= 1024,
    );
    assert.equal(chat[0]?.body.tools, undefined);
    const embeds = requests.filter((r) => r.path.endsWith("/embeddings"));
    assert.equal(
      embeds.length,
      2,
      "Exactly document plus query; no readiness/background embedding.",
    );
    assert.ok(
      embeds.every((r) => r.body.model === "openai/text-embedding-3-small"),
    );
    assert.deepEqual(
      embeds.map((r) => r.body.input),
      [[SMOKE.note], [SMOKE.query]],
    );
    const active = config();
    assert.ok(active);
    assert.equal(active.cron.enabled, false);
    assert.equal(active.hooks.internal.enabled, false);
    assert.equal(active.agents.defaults.heartbeat.every, "0m");
    assert.equal(active.agents.defaults.compaction.memoryFlush.enabled, false);
    assert.deepEqual(active.agents.defaults.model.fallbacks, []);
    assert.equal(
      active.plugins.entries["memory-core"].config.dreaming.enabled,
      false,
    );
    const reset = JSON.parse(await readFile(lab.config, "utf8"));
    assert.equal(
      reset.plugins.entries["llm-task"],
      undefined,
      "Smoke permission is not persisted.",
    );
    await lab.configureNativeModel(
      "openrouter/openai/gpt-6-sol",
      "SYNTHETIC_SMOKE_KEY",
    );
    await assert.rejects(lab.start(), /Paid Gateway/);
    await assert.rejects(lab.index(), /Paid native/);
  });
});

for (const mode of ["chat429", "chat503", "chatstall"] as const) {
  test(`NATIVE MOCK SMOKE: ${mode} terminates one completion without hidden retry or query`, {
    timeout: 120000,
  }, async () => {
    await withFixture(mode, async ({ run, requests }) => {
      await assert.rejects(run());
      const chat = requests.filter((r) => r.path.endsWith("/chat/completions"));
      assert.equal(chat.length, 1);
      assert.equal(
        requests.filter((r) => r.path.endsWith("/embeddings")).length,
        1,
      );
      if (mode === "chatstall") {
        assert.ok(chat[0]?.closed);
        assert.ok(chat[0].closed - chat[0].started >= 14000);
        assert.ok(
          chat[0].closed - chat[0].started < 25000,
          "Native 15s abort has bounded scheduler tolerance.",
        );
      }
    });
  });
}
for (const mode of ["index503", "query429"] as const) {
  test(`NATIVE MOCK SMOKE: ${mode} respects native three-attempt budget and stops without wrapper retry`, {
    timeout: 120000,
  }, async () => {
    await withFixture(mode, async ({ run, requests }) => {
      await assert.rejects(run());
      const embeddings = requests.filter((r) => r.path.endsWith("/embeddings"));
      assert.equal(embeddings.length, mode === "index503" ? 3 : 4);
      assert.equal(
        requests.filter((r) => r.path.endsWith("/chat/completions")).length,
        mode === "index503" ? 0 : 1,
      );
    });
  });
}

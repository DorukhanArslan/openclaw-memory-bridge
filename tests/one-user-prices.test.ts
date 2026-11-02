import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inspectOneUserPrices,
  type OneUserPriceFetcher,
  verifyOneUserPrices,
} from "../src/one-user-prices.ts";

function metadata() {
  return {
    text: {
      data: [
        { id: "unrelated/model", pricing: { prompt: "999" } },
        {
          id: "openai/gpt-6-sol",
          pricing: {
            prompt: "0.000002",
            completion: "0.00001",
            input_cache_write: "0.0000025",
            input_cache_read: "0.0000002",
            web_search: "0.01",
            overrides: [
              {
                min_prompt_tokens: 272000,
                prompt: "0.000004",
                completion: "0.000015",
                input_cache_write: "0.000005",
                input_cache_read: "0.0000004",
              },
            ],
          },
        },
      ],
    },
    embedding: {
      data: [
        {
          id: "openai/text-embedding-3-small",
          pricing: { prompt: "0.00000002", completion: "0" },
        },
      ],
    },
  };
}

function textPricing(input: ReturnType<typeof metadata>) {
  return input.text.data[1]?.pricing as Record<string, unknown>;
}

test("ONE USER PRICES: all advertised tiers fit without claiming actual routing", () => {
  const input = metadata();
  const before = JSON.stringify(input);
  const result = inspectOneUserPrices(input.text, input.embedding);
  assert.deepEqual(result.advertisedTierCount, { text: 2, embedding: 1 });
  assert.deepEqual(result.observedMaximaUsdPerMillion, {
    inputIncludingCacheWriteOrRead: 9,
    output: 15,
    embeddingInputIncludingCache: 0.02,
  });
  assert.equal(result.chatModel, "openai/gpt-6-sol");
  assert.equal(result.embeddingModel, "openai/text-embedding-3-small");
  assert.equal(result.publishedPriceSnapshotVerified, true);
  assert.equal(result.nativePriceRoutingVerified, false);
  assert.equal(result.estimateIsHardCap, false);
  assert.equal(JSON.stringify(input), before);
});

test("ONE USER PRICES: exact boundary and inherited tier rates are checked", () => {
  const input = metadata();
  const price = textPricing(input);
  price.prompt = "4e-6";
  price.input_cache_write = "5e-6";
  price.completion = "2e-5";
  price.overrides = [{ min_prompt_tokens: 272000 }];
  assert.equal(
    inspectOneUserPrices(input.text, input.embedding)
      .observedMaximaUsdPerMillion.output,
    20,
  );
  price.overrides = [
    { min_prompt_tokens: 272000, completion: "0.000020000000000000001" },
  ];
  assert.throws(
    () => inspectOneUserPrices(input.text, input.embedding),
    /exceeds the scenario ceiling/,
  );
});

test("ONE USER PRICES: missing and duplicate selected models never fall back", () => {
  for (const target of ["text", "embedding"] as const) {
    for (const shape of [null, {}, { data: [] }, { data: "invalid" }]) {
      const input = metadata();
      const other = target === "text" ? input.embedding : input.text;
      assert.throws(() =>
        target === "text"
          ? inspectOneUserPrices(shape, other)
          : inspectOneUserPrices(other, shape),
      );
    }
    const input = metadata();
    const selected = input[target].data.at(-1);
    assert.ok(selected);
    input[target].data.push(selected as never);
    assert.throws(
      () => inspectOneUserPrices(input.text, input.embedding),
      /missing or ambiguous/,
    );
  }
});

test("ONE USER PRICES: malformed prices, tiers and unsupported fees fail closed", () => {
  const invalid = [
    undefined,
    null,
    true,
    "",
    " ",
    "0x10",
    "NaN",
    "Infinity",
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "1e-9999999",
  ];
  for (const value of invalid) {
    const input = metadata();
    textPricing(input).input_cache_write = value;
    assert.throws(() => inspectOneUserPrices(input.text, input.embedding));
  }
  for (const value of [null, {}, [null], [{}], [{ min_prompt_tokens: -1 }]]) {
    const input = metadata();
    textPricing(input).overrides = value;
    assert.throws(() => inspectOneUserPrices(input.text, input.embedding));
  }
  const input = metadata();
  const price = textPricing(input);
  price.request = "0.00000001";
  assert.throws(
    () => inspectOneUserPrices(input.text, input.embedding),
    /per-request fee/,
  );
  price.request = "0";
  price.overrides = [
    { min_prompt_tokens: 272000, input_cache_read: "0.000008" },
  ];
  assert.throws(
    () => inspectOneUserPrices(input.text, input.embedding),
    /exceeds the scenario ceiling/,
  );
});

test("ONE USER PRICES: embedding rate, output and request charges are bounded", () => {
  for (const extra of [
    { prompt: "0.00000002000000001" },
    { completion: "0.00001" },
    { request: "0.01" },
    { input_cache_write: "0.000000001" },
    { overrides: [{ min_prompt_tokens: 1, prompt: "0.00000003" }] },
  ]) {
    const input = metadata();
    Object.assign(input.embedding.data[0]?.pricing ?? {}, extra);
    assert.throws(() => inspectOneUserPrices(input.text, input.embedding));
  }
});

test("ONE USER PRICES: verification requests only fixed public metadata", async () => {
  const input = metadata();
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher: OneUserPriceFetcher = async (url, init) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify(calls.length === 1 ? input.text : input.embedding),
    );
  };
  const result = await verifyOneUserPrices(fetcher);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://openrouter.ai/api/v1/models",
      "https://openrouter.ai/api/v1/embeddings/models",
    ],
  );
  for (const { init } of calls) {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.body, undefined);
    assert.equal(new Headers(init.headers).has("authorization"), false);
    assert.deepEqual(
      [...new Headers(init.headers)],
      [["accept", "application/json"]],
    );
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
  assert.equal(result.nativePriceRoutingVerified, false);
});

test("ONE USER PRICES: transport and invalid responses never expose body/errors", async () => {
  const secret = "SYNTHETIC_PRIVATE_METADATA_SENTINEL";
  for (const fetcher of [
    async () => {
      throw new Error(secret);
    },
    async () => new Response(secret, { status: 503 }),
    async () => new Response(secret),
    async () => new Response('{"data":null}'),
    async () => ({ status: 200, body: null }),
  ] as OneUserPriceFetcher[]) {
    await assert.rejects(verifyOneUserPrices(fetcher), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /One-user price/);
      assert.ok(!error.message.includes(secret));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test("ONE USER PRICES: oversized streamed metadata is canceled before next URL", async () => {
  let calls = 0;
  let canceled = false;
  const fetcher: OneUserPriceFetcher = async () => {
    calls++;
    return {
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(8 * 1024 * 1024));
          controller.enqueue(new Uint8Array(1));
        },
        cancel() {
          canceled = true;
        },
      }),
    };
  };
  await assert.rejects(verifyOneUserPrices(fetcher), /exceeds its byte limit/);
  assert.equal(canceled, true);
  assert.equal(calls, 1);
});

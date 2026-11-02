import { createRequire } from "node:module";
import { ONE_USER_LIMITS } from "./one-user-budget.ts";

const TEXT_MODEL = "openai/gpt-6-sol";
const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const TEXT_METADATA = "https://openrouter.ai/api/v1/models";
const EMBEDDING_METADATA = "https://openrouter.ai/api/v1/embeddings/models";
const MAX_METADATA_BYTES = 8 * 1024 * 1024;

type Dict = Record<string, unknown>;
const record = (value: unknown): value is Dict =>
  value !== null && typeof value === "object" && !Array.isArray(value);

class PriceMetadataError extends Error {}

function denied(reason: string): never {
  throw new PriceMetadataError(`One-user price metadata denied: ${reason}.`);
}

type Decimal = { numerator: bigint; denominator: bigint };

// Compare the published decimal prices exactly, including boundary values.
// Bounded input/exponents also avoid allocating enormous BigInts from metadata.
function decimal(value: unknown): Decimal {
  if (typeof value !== "string" && typeof value !== "number")
    return denied("invalid numeric price");
  const text = String(value);
  if (
    !text ||
    text.length > 100 ||
    !Number.isFinite(Number(text)) ||
    Number(text) < 0
  )
    return denied("invalid numeric price");
  const parsed = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!parsed) return denied("invalid numeric price");
  const fraction = parsed[2] ?? "";
  const power = Number(parsed[3] ?? 0) - fraction.length;
  if (!Number.isSafeInteger(power) || Math.abs(power) > 200)
    return denied("unsupported numeric price precision");
  const coefficient = BigInt(`${parsed[1]}${fraction}`);
  return power >= 0
    ? { numerator: coefficient * 10n ** BigInt(power), denominator: 1n }
    : { numerator: coefficient, denominator: 10n ** BigInt(-power) };
}

const sum = (left: Decimal, right: Decimal): Decimal => ({
  numerator:
    left.numerator * right.denominator + right.numerator * left.denominator,
  denominator: left.denominator * right.denominator,
});
const greater = (left: Decimal, right: Decimal): boolean =>
  left.numerator * right.denominator > right.numerator * left.denominator;
const million = (value: Decimal): Decimal => ({
  numerator: value.numerator * 1000000n,
  denominator: value.denominator,
});
function displayed(value: Decimal): number {
  const numerator = Number(value.numerator);
  const denominator = Number(value.denominator);
  const result = numerator / denominator;
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    !Number.isFinite(result) ||
    (value.numerator !== 0n && result === 0)
  )
    return denied("unsupported reported price precision");
  return result;
}

function selectedPricing(metadata: unknown, model: string): Dict[] {
  if (
    !record(metadata) ||
    !Array.isArray(metadata.data) ||
    metadata.data.length > 50000
  )
    return denied("invalid model listing");
  const matches = metadata.data.filter(
    (entry) => record(entry) && entry.id === model,
  );
  if (matches.length !== 1 || !record(matches[0]))
    return denied("missing or ambiguous selected model");
  const pricing = matches[0].pricing;
  if (!record(pricing)) return denied("missing selected-model prices");
  const overrides = pricing.overrides;
  if (
    overrides !== undefined &&
    (!Array.isArray(overrides) || overrides.length > 128)
  )
    return denied("invalid price tiers");
  const tiers = [pricing];
  for (const override of (overrides ?? []) as unknown[]) {
    if (
      !record(override) ||
      !Number.isSafeInteger(override.min_prompt_tokens) ||
      (override.min_prompt_tokens as number) < 0
    )
      return denied("invalid price tier");
    tiers.push({ ...pricing, ...override });
  }
  return tiers;
}

function rejectRequestFee(pricing: Dict) {
  if (
    pricing.request !== undefined &&
    decimal(pricing.request).numerator !== 0n
  )
    denied("unaccounted per-request fee");
}

/** Public advertised prices only; no claim about the provider eventually routed. */
export function inspectOneUserPrices(
  textMetadata: unknown,
  embeddingMetadata: unknown,
) {
  const textTiers = selectedPricing(textMetadata, TEXT_MODEL);
  const embeddingTiers = selectedPricing(embeddingMetadata, EMBEDDING_MODEL);
  let maximumInput: Decimal = decimal(0);
  let maximumOutput: Decimal = decimal(0);
  let maximumEmbedding: Decimal = decimal(0);
  for (const tier of textTiers) {
    rejectRequestFee(tier);
    for (const field of [
      "prompt",
      "completion",
      "input_cache_write",
      "input_cache_read",
    ])
      if (!Object.hasOwn(tier, field))
        denied("incomplete selected-text prices");
    const prompt = decimal(tier.prompt);
    const write = decimal(tier.input_cache_write);
    const read = decimal(tier.input_cache_read);
    const input = million(sum(prompt, greater(write, read) ? write : read));
    const output = million(decimal(tier.completion));
    if (
      greater(input, decimal(ONE_USER_LIMITS.inputUsdPerMillion)) ||
      greater(output, decimal(ONE_USER_LIMITS.outputUsdPerMillion))
    )
      denied("selected-text price exceeds the scenario ceiling");
    if (greater(input, maximumInput)) maximumInput = input;
    if (greater(output, maximumOutput)) maximumOutput = output;
  }
  for (const tier of embeddingTiers) {
    rejectRequestFee(tier);
    if (!Object.hasOwn(tier, "prompt") || !Object.hasOwn(tier, "completion"))
      denied("incomplete embedding prices");
    if (decimal(tier.completion).numerator !== 0n)
      denied("unaccounted embedding output fee");
    const write = decimal(tier.input_cache_write ?? 0);
    const read = decimal(tier.input_cache_read ?? 0);
    const input = million(
      sum(decimal(tier.prompt), greater(write, read) ? write : read),
    );
    if (greater(input, decimal(ONE_USER_LIMITS.embeddingUsdPerMillion)))
      denied("embedding price exceeds the scenario ceiling");
    if (greater(input, maximumEmbedding)) maximumEmbedding = input;
  }
  return {
    kind: "one-user-published-price-snapshot" as const,
    chatModel: TEXT_MODEL,
    embeddingModel: EMBEDDING_MODEL,
    advertisedTierCount: {
      text: textTiers.length,
      embedding: embeddingTiers.length,
    },
    observedMaximaUsdPerMillion: {
      inputIncludingCacheWriteOrRead: displayed(maximumInput),
      output: displayed(maximumOutput),
      embeddingInputIncludingCache: displayed(maximumEmbedding),
    },
    ceilingsUsdPerMillion: {
      inputIncludingCacheWriteOrRead: ONE_USER_LIMITS.inputUsdPerMillion,
      output: ONE_USER_LIMITS.outputUsdPerMillion,
      embeddingInputIncludingCache: ONE_USER_LIMITS.embeddingUsdPerMillion,
    },
    publishedPriceSnapshotVerified: true,
    nativePriceRoutingVerified: false,
    estimateIsHardCap: false,
  };
}

export type OneUserPriceFetcher = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, "status" | "body">>;

async function readMetadata(
  fetcher: OneUserPriceFetcher,
  url: string,
): Promise<unknown> {
  const response = await fetcher(url, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel().catch(() => {});
    return denied("metadata HTTP response unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let complete = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        complete = true;
        break;
      }
      if (!(next.value instanceof Uint8Array))
        return denied("invalid metadata response chunk");
      bytes += next.value.byteLength;
      if (bytes > MAX_METADATA_BYTES)
        return denied("metadata response exceeds its byte limit");
      chunks.push(next.value);
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function runtimeMetadataClient() {
  const nativeRequire = createRequire(import.meta.resolve("openclaw"));
  if (
    nativeRequire("../package.json").version !== "2026.9.9" ||
    nativeRequire("undici/package.json").version !== "8.10.2" ||
    process.versions.node !== "24.16.0"
  )
    throw new PriceMetadataError(
      "Unverified one-user price transport runtime.",
    );
  const { fetch, EnvHttpProxyAgent } = nativeRequire("undici/index.js");
  const value = (lower: string, upper: string): string | undefined =>
    (process.env[lower] ?? process.env[upper])?.trim() || undefined;
  const httpProxy =
    value("http_proxy", "HTTP_PROXY") ?? value("all_proxy", "ALL_PROXY");
  const httpsProxy = value("https_proxy", "HTTPS_PROXY") ?? httpProxy;
  const dispatcher = new EnvHttpProxyAgent({
    httpProxy,
    httpsProxy,
    noProxy: process.env.no_proxy ?? process.env.NO_PROXY,
    requestTls: { rejectUnauthorized: true },
    proxyTls: { rejectUnauthorized: true },
  });
  return {
    fetcher: ((url, init) =>
      fetch(url, { ...init, dispatcher })) as OneUserPriceFetcher,
    close: () => dispatcher.close() as Promise<void>,
  };
}

/** Fetch bounded public metadata before admission; never sends auth or inference. */
export async function verifyOneUserPrices(fetcher?: OneUserPriceFetcher) {
  let client: ReturnType<typeof runtimeMetadataClient> | undefined;
  let result:
    | (ReturnType<typeof inspectOneUserPrices> & { checkedAt: string })
    | undefined;
  let failure: PriceMetadataError | undefined;
  try {
    if (!fetcher) {
      client = runtimeMetadataClient();
      fetcher = client.fetcher;
    }
    const text = await readMetadata(fetcher, TEXT_METADATA);
    const embedding = await readMetadata(fetcher, EMBEDDING_METADATA);
    result = {
      ...inspectOneUserPrices(text, embedding),
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    failure =
      error instanceof PriceMetadataError
        ? error
        : new PriceMetadataError(
            "One-user price metadata could not be verified.",
          );
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        failure ??= new PriceMetadataError(
          "One-user price transport cleanup failed.",
        );
      }
    }
  }
  if (failure) throw failure;
  if (!result)
    throw new PriceMetadataError(
      "One-user price metadata could not be verified.",
    );
  return result;
}

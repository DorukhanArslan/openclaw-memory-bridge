import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

// Application test supervision only; native OpenClaw still sends every request.
export const LIFECYCLE_LIMITS = Object.freeze({
  requests: 16,
  inputBytes: 245000,
  outputPerRequest: 4096,
  outputTokens: 14000,
  estimatedUsd: (245000 * 18 + 14000 * 30) / 1e6,
});
export const CONSOLIDATION_LIMITS = Object.freeze({
  requests: 16,
  inputBytes: 180000,
  outputPerRequest: 8192,
  outputTokens: 40000,
  estimatedUsd: (180000 * 18 + 40000 * 30) / 1e6,
});
type Ledger = {
  requests: number;
  inputBytes: number;
  outputTokens: number;
  profile?: "consolidation";
};
export function createLifecycleLedger(path: string, profile?: "consolidation") {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(
      fd,
      JSON.stringify({
        requests: 0,
        inputBytes: 0,
        outputTokens: 0,
        ...(profile ? { profile } : {}),
      }),
    );
  } finally {
    closeSync(fd);
  }
}

export function admitLifecycleRequest(
  path: string,
  input: string | URL | Request,
  init?: RequestInit,
) {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  const method = (init?.method ?? "GET").toUpperCase();
  if (["127.0.0.1", "[::1]"].includes(url.hostname)) return;
  if (url.origin !== "https://openrouter.ai")
    throw new Error("Finite lifecycle destination denied.");
  if (
    method === "GET" &&
    ["/api/v1/key", "/api/v1/credits"].includes(url.pathname)
  )
    return;
  if (
    !init ||
    url.pathname !== "/api/v1/chat/completions" ||
    method !== "POST" ||
    !(typeof init.body === "string" || init.body instanceof Uint8Array)
  )
    throw new Error("Finite lifecycle request shape denied.");
  const text =
    typeof init.body === "string"
      ? init.body
      : new TextDecoder("utf-8", { fatal: true }).decode(
          init.body as Uint8Array,
        );
  const ledgerProfile = JSON.parse(readFileSync(path, "utf8")) as Ledger;
  if (
    ledgerProfile.profile !== undefined &&
    ledgerProfile.profile !== "consolidation"
  )
    throw new Error("Invalid finite lifecycle profile.");
  const limits =
    ledgerProfile.profile === "consolidation"
      ? CONSOLIDATION_LIMITS
      : LIFECYCLE_LIMITS;
  const body = JSON.parse(text) as {
    model?: string;
    max_completion_tokens?: number;
    max_tokens?: number;
  };
  const output = body.max_completion_tokens ?? body.max_tokens;
  if (body.max_completion_tokens !== undefined && body.max_tokens !== undefined)
    throw new Error("Ambiguous native output bound denied.");
  if (
    body.model !== "openai/gpt-6-sol" ||
    !Number.isInteger(output) ||
    !output ||
    output < 1 ||
    output > limits.outputPerRequest
  ) {
    writeFileSync(
      path,
      JSON.stringify({
        ...ledgerProfile,
        lastDenial: {
          reason: "model_output",
          modelMatches: body.model === "openai/gpt-6-sol",
          completionTokens: body.max_completion_tokens ?? null,
          maxTokens: body.max_tokens ?? null,
        },
      }),
      { mode: 0o600 },
    );
    throw new Error("Finite lifecycle model/output bound denied.");
  }
  const lock = `${path}.lock`;
  const fd = openSync(lock, "wx", 0o600);
  try {
    const ledger = JSON.parse(readFileSync(path, "utf8")) as Ledger;
    if (
      ![ledger.requests, ledger.inputBytes, ledger.outputTokens].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      )
    )
      throw new Error("Invalid finite lifecycle ledger.");
    const next = {
      ...(ledger.profile ? { profile: ledger.profile } : {}),
      requests: ledger.requests + 1,
      inputBytes: ledger.inputBytes + Buffer.byteLength(text),
      outputTokens: ledger.outputTokens + output,
    };
    if (
      next.requests > limits.requests ||
      next.inputBytes > limits.inputBytes ||
      next.outputTokens > limits.outputTokens
    ) {
      writeFileSync(
        path,
        JSON.stringify({
          ...ledger,
          lastDenial:
            next.inputBytes > limits.inputBytes
              ? "input_bytes"
              : next.outputTokens > limits.outputTokens
                ? "output_tokens"
                : "request_count",
        }),
        { mode: 0o600 },
      );
      throw new Error("Finite lifecycle request budget exhausted.");
    }
    writeFileSync(path, JSON.stringify(next), { mode: 0o600 });
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

/** Transport adapter only: bound a native utility call that omits output tokens.
 * Preserve its model, messages, tools and all memory/provenance semantics.
 */
export function boundConsolidationUtilityRequest(
  path: string,
  input: string | URL | Request,
  init?: RequestInit,
): RequestInit | undefined {
  const ledger = JSON.parse(readFileSync(path, "utf8")) as Ledger;
  if (ledger.profile !== "consolidation") return init;
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  if (
    url.href !== "https://openrouter.ai/api/v1/chat/completions" ||
    (init?.method ?? "GET").toUpperCase() !== "POST" ||
    !(typeof init?.body === "string" || init?.body instanceof Uint8Array)
  )
    return init;
  const text =
    typeof init.body === "string"
      ? init.body
      : new TextDecoder("utf-8", { fatal: true }).decode(
          init.body as Uint8Array,
        );
  const body = JSON.parse(text);
  if (
    body.model !== "openai/gpt-6-sol" ||
    body.max_completion_tokens !== undefined ||
    body.max_tokens !== undefined
  )
    return init;
  // The pinned native utility path omits this bound. This adapter does not
  // infer a native limit from catalog metadata or dispatch an unbounded call.
  body.max_completion_tokens = 2048;
  const headers = new Headers(init.headers);
  headers.delete("content-length");
  return { ...init, headers, body: JSON.stringify(body) };
}

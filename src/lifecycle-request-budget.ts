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
type Ledger = { requests: number; inputBytes: number; outputTokens: number };
export function createLifecycleLedger(path: string) {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(
      fd,
      JSON.stringify({ requests: 0, inputBytes: 0, outputTokens: 0 }),
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
  const body = JSON.parse(text) as {
    model?: string;
    max_completion_tokens?: number;
  };
  const output = body.max_completion_tokens;
  if (
    body.model !== "openai/gpt-6-sol" ||
    !Number.isInteger(output) ||
    !output ||
    output < 1 ||
    output > LIFECYCLE_LIMITS.outputPerRequest
  )
    throw new Error("Finite lifecycle model/output bound denied.");
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
      requests: ledger.requests + 1,
      inputBytes: ledger.inputBytes + Buffer.byteLength(text),
      outputTokens: ledger.outputTokens + output,
    };
    if (
      next.requests > LIFECYCLE_LIMITS.requests ||
      next.inputBytes > LIFECYCLE_LIMITS.inputBytes ||
      next.outputTokens > LIFECYCLE_LIMITS.outputTokens
    ) {
      writeFileSync(
        path,
        JSON.stringify({
          ...ledger,
          lastDenial:
            next.inputBytes > LIFECYCLE_LIMITS.inputBytes
              ? "input_bytes"
              : next.outputTokens > LIFECYCLE_LIMITS.outputTokens
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

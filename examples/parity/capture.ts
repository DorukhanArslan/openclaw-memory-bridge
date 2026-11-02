// Test-only application HTTP observer. Provider traffic and headers are excluded.
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { TraceJournal } from "./trace.ts";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const tapePath = process.env.PARITY_CAPTURE;
const journalPath = process.env.PARITY_JOURNAL_PATH;
const secrets = new Set<string>();
const journal = journalPath
  ? new TraceJournal(journalPath, {
      captureId: process.env.PARITY_CAPTURE_ID ?? "parity-http",
      route: "sdk-http",
    })
  : undefined;

function addSecret(value: string | null | undefined) {
  if (!value) return;
  secrets.add(value);
  journal?.addSecret(value);
  const escaped = JSON.stringify(value).slice(1, -1);
  if (escaped !== value) {
    secrets.add(escaped);
    journal?.addSecret(escaped);
  }
}
addSecret(process.env.OPENROUTER_API_KEY);
addSecret(process.env.OPENCLAW_GATEWAY_TOKEN);
function sensitiveKey(value: string) {
  return /(?:authorization|cookie|apikey|token|password|secret)$/i.test(
    value.replaceAll(/[-_]/g, ""),
  );
}
// Discover labelled values before normal decoding, including malformed JSON.
function registerInlineSecrets(raw: string) {
  for (const match of raw.matchAll(/"([^"\\]+)"\s*:\s*("(?:\\.|[^"\\])*")/g)) {
    if (!sensitiveKey(match[1] ?? "")) continue;
    try {
      const value: unknown = JSON.parse(match[2] ?? "null");
      if (typeof value === "string") addSecret(value);
    } catch {
      addSecret(match[2]?.slice(1, -1));
    }
  }
}
function safeForExactTape(value: unknown): boolean {
  if (journal) return isDeepStrictEqual(journal.redact(value), value);
  if (typeof value === "string")
    return ![...secrets].some((secret) => value.includes(secret));
  if (Array.isArray(value)) return value.every(safeForExactTape);
  if (value && typeof value === "object")
    return Object.entries(value).every(
      ([key, item]) =>
        !(sensitiveKey(key) && item !== null && item !== "") &&
        safeForExactTape(item),
    );
  return true;
}
function fail(reason: string): never {
  journal?.fail(reason);
  throw new Error(`Parity HTTP capture failed: ${reason}.`);
}

let tape: number | undefined;
if (tapePath) {
  const path = resolve(tapePath),
    parent = dirname(path);
  if (
    realpathSync(parent) !== parent ||
    !lstatSync(parent).isDirectory() ||
    (lstatSync(parent).mode & 0o077) !== 0
  )
    fail("unsafe replay tape directory");
  tape = openSync(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  fsyncSync(tape);
  const directory = openSync(
    parent,
    constants.O_RDONLY | constants.O_DIRECTORY,
  );
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
function appendTape(value: unknown) {
  if (tape === undefined) return;
  if (!safeForExactTape(value))
    fail("sensitive payload cannot be replayed exactly");
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  if (bytes.length > MAX_BODY_BYTES) fail("replay pair exceeds its byte bound");
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(tape, bytes, offset, bytes.length - offset);
      if (!written) throw new Error("No tape write progress.");
      offset += written;
    }
    fsyncSync(tape);
  } catch {
    fail("replay tape write was uncertain");
  }
}
async function bodyText(
  body: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY_BYTES)
        throw new Error("HTTP body exceeds its byte bound.");
      chunks.push(next.value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
async function requestText(input: RequestInfo | URL, init?: RequestInit) {
  const body = init?.body;
  if (body === undefined || body === null)
    return input instanceof Request ? bodyText(input.clone().body) : "";
  const bytes =
    typeof body === "string"
      ? Buffer.from(body)
      : body instanceof Uint8Array
        ? body
        : body instanceof ArrayBuffer
          ? new Uint8Array(body)
          : undefined;
  if (!bytes) fail("unsupported request body");
  if (bytes.byteLength > MAX_BODY_BYTES)
    fail("HTTP body exceeds its byte bound");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function observedTarget(input: RequestInfo | URL): URL | undefined {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input));
    return url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.port &&
      url.pathname === "/tools/invoke"
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}
function registerHeadersAndTarget(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  url: URL,
) {
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  const authorization = headers.get("authorization");
  addSecret(authorization);
  if (authorization?.startsWith("Bearer ")) addSecret(authorization.slice(7));
  addSecret(headers.get("x-api-key"));
  addSecret(url.username);
  addSecret(url.password);
  for (const [name, value] of url.searchParams)
    if (sensitiveKey(name)) addSecret(value);
}

function errorInfo(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) return { name: "Error" };
  const code: unknown = Reflect.get(error, "code");
  return {
    name: error.name,
    message: error.message,
    ...(typeof code === "string" ? { code } : {}),
    ...(error.cause instanceof Error && depth < 2
      ? { cause: errorInfo(error.cause, depth + 1) }
      : {}),
  };
}

if (journal || tape !== undefined) {
  journal?.beginGeneration("sdk-http-process");
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const target = observedTarget(input);
    if (!target) return original(input, init);
    registerHeadersAndTarget(input, init, target);
    let requestRaw: string;
    try {
      requestRaw = await requestText(input, init);
    } catch {
      fail("request body could not be captured completely");
    }
    registerInlineSecrets(requestRaw);
    let request: unknown;
    try {
      request = JSON.parse(requestRaw);
    } catch {
      fail("tools/invoke request is not JSON");
    }
    const operation = journal?.start("http", {
      method: init?.method ?? (input instanceof Request ? input.method : "GET"),
      url: target.href,
      requestRaw,
      request,
    });
    if (tape !== undefined && !safeForExactTape(request))
      fail("sensitive request cannot be replayed exactly");
    let result: Response | undefined,
      ended = false;
    try {
      result = await original(input, init);
      let raw: string;
      try {
        raw = await bodyText(result.clone().body);
      } catch (error) {
        // A status alone cannot prove its body was captured. Leave the
        // operation unfinished and poison after durably recording the failure.
        if (operation && !journal?.poisoned)
          journal?.record(
            "http.error",
            {
              kind: "incomplete-body",
              status: result.status,
              bodyComplete: false,
              error: errorInfo(error),
            },
            { operationId: operation },
          );
        fail("response body could not be captured completely");
      }
      registerInlineSecrets(raw);
      journal?.record(
        "http.response",
        { status: result.status, responseRaw: raw },
        { operationId: operation },
      );
      let response: unknown;
      try {
        response = JSON.parse(raw);
      } catch {
        if (operation)
          journal?.end(operation, "http.error", {
            kind: "malformed-json",
            status: result.status,
          });
        ended = true;
        throw new Error("Parity HTTP response was not valid JSON.");
      }
      appendTape({ request, response, status: result.status });
      if (operation)
        journal?.end(operation, "http.result", {
          status: result.status,
          response,
        });
      ended = true;
      return result;
    } catch (error) {
      void result?.body?.cancel().catch(() => {});
      if (!ended && operation && !journal?.poisoned)
        journal?.end(operation, "http.error", {
          kind: result ? "capture" : "network",
          status: result?.status ?? null,
          error: errorInfo(error),
        });
      throw error;
    }
  };
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    try {
      journal?.finish();
    } catch {
      process.exitCode = 2;
      process.stderr.write("Parity HTTP journal is incomplete.\n");
    }
    if (tape !== undefined) {
      closeSync(tape);
      tape = undefined;
    }
  };
  process.once("beforeExit", finish);
  process.once("exit", finish);
}

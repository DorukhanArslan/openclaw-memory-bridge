import { Agent, type ClientRequest, request } from "node:http";

export type GatewayErrorCode =
  | "invalid_config"
  | "invalid_request"
  | "auth_denied"
  | "policy_denied"
  | "tool_unavailable"
  | "rate_limited"
  | "timeout"
  | "connection_failed"
  | "invalid_response"
  | "engine_unavailable"
  | "engine_error"
  | "not_found"
  | "closed"
  | "cancelled"
  | "response_too_large"
  | "busy";

const messages: Record<GatewayErrorCode, string> = {
  invalid_config: "Invalid server-side Gateway connection configuration.",
  invalid_request: "Invalid bounded memory request.",
  auth_denied: "Gateway authentication was denied.",
  policy_denied: "Gateway policy denied the memory tool.",
  tool_unavailable: "The native memory tool is not available or allowed.",
  rate_limited: "Gateway rate limit reached; the caller may retry later.",
  timeout: "The Gateway request exceeded its absolute deadline.",
  connection_failed:
    "The private Gateway connection failed or was interrupted.",
  invalid_response:
    "The Gateway returned an unsupported or malformed response.",
  engine_unavailable: "Native memory is unavailable, disabled or stale.",
  engine_error: "The native memory operation failed.",
  not_found: "The native memory source was not found.",
  closed: "This Gateway client is closed.",
  cancelled: "The caller cancelled the Gateway request.",
  response_too_large:
    "The Gateway response exceeded the configured byte limit.",
  busy: "This client already has 16 outstanding requests.",
};

/** Contains no response body, connection URL, credential or nested transport cause. */
export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly httpStatus?: number;
  constructor(code: GatewayErrorCode, httpStatus?: number) {
    super(messages[code]);
    this.name = "GatewayError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export type MemoryHit = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  [key: string]: unknown;
};
export type MemorySearchResult = {
  results: MemoryHit[];
  provider: string;
  [key: string]: unknown;
};
export type MemoryGetResult = {
  status: "ok";
  text: string;
  path: string;
  from: number;
  lines: number;
  [key: string]: unknown;
};
export type ReadyGatewayOptions = {
  url: string;
  token: string;
  agentId?: string;
  sessionKey?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function integer(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}
function httpError(status: number): GatewayError {
  const codes: Record<number, GatewayErrorCode> = {
    400: "invalid_request",
    401: "auth_denied",
    403: "policy_denied",
    404: "tool_unavailable",
    408: "timeout",
    429: "rate_limited",
    502: "engine_unavailable",
    503: "engine_unavailable",
    504: "timeout",
  };
  return new GatewayError(
    codes[status] ?? (status >= 500 ? "engine_error" : "invalid_response"),
    status,
  );
}
function details(body: unknown): Record<string, unknown> {
  if (!record(body) || body.ok !== true || !record(body.result)) {
    if (record(body) && body.ok === false)
      throw new GatewayError("engine_error");
    throw new GatewayError("invalid_response");
  }
  let payload = body.result.details;
  if (payload === undefined && Array.isArray(body.result.content)) {
    const part = body.result.content.find(
      (entry: unknown) => record(entry) && entry.type === "text",
    );
    if (record(part) && typeof part.text === "string") {
      try {
        payload = JSON.parse(part.text);
      } catch {
        throw new GatewayError("invalid_response");
      }
    }
  }
  if (!record(payload)) throw new GatewayError("invalid_response");
  return payload;
}

/** Server-only native memory client. It owns HTTP sockets, never the Gateway. */
export class ReadyGateway {
  #url: URL;
  #token: string;
  #agentId: string;
  #sessionKey: string;
  #timeoutMs: number;
  #maxBytes: number;
  #agent = new Agent({
    keepAlive: true,
    maxSockets: 4,
    maxTotalSockets: 4,
    maxFreeSockets: 2,
  });
  #pending = new Map<ClientRequest, (code: GatewayErrorCode) => void>();
  #closed = false;

  constructor(options: ReadyGatewayOptions) {
    let url: URL;
    try {
      url = new URL(options.url);
    } catch {
      throw new GatewayError("invalid_config");
    }
    const agentId = options.agentId ?? "main";
    const sessionKey = options.sessionKey ?? `agent:${agentId}:main`;
    const timeout = options.timeoutMs ?? 40000;
    const maxBytes = options.maxResponseBytes ?? 1024 * 1024;
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      typeof options.token !== "string" ||
      !options.token ||
      options.token.length > 4096 ||
      /[^\x21-\x7e]/.test(options.token) ||
      !/^[a-z][a-z0-9-]{0,47}$/.test(agentId) ||
      !sessionKey.startsWith(`agent:${agentId}:`) ||
      sessionKey.length > 256 ||
      !/^[a-zA-Z0-9:_-]+$/.test(sessionKey) ||
      !integer(timeout, 1, 120000) ||
      !integer(maxBytes, 256, 16 * 1024 * 1024)
    )
      throw new GatewayError("invalid_config");
    this.#url = url;
    this.#token = options.token;
    this.#agentId = agentId;
    this.#sessionKey = sessionKey;
    this.#timeoutMs = timeout;
    this.#maxBytes = maxBytes;
  }

  async #invoke(
    tool: "memory_search" | "memory_get",
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    if (this.#closed) throw new GatewayError("closed");
    if (signal?.aborted) throw new GatewayError("cancelled");
    if (this.#pending.size >= 16) throw new GatewayError("busy");
    const body = JSON.stringify({
      tool,
      args,
      agentId: this.#agentId,
      sessionKey: this.#sessionKey,
    });
    const result = await new Promise<unknown>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let req: ClientRequest;
      const finish = (error?: GatewayError, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.#pending.delete(req);
        if (error) reject(error);
        else resolve(value);
      };
      const abort = (code: GatewayErrorCode) => {
        finish(new GatewayError(code));
        req.destroy();
      };
      const onAbort = () => abort("cancelled");
      try {
        req = request(
          {
            hostname: this.#url.hostname.replace(/^\[|\]$/g, ""),
            port: this.#url.port || 80,
            path: "/tools/invoke",
            method: "POST",
            agent: this.#agent,
            headers: {
              "content-type": "application/json",
              accept: "application/json",
              "accept-encoding": "identity",
              "content-length": Buffer.byteLength(body),
              authorization: `Bearer ${this.#token}`,
            },
          },
          (response) => {
            const status = response.statusCode ?? 0;
            if (status !== 200) {
              finish(httpError(status));
              response.destroy();
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            response.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > this.#maxBytes) {
                abort("response_too_large");
                response.destroy();
              } else chunks.push(chunk);
            });
            response.on("aborted", () =>
              finish(new GatewayError("connection_failed")),
            );
            response.on("error", () =>
              finish(new GatewayError("connection_failed")),
            );
            response.on("end", () => {
              try {
                finish(
                  undefined,
                  JSON.parse(
                    new TextDecoder("utf-8", { fatal: true }).decode(
                      Buffer.concat(chunks),
                    ),
                  ),
                );
              } catch {
                finish(new GatewayError("invalid_response"));
              }
            });
          },
        );
      } catch {
        reject(new GatewayError("connection_failed"));
        return;
      }
      this.#pending.set(req, abort);
      req.on("error", () => finish(new GatewayError("connection_failed")));
      timer = setTimeout(() => abort("timeout"), this.#timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      req.end(body);
    });
    return details(result);
  }

  async search(
    query: string,
    options: {
      maxResults?: number;
      minScore?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<MemorySearchResult> {
    const maxResults = options.maxResults ?? 8;
    const minScore = options.minScore ?? 0;
    if (
      typeof query !== "string" ||
      !query.trim() ||
      query.length > 4096 ||
      !integer(maxResults, 1, 20) ||
      typeof minScore !== "number" ||
      !Number.isFinite(minScore) ||
      minScore < 0 ||
      minScore > 1
    )
      throw new GatewayError("invalid_request");
    const result = await this.#invoke(
      "memory_search",
      { query, maxResults, minScore, corpus: "memory" },
      options.signal,
    );
    if (
      ["disabled", "unavailable", "stale", "error"].some((key) => result[key])
    )
      throw new GatewayError("engine_unavailable");
    if (!Array.isArray(result.results) || typeof result.provider !== "string")
      throw new GatewayError("invalid_response");
    for (const hit of result.results) {
      if (
        !record(hit) ||
        typeof hit.path !== "string" ||
        typeof hit.snippet !== "string" ||
        typeof hit.score !== "number" ||
        !Number.isFinite(hit.score) ||
        !integer(hit.startLine, 1, Number.MAX_SAFE_INTEGER) ||
        !integer(hit.endLine, Number(hit.startLine), Number.MAX_SAFE_INTEGER)
      )
        throw new GatewayError("invalid_response");
    }
    return result as MemorySearchResult;
  }

  async get(
    path: string,
    options: { from?: number; lines?: number; signal?: AbortSignal } = {},
  ): Promise<MemoryGetResult> {
    const from = options.from ?? 1;
    const lines = options.lines ?? 40;
    if (
      typeof path !== "string" ||
      path.length > 512 ||
      !/^(MEMORY\.md|USER\.md|memory\/[A-Za-z0-9._/-]+\.md)$/.test(path) ||
      path.split("/").some((part) => !part || part === "." || part === "..") ||
      !integer(from, 1, Number.MAX_SAFE_INTEGER) ||
      !integer(lines, 1, 200)
    )
      throw new GatewayError("invalid_request");
    const result = await this.#invoke(
      "memory_get",
      { path, from, lines, corpus: "memory" },
      options.signal,
    );
    if (result.status === "not_found") throw new GatewayError("not_found");
    if (result.status === "error" || result.error)
      throw new GatewayError("engine_error");
    if (
      result.status !== "ok" ||
      typeof result.text !== "string" ||
      typeof result.path !== "string" ||
      !integer(result.from, 1, Number.MAX_SAFE_INTEGER) ||
      !integer(result.lines, 0, 200)
    )
      throw new GatewayError("invalid_response");
    return result as MemoryGetResult;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const abort of this.#pending.values()) abort("closed");
    this.#agent.destroy();
    this.#token = "";
  }
}

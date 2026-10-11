import assert from "node:assert/strict";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { test } from "node:test";
import { GatewayError, ReadyGateway } from "../src/gateway.ts";

const TOKEN = "synthetic-transport-token";
const SEARCH = {
  results: [
    {
      path: "memory/sample.md",
      startLine: 1,
      endLine: 2,
      score: 0.8,
      snippet: "cobalt",
      source: "memory",
    },
  ],
  provider: "none",
};

async function fixture(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

function reply(res: ServerResponse, details: unknown) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, result: { details } }));
}

function isError(code: string, status?: number) {
  return (error: unknown) => {
    assert.ok(error instanceof GatewayError);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.httpStatus, status);
    assert.ok(!JSON.stringify(error).includes(TOKEN));
    assert.ok(!String(error).includes(TOKEN));
    return true;
  };
}

test("TRANSPORT: fixed native request, pooled connection, source fields and caller-owned server", async () => {
  const requests: Record<string, unknown>[] = [];
  const mock = await fixture((req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/tools/invoke");
    assert.equal(req.headers.authorization, `Bearer ${TOKEN}`);
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const request = JSON.parse(body);
      requests.push(request);
      reply(
        res,
        request.tool === "memory_search"
          ? SEARCH
          : {
              status: "ok",
              text: "Synthetic cobalt.",
              path: "memory/sample.md",
              from: 1,
              lines: 1,
            },
      );
    });
  });
  const client = new ReadyGateway({
    url: mock.url,
    token: TOKEN,
    agentId: "main",
  });
  try {
    assert.deepEqual(await client.search("cobalt"), SEARCH);
    assert.deepEqual(
      (await client.get("memory/sample.md")).text,
      "Synthetic cobalt.",
    );
    const response = await client.search("cobalt");
    assert.equal(response.results[0]?.score, 0.8);
    assert.deepEqual(requests[0], {
      tool: "memory_search",
      args: { query: "cobalt", maxResults: 8, minScore: 0, corpus: "memory" },
      agentId: "main",
      sessionKey: "agent:main:main",
    });
    assert.ok(!JSON.stringify(client).includes(TOKEN));
    assert.ok(
      !("restart" in client) && !("stop" in client) && !("write" in client),
    );
    client.close();
    client.close();
    await assert.rejects(client.search("cobalt"), isError("closed"));
    const other = new ReadyGateway({ url: mock.url, token: TOKEN });
    try {
      assert.deepEqual(await other.search("cobalt"), SEARCH);
    } finally {
      other.close();
    }
  } finally {
    client.close();
    await mock.close();
  }
});

test("TRANSPORT: one keep-alive socket serves sequential requests", async () => {
  const ports = new Set<number | undefined>();
  const mock = await fixture((req, res) => {
    ports.add(req.socket.remotePort);
    reply(res, SEARCH);
  });
  const client = new ReadyGateway({ url: mock.url, token: TOKEN });
  try {
    await client.search("cobalt");
    await client.search("cobalt");
    assert.equal(ports.size, 1);
  } finally {
    client.close();
    await mock.close();
  }
});

test("TRANSPORT: content JSON fallback used by the pinned native result envelope", async () => {
  const mock = await fixture((_req, res) => {
    res.end(
      JSON.stringify({
        ok: true,
        result: { content: [{ type: "text", text: JSON.stringify(SEARCH) }] },
      }),
    );
  });
  const client = new ReadyGateway({ url: mock.url, token: TOKEN });
  try {
    assert.deepEqual(await client.search("cobalt"), SEARCH);
  } finally {
    client.close();
    await mock.close();
  }
});

for (const [status, code] of [
  [400, "invalid_request"],
  [401, "auth_denied"],
  [403, "policy_denied"],
  [404, "tool_unavailable"],
  [408, "timeout"],
  [429, "rate_limited"],
  [503, "engine_unavailable"],
  [500, "engine_error"],
] as const) {
  test(`TRANSPORT: HTTP ${status} is ${code}, response secrets are not echoed`, async () => {
    const mock = await fixture((_req, res) => {
      res.statusCode = status;
      res.end(JSON.stringify({ error: { message: TOKEN } }));
    });
    const client = new ReadyGateway({ url: mock.url, token: TOKEN });
    try {
      await assert.rejects(client.search("cobalt"), isError(code, status));
    } finally {
      client.close();
      await mock.close();
    }
  });
}

for (const payload of [
  "not-json",
  "null",
  "[]",
  '{"ok":true}',
  '{"ok":true,"result":{"details":{"results":[]}}}',
  JSON.stringify({ ok: true, result: { details: { results: [{ path: 7 }] } } }),
]) {
  test("TRANSPORT: malformed envelope/result is rejected", async () => {
    const mock = await fixture((_req, res) => {
      res.end(payload);
    });
    const client = new ReadyGateway({ url: mock.url, token: TOKEN });
    try {
      await assert.rejects(
        client.search("cobalt"),
        isError("invalid_response"),
      );
    } finally {
      client.close();
      await mock.close();
    }
  });
}

for (const flag of ["disabled", "unavailable", "stale", "error"]) {
  test(`TRANSPORT: native ${flag} is an unavailable error, not empty successful hits`, async () => {
    const mock = await fixture((_req, res) => {
      reply(res, {
        results: [],
        provider: "none",
        [flag]: flag === "error" ? TOKEN : true,
      });
    });
    const client = new ReadyGateway({ url: mock.url, token: TOKEN });
    try {
      await assert.rejects(
        client.search("cobalt"),
        isError("engine_unavailable"),
      );
    } finally {
      client.close();
      await mock.close();
    }
  });
}

test("TRANSPORT: absolute timeout bounds headers and dripping response body", async () => {
  const mock = await fixture((_req, res) => {
    res.writeHead(200);
    res.write("{");
  });
  const client = new ReadyGateway({
    url: mock.url,
    token: TOKEN,
    timeoutMs: 60,
  });
  try {
    await assert.rejects(client.search("cobalt"), isError("timeout"));
  } finally {
    client.close();
    await mock.close();
  }
});

test("TRANSPORT: disconnect and refused connection fail explicitly", async () => {
  const mock = await fixture((req) => {
    req.socket.destroy();
  });
  const client = new ReadyGateway({ url: mock.url, token: TOKEN });
  try {
    await assert.rejects(client.search("cobalt"), isError("connection_failed"));
    await mock.close();
    await assert.rejects(client.search("cobalt"), isError("connection_failed"));
  } finally {
    client.close();
  }
});

test("TRANSPORT: size cap, redirects and close during a pending request", async () => {
  let mode = "large";
  const mock = await fixture((_req, res) => {
    if (mode === "large") res.end("x".repeat(2048));
    else if (mode === "redirect") {
      res.writeHead(302, { location: "http://example.com" });
      res.end();
    } else res.writeHead(200);
  });
  const client = new ReadyGateway({
    url: mock.url,
    token: TOKEN,
    maxResponseBytes: 1024,
  });
  try {
    await assert.rejects(
      client.search("cobalt"),
      isError("response_too_large"),
    );
    mode = "redirect";
    await assert.rejects(client.search("cobalt"), isError("invalid_response"));
    mode = "hang";
    const pending = assert.rejects(client.search("cobalt"), isError("closed"));
    client.close();
    await pending;
  } finally {
    client.close();
    await mock.close();
  }
});

test("TRANSPORT: invalid local endpoint/config/path/input is rejected before I/O", async () => {
  for (const url of [
    "http://example.com",
    "http://localhost:18789",
    "http://127.0.0.1:1?token=x",
    "http://secret@127.0.0.1:1",
    "http://127.0.0.1:1/path",
    "https://127.0.0.1:1",
  ]) {
    assert.throws(
      () => new ReadyGateway({ url, token: TOKEN }),
      isError("invalid_config"),
    );
  }
  assert.throws(
    () => new ReadyGateway({ url: "http://127.0.0.1:1", token: "" }),
    isError("invalid_config"),
  );
  assert.throws(
    () =>
      new ReadyGateway({
        url: "http://127.0.0.1:1",
        token: TOKEN,
        agentId: "../bad",
      }),
    isError("invalid_config"),
  );
  assert.throws(
    () =>
      new ReadyGateway({
        url: "http://127.0.0.1:1",
        token: TOKEN,
        sessionKey: "agent:other:main",
      }),
    isError("invalid_config"),
  );
  const client = new ReadyGateway({ url: "http://127.0.0.1:1", token: TOKEN });
  try {
    await assert.rejects(client.search(""), isError("invalid_request"));
    await assert.rejects(
      client.get("../secret.md"),
      isError("invalid_request"),
    );
    await assert.rejects(
      client.get("memory/sample.md", { lines: 0 }),
      isError("invalid_request"),
    );
  } finally {
    client.close();
  }
});

test("TRANSPORT: false success and invalid UTF-8 never become valid memory", async () => {
  let mode = "false";
  const mock = await fixture((_req, res) => {
    if (mode === "false")
      res.end(JSON.stringify({ ok: false, error: { message: TOKEN } }));
    else
      res.end(
        Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]),
      );
  });
  const client = new ReadyGateway({ url: mock.url, token: TOKEN });
  try {
    await assert.rejects(client.search("cobalt"), isError("engine_error"));
    mode = "utf8";
    await assert.rejects(client.search("cobalt"), isError("invalid_response"));
  } finally {
    client.close();
    await mock.close();
  }
});

test("TRANSPORT: get not-found/error/malformed are distinct from an empty source", async () => {
  let status = "not_found";
  const mock = await fixture((_req, res) =>
    reply(res, { status, text: "", path: "memory/sample.md" }),
  );
  const client = new ReadyGateway({ url: mock.url, token: TOKEN });
  try {
    await assert.rejects(client.get("memory/sample.md"), isError("not_found"));
    status = "error";
    await assert.rejects(
      client.get("memory/sample.md"),
      isError("engine_error"),
    );
    status = "ok";
    await assert.rejects(
      client.get("memory/sample.md"),
      isError("invalid_response"),
    );
  } finally {
    client.close();
    await mock.close();
  }
});

test("TRANSPORT: caller cancellation and outstanding-request limit are bounded", async () => {
  const mock = await fixture((_req, res) => {
    res.writeHead(200);
  });
  const client = new ReadyGateway({ url: mock.url, token: TOKEN });
  try {
    const controller = new AbortController();
    const cancelled = assert.rejects(
      client.search("cobalt", { signal: controller.signal }),
      isError("cancelled"),
    );
    controller.abort(TOKEN);
    await cancelled;
    await assert.rejects(
      client.search("cobalt", { signal: controller.signal }),
      isError("cancelled"),
    );
    const pending = Array.from({ length: 16 }, () =>
      assert.rejects(client.search("cobalt"), isError("closed")),
    );
    await assert.rejects(client.search("cobalt"), isError("busy"));
    client.close();
    await Promise.all(pending);
  } finally {
    client.close();
    await mock.close();
  }
});

test("TRANSPORT: caller can retry after a failed connection; no silent retry", async () => {
  let calls = 0;
  const mock = await fixture((req, res) => {
    calls++;
    if (calls === 1) req.socket.destroy();
    else reply(res, SEARCH);
  });
  const client = new ReadyGateway({ url: mock.url, token: TOKEN });
  try {
    await assert.rejects(client.search("cobalt"), isError("connection_failed"));
    assert.equal(calls, 1);
    assert.deepEqual(await client.search("cobalt"), SEARCH);
    assert.equal(calls, 2);
  } finally {
    client.close();
    await mock.close();
  }
});

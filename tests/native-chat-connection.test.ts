import assert from "node:assert/strict";
import { type EventEmitter, once } from "node:events";
import { createRequire } from "node:module";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { NativeChatConnection } from "../src/native-chat-connection.ts";

type Socket = EventEmitter & {
  send(value: string): void;
  terminate(): void;
  close(code?: number, reason?: string): void;
};
type WireServer = EventEmitter & {
  address(): { port: number };
  close(done: () => void): void;
  clients: Set<Socket>;
};
const { WebSocketServer } = createRequire(import.meta.url)("ws") as {
  WebSocketServer: new (options: { host: string; port: number }) => WireServer;
};
const TOKEN = "synthetic-chat-wire-token";
type Request = { id: string; method: string; params: Record<string, unknown> };

// This local protocol fixture exercises OpenClaw's official GatewayClient.
// It does not start a native agent or contact a model/provider.
async function wireFixture(
  options: {
    role?: string;
    scopes?: string[];
    noChallenge?: boolean;
    rejectAuth?: boolean;
    startupRetry?: boolean;
    onRequest?: (request: Request, socket: Socket) => unknown;
  } = {},
) {
  const requests: Request[] = [];
  let connections = 0;
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  server.on("connection", (socket: Socket) => {
    connections++;
    socket.on("message", (raw: { toString(): string }) => {
      const request = JSON.parse(raw.toString()) as Request;
      requests.push(request);
      let payload: unknown;
      if (request.method === "connect") {
        if (options.startupRetry) {
          socket.close(1013, TOKEN);
          return;
        }
        if (options.rejectAuth) {
          socket.send(
            JSON.stringify({
              type: "res",
              id: request.id,
              ok: false,
              error: { code: "INVALID_REQUEST", message: TOKEN },
            }),
          );
          return;
        }
        payload = {
          type: "hello-ok",
          protocol: 4,
          server: {
            version: "synthetic-wire",
            connId: "fixture-chat-connection",
          },
          features: {
            methods: [
              "sessions.create",
              "chat.send",
              "agent.wait",
              "chat.history",
              "sessions.describe",
              "chat.abort",
            ],
            events: [],
          },
          snapshot: {
            presence: [],
            health: {},
            stateVersion: { presence: 0, health: 0 },
            uptimeMs: 1,
          },
          auth: {
            method: "token",
            role: options.role ?? "operator",
            scopes: options.scopes ?? ["operator.read", "operator.write"],
          },
          policy: {
            maxPayload: 1000000,
            maxBufferedBytes: 1000000,
            tickIntervalMs: 30000,
          },
        };
      } else payload = options.onRequest?.(request, socket);
      if (payload !== undefined)
        socket.send(
          JSON.stringify({ type: "res", id: request.id, ok: true, payload }),
        );
    });
    if (!options.noChallenge)
      socket.send(
        JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "fixture-nonce", ts: Date.now() },
        }),
      );
  });
  return {
    url: `ws://127.0.0.1:${server.address().port}`,
    requests,
    connections: () => connections,
    openSockets: () => server.clients.size,
    close: async () => {
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve) => server.close(resolve));
    },
  };
}

function safeFailure(url: string) {
  return (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes(TOKEN), false);
    assert.equal(error.message.includes(url), false);
    assert.equal(error.message.includes("private server detail"), false);
    return true;
  };
}

test("NATIVE CHAT CONNECTION: rejects remote or ambiguous targets and invalid tokens before connecting", async () => {
  for (const url of [
    "ws://example.com:1234",
    "wss://127.0.0.1:1234",
    "ws://localhost:1234",
    "ws://127.0.0.1:1234/private",
    "ws://127.0.0.1:1234/?token=hidden",
    "ws://user:password@127.0.0.1:1234",
    "ws://127.0.0.1:1234/#secret",
  ])
    await assert.rejects(async () => {
      const connection = new NativeChatConnection({ url, token: TOKEN });
      try {
        await connection.request("sessions.describe", {});
      } finally {
        await connection.close();
      }
    });
  for (const token of ["", " ", "line\nbreak", "x".repeat(16385)])
    await assert.rejects(async () => {
      const connection = new NativeChatConnection({
        url: "ws://127.0.0.1:1234",
        token,
      });
      try {
        await connection.request("sessions.describe", {});
      } finally {
        await connection.close();
      }
    });
});

test("NATIVE CHAT CONNECTION: one authenticated socket carries exact native session and run requests", async () => {
  const fixture = await wireFixture({
    onRequest: (request) => ({
      echoedMethod: request.method,
      receipt: request.params,
    }),
  });
  const connection = new NativeChatConnection({
    url: fixture.url,
    token: TOKEN,
  });
  try {
    assert.equal(
      fixture.connections(),
      0,
      "Constructing a client must not connect.",
    );
    const created = { key: "agent:main:explicit:one", agentId: "main" };
    assert.deepEqual(await connection.request("sessions.create", created), {
      echoedMethod: "sessions.create",
      receipt: created,
    });
    const submitted = {
      sessionKey: created.key,
      agentId: "main",
      message: "Labelled protocol fixture.",
      idempotencyKey: "fixture-single-admission",
      deliver: false,
      thinking: "off",
      timeoutMs: 60000,
    };
    await connection.request("chat.send", submitted);
    await connection.request("agent.wait", {
      runId: "fixture-run",
      timeoutMs: 1000,
    });
    await connection.request("chat.history", {
      sessionKey: created.key,
      limit: 50,
    });
    assert.equal(fixture.connections(), 1);
    assert.deepEqual(
      fixture.requests.map((request) => request.method),
      ["connect", "sessions.create", "chat.send", "agent.wait", "chat.history"],
    );
    assert.deepEqual(fixture.requests[2]?.params, submitted);
    const connect = fixture.requests[0]?.params;
    assert.equal(connect?.role, "operator");
    assert.deepEqual(connect?.scopes, ["operator.read", "operator.write"]);
    assert.deepEqual(connect?.auth, { token: TOKEN });
    assert.equal(connect?.device, undefined);
    const client = connect?.client as { id?: string; mode?: string };
    assert.equal(client.id, "cli");
    assert.equal(client.mode, "cli");
  } finally {
    await connection.close();
    await fixture.close();
  }
});

test("NATIVE CHAT CONNECTION: denied role or missing granted authority cannot dispatch", async () => {
  for (const grant of [
    { role: "node" },
    { scopes: ["operator.write"] },
    { scopes: ["operator.read"] },
  ]) {
    const fixture = await wireFixture(grant);
    const connection = new NativeChatConnection({
      url: fixture.url,
      token: TOKEN,
    });
    try {
      await assert.rejects(
        connection.request("chat.send", { message: "Never dispatch." }),
      );
      assert.deepEqual(
        fixture.requests.map((request) => request.method),
        ["connect"],
      );
      assert.equal(fixture.connections(), 1);
    } finally {
      await connection.close();
      await fixture.close();
    }
  }
});

test("NATIVE CHAT CONNECTION: rejected authentication is sanitized and never reconnects or sends RPC", async () => {
  const fixture = await wireFixture({ rejectAuth: true });
  const connection = new NativeChatConnection({
    url: fixture.url,
    token: TOKEN,
  });
  try {
    await assert.rejects(
      connection.request("chat.send", {}),
      safeFailure(fixture.url),
    );
    await assert.rejects(
      connection.request("chat.send", {}),
      safeFailure(fixture.url),
    );
    await delay(1200);
    assert.equal(fixture.connections(), 1);
    assert.deepEqual(
      fixture.requests.map((request) => request.method),
      ["connect"],
    );
  } finally {
    await connection.close();
    await fixture.close();
  }
});

test("NATIVE CHAT CONNECTION: an interrupted paid-operation acknowledgement cannot be replayed", async () => {
  const fixture = await wireFixture({
    onRequest: (_, socket) => socket.terminate(),
  });
  const connection = new NativeChatConnection({
    url: fixture.url,
    token: TOKEN,
  });
  try {
    await assert.rejects(
      connection.request("chat.send", { idempotencyKey: "once-only" }),
      safeFailure(fixture.url),
    );
    await assert.rejects(
      connection.request("chat.send", { idempotencyKey: "once-only" }),
      safeFailure(fixture.url),
    );
    await delay(1200);
    assert.equal(fixture.connections(), 1);
    assert.deepEqual(
      fixture.requests.map((request) => request.method),
      ["connect", "chat.send"],
    );
  } finally {
    await connection.close();
    await fixture.close();
  }
});

test("NATIVE CHAT CONNECTION: a startup-retry close cannot trigger a hidden reconnect", async () => {
  const fixture = await wireFixture({ startupRetry: true });
  const connection = new NativeChatConnection({
    url: fixture.url,
    token: TOKEN,
  });
  try {
    await assert.rejects(
      connection.request("chat.send", {}),
      safeFailure(fixture.url),
    );
    await delay(1200);
    assert.equal(fixture.connections(), 1);
    assert.deepEqual(
      fixture.requests.map((request) => request.method),
      ["connect"],
    );
  } finally {
    await connection.close();
    await fixture.close();
  }
});

test("NATIVE CHAT CONNECTION: native error details stay private and no RPC is retried", async () => {
  const fixture = await wireFixture({
    onRequest: (request, socket) => {
      socket.send(
        JSON.stringify({
          type: "res",
          id: request.id,
          ok: false,
          error: {
            code: "INVALID_REQUEST",
            message: `${TOKEN} private server detail`,
          },
        }),
      );
    },
  });
  const connection = new NativeChatConnection({
    url: fixture.url,
    token: TOKEN,
  });
  try {
    await assert.rejects(
      connection.request("chat.send", {}),
      safeFailure(fixture.url),
    );
    assert.equal(fixture.connections(), 1);
    assert.deepEqual(
      fixture.requests.map((request) => request.method),
      ["connect", "chat.send"],
    );
  } finally {
    await connection.close();
    await fixture.close();
  }
});

test("NATIVE CHAT CONNECTION: missing handshake has a finite deadline and closes without dispatch", {
  timeout: 6000,
}, async () => {
  const fixture = await wireFixture({ noChallenge: true });
  const connection = new NativeChatConnection({
    url: fixture.url,
    token: TOKEN,
  });
  try {
    const started = Date.now();
    await assert.rejects(
      connection.request("chat.send", {}, 1000),
      safeFailure(fixture.url),
    );
    assert.ok(Date.now() - started < 2500);
    await delay(1200);
    assert.equal(fixture.connections(), 1);
    assert.deepEqual(fixture.requests, []);
  } finally {
    await connection.close();
    await fixture.close();
  }
});

test("NATIVE CHAT CONNECTION: response deadline holds the unknown outcome without reconnect or resend", {
  timeout: 6000,
}, async () => {
  const fixture = await wireFixture();
  const connection = new NativeChatConnection({
    url: fixture.url,
    token: TOKEN,
  });
  try {
    const started = Date.now();
    await assert.rejects(
      connection.request("chat.send", { idempotencyKey: "once-only" }, 1000),
      safeFailure(fixture.url),
    );
    assert.ok(Date.now() - started < 2500);
    await assert.rejects(
      connection.request("chat.send", {}),
      safeFailure(fixture.url),
    );
    await delay(1200);
    assert.equal(fixture.connections(), 1);
    assert.deepEqual(
      fixture.requests.map((request) => request.method),
      ["connect", "chat.send"],
    );
  } finally {
    await connection.close();
    await fixture.close();
  }
});

test("NATIVE CHAT CONNECTION: explicit close cancels pending work and prevents later dispatch", async () => {
  let acknowledgeRequest = () => {};
  const seen = new Promise<void>((resolve) => {
    acknowledgeRequest = resolve;
  });
  const fixture = await wireFixture({ onRequest: () => acknowledgeRequest() });
  const connection = new NativeChatConnection({
    url: fixture.url,
    token: TOKEN,
  });
  try {
    const pending = assert.rejects(
      connection.request("chat.send", {}),
      safeFailure(fixture.url),
    );
    await seen;
    await connection.close();
    await pending;
    await connection.close();
    await assert.rejects(
      connection.request("chat.send", {}),
      safeFailure(fixture.url),
    );
    assert.equal(fixture.openSockets(), 0);
    assert.equal(fixture.connections(), 1);
    assert.deepEqual(
      fixture.requests.map((request) => request.method),
      ["connect", "chat.send"],
    );
  } finally {
    await connection.close();
    await fixture.close();
  }
});

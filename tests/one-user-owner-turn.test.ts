import assert from "node:assert/strict";
import { type EventEmitter, once } from "node:events";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
  oneUserFollowupOwnerTurn,
  oneUserOwnerTurn,
  probeOneUserOwnerConnection,
} from "../src/one-user-owner-turn.ts";

type Socket = EventEmitter & {
  send(value: string): void;
  terminate(): void;
};
type WireServer = EventEmitter & {
  address(): { port: number };
  close(done: () => void): void;
  clients: Set<Socket>;
};
const { WebSocketServer } = createRequire(import.meta.url)("ws") as {
  WebSocketServer: new (options: { host: string; port: number }) => WireServer;
};
const TOKEN = "synthetic-owner-wire-token";
type Request = { id: string; method: string; params: Record<string, unknown> };

// This synthetic protocol server exercises the official native client. Its grants
// and replies are test fixtures, never evidence of a real operator or model run.
async function wireFixture(
  options: {
    role?: string;
    scopes?: string[];
    noChallenge?: boolean;
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
        payload = {
          type: "hello-ok",
          protocol: 3,
          server: {
            version: "synthetic-wire",
            connId: "fixture-owner-connection",
          },
          features: {
            methods: ["chat.send", "agent.wait", "chat.abort"],
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
            scopes: options.scopes ?? ["operator.admin"],
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
    close: async () => {
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve) => server.close(resolve));
    },
  };
}

test("OWNER CONNECTION: rejects non-loopback or ambiguous targets and non-main input before connecting", async () => {
  for (const url of [
    "ws://example.com:1234",
    "http://127.0.0.1:1234",
    "ws://localhost:1234",
    "ws://127.0.0.1:1234/?token=hidden",
    "ws://user:password@127.0.0.1:1234",
  ])
    await assert.rejects(
      probeOneUserOwnerConnection({ url, token: TOKEN }),
      /loopback/,
    );
  await assert.rejects(
    oneUserOwnerTurn({
      url: "ws://127.0.0.1:1234",
      token: TOKEN,
      sessionKey: "agent:main:other",
      message: "ACK",
    }),
    /fixed main/,
  );
  await assert.rejects(
    probeOneUserOwnerConnection({ url: "ws://127.0.0.1:1234", token: " " }),
    /explicit Gateway token/,
  );
});

test("OWNER CONNECTION: handshake-only probe verifies granted authority and sends no RPC", async () => {
  const fixture = await wireFixture();
  try {
    const receipt = await probeOneUserOwnerConnection({
      url: fixture.url,
      token: TOKEN,
    });
    assert.equal(receipt.role, "operator");
    assert.deepEqual(receipt.scopes, ["operator.admin"]);
    assert.equal(receipt.connectionId, "fixture-owner-connection");
    assert.ok(Date.parse(receipt.verifiedAt) >= Date.parse(receipt.startedAt));
    assert.equal(JSON.stringify(receipt).includes(TOKEN), false);
    assert.deepEqual(
      fixture.requests.map((request) => request.method),
      ["connect"],
    );
    const connect = fixture.requests[0]?.params;
    assert.ok(connect);
    assert.equal(connect?.role, "operator");
    assert.deepEqual(connect?.scopes, ["operator.admin"]);
    assert.equal((connect.auth as { token: string }).token, TOKEN);
  } finally {
    await fixture.close();
  }
});

test("OWNER TURN: server role and granted admin scope are required before any chat", async () => {
  for (const grant of [{ role: "node" }, { scopes: ["operator.write"] }]) {
    const fixture = await wireFixture(grant);
    try {
      await assert.rejects(
        oneUserOwnerTurn({
          url: fixture.url,
          token: TOKEN,
          sessionKey: "agent:main:main",
          message: "ACK",
        }),
        /did not receive operator.admin/,
      );
      assert.deepEqual(
        fixture.requests.map((request) => request.method),
        ["connect"],
      );
      assert.equal(fixture.connections(), 1);
    } finally {
      await fixture.close();
    }
  }
});

test("OWNER TURN: one authenticated chat is followed by native wait results, never an owner payload field", async () => {
  let waits = 0;
  const fixture = await wireFixture({
    onRequest: (request) => {
      if (request.method === "chat.send")
        return { runId: "fixture-native-run" };
      if (request.method === "agent.wait")
        return ++waits === 1
          ? { status: "pending" }
          : { status: "ok", terminalReply: { text: "ACK" } };
      throw new Error("Unexpected synthetic native method.");
    },
  });
  try {
    const result = await oneUserOwnerTurn({
      url: fixture.url,
      token: TOKEN,
      sessionKey: "agent:main:main",
      message: "ACK",
    });
    assert.deepEqual(
      fixture.requests.map((request) => request.method),
      ["connect", "chat.send", "agent.wait", "agent.wait"],
    );
    assert.equal(result.ownerConnection.role, "operator");
    assert.equal(result.accepted.runId, "fixture-native-run");
    assert.equal(result.completion.status, "ok");
    const params = fixture.requests[1]?.params;
    assert.equal(params?.sessionKey, "agent:main:main");
    assert.equal(params?.senderIsOwner, undefined);
    assert.equal(params?.inputProvenance, undefined);
    assert.equal(params?.deliver, false);
    assert.equal(fixture.connections(), 1);
  } finally {
    await fixture.close();
  }
});

test("OWNER TURN: failed native completion aborts that exact run once and never retries inference", async () => {
  const fixture = await wireFixture({
    onRequest: (request) => {
      if (request.method === "chat.send")
        return { runId: "fixture-failed-run" };
      if (request.method === "agent.wait")
        return { status: "error", error: TOKEN };
      if (request.method === "chat.abort") return { aborted: true };
    },
  });
  try {
    await assert.rejects(
      oneUserOwnerTurn({
        url: fixture.url,
        token: TOKEN,
        sessionKey: "agent:main:main",
        message: "ACK",
      }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /no inference retry/);
        assert.equal(error.message.includes(TOKEN), false);
        return true;
      },
    );
    assert.deepEqual(
      fixture.requests.map((request) => request.method),
      ["connect", "chat.send", "agent.wait", "chat.abort"],
    );
    assert.equal(fixture.requests.at(-1)?.params.runId, "fixture-failed-run");
  } finally {
    await fixture.close();
  }
});

test("OWNER CONNECTION: absolute handshake timeout closes the client without reconnecting or chatting", async () => {
  const fixture = await wireFixture({ noChallenge: true });
  try {
    await assert.rejects(
      probeOneUserOwnerConnection({
        url: fixture.url,
        token: TOKEN,
        timeoutMs: 1000,
      }),
      /absolute deadline/,
    );
    assert.deepEqual(fixture.requests, []);
    assert.equal(fixture.connections(), 1);
  } finally {
    await fixture.close();
  }
});

test("OWNER TURN: accepted-run timeout aborts that exact run before closing without an inference replay", async () => {
  const fixture = await wireFixture({
    onRequest: (request) => {
      if (request.method === "chat.send") return { runId: "fixture-timed-run" };
      if (request.method === "agent.wait") return undefined;
      if (request.method === "chat.abort") return { aborted: true };
    },
  });
  try {
    const startedAt = Date.now();
    await assert.rejects(
      oneUserOwnerTurn({
        url: fixture.url,
        token: TOKEN,
        sessionKey: "agent:main:main",
        message: "ACK",
        timeoutMs: 1000,
      }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /absolute deadline|no inference retry/);
        assert.equal(error.message.includes(TOKEN), false);
        return true;
      },
    );
    assert.ok(Date.now() - startedAt < 2200);
    assert.deepEqual(
      fixture.requests.map((request) => request.method),
      ["connect", "chat.send", "agent.wait", "chat.abort"],
    );
    assert.equal(fixture.requests.at(-1)?.params.runId, "fixture-timed-run");
    assert.equal(fixture.connections(), 1);
  } finally {
    await fixture.close();
  }
});

test("FOLLOW-UP OWNER TURN: only the two fresh fixed children are permitted and existing main scope stays separate", async () => {
  for (const sessionKey of [
    "agent:main:main",
    "agent:main:other",
    "owner-followup",
  ])
    await assert.rejects(
      oneUserFollowupOwnerTurn({
        url: "ws://127.0.0.1:1234",
        token: TOKEN,
        sessionKey,
        message: "ACK",
      }),
      /fixed fresh session/,
    );
  for (const sessionKey of [
    "agent:main:owner-followup",
    "agent:main:followup-recall",
  ]) {
    await assert.rejects(
      oneUserOwnerTurn({
        url: "ws://127.0.0.1:1234",
        token: TOKEN,
        sessionKey,
        message: "ACK",
      }),
      /fixed main/,
    );
    const fixture = await wireFixture({
      onRequest: (request) =>
        request.method === "chat.send"
          ? { runId: "fixture-followup-run" }
          : { status: "ok", terminalReply: { text: "ACK" } },
    });
    try {
      const result = await oneUserFollowupOwnerTurn({
        url: fixture.url,
        token: TOKEN,
        sessionKey,
        message: "ACK",
      });
      assert.equal(result.ownerConnection.role, "operator");
      assert.deepEqual(
        fixture.requests.map((request) => request.method),
        ["connect", "chat.send", "agent.wait"],
      );
      assert.equal(fixture.requests[1]?.params.sessionKey, sessionKey);
      assert.equal(fixture.requests[1]?.params.senderIsOwner, undefined);
      assert.equal(fixture.connections(), 1);
    } finally {
      await fixture.close();
    }
  }
});

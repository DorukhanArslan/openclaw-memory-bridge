import { randomBytes } from "node:crypto";
import { GatewayClient } from "openclaw/plugin-sdk/gateway-runtime";

const MAIN_SESSION = "agent:main:main";
const ADMIN_SCOPE = "operator.admin";
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export type OneUserOwnerConnectionOptions = {
  url: string;
  token: string;
  timeoutMs?: number;
};
export type OneUserOwnerTurnOptions = OneUserOwnerConnectionOptions & {
  sessionKey: string;
  message: string;
};
export type OwnerConnectionReceipt = {
  transport: "official native GatewayClient";
  role: "operator";
  scopes: string[];
  authenticationMethod: string | null;
  protocol: number;
  serverVersion: string;
  connectionId: string;
  startedAt: string;
  verifiedAt: string;
};

function validateConnection(options: OneUserOwnerConnectionOptions) {
  let target: URL;
  try {
    target = new URL(options.url);
  } catch {
    throw new Error(
      "One-user owner connection requires a loopback WebSocket URL.",
    );
  }
  if (
    target.protocol !== "ws:" ||
    !["127.0.0.1", "[::1]"].includes(target.hostname) ||
    !target.port ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== "/"
  )
    throw new Error(
      "One-user owner connection requires a loopback WebSocket URL.",
    );
  if (!options.token.trim() || options.token.length > 8192)
    throw new Error(
      "One-user owner connection requires its explicit Gateway token.",
    );
  const timeoutMs = options.timeoutMs ?? 200000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 240000)
    throw new Error(
      "One-user owner connection deadline is outside its finite bound.",
    );
  return timeoutMs;
}

async function withOwnerConnection<T>(
  options: OneUserOwnerConnectionOptions,
  action: (
    client: GatewayClient,
    receipt: OwnerConnectionReceipt,
    remaining: () => number,
  ) => Promise<T>,
  beforeStop?: (client: GatewayClient) => Promise<void>,
): Promise<T> {
  const timeoutMs = validateConnection(options);
  const startedAtMs = Date.now();
  const deadline = startedAtMs + timeoutMs;
  let finished = false;
  let client: GatewayClient | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectConnection: (error: Error) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    rejectConnection = reject;
    timer = setTimeout(() => {
      reject(
        new Error("One-user owner connection exceeded its absolute deadline."),
      );
    }, timeoutMs);
  });
  let resolveReady: (receipt: OwnerConnectionReceipt) => void = () => {};
  const ready = new Promise<OwnerConnectionReceipt>((resolve) => {
    resolveReady = resolve;
  });
  const fail = (message: string) => {
    if (finished) return;
    rejectConnection(new Error(message));
    client?.stop();
  };
  const remaining = () => {
    const value = deadline - Date.now();
    if (value <= 0)
      throw new Error(
        "One-user owner connection exceeded its absolute deadline.",
      );
    return value;
  };
  try {
    client = new GatewayClient({
      url: options.url,
      token: options.token,
      role: "operator",
      scopes: [ADMIN_SCOPE],
      clientName: "cli",
      mode: "cli",
      clientDisplayName: "One-user bounded owner turn",
      deviceIdentity: null,
      sharedStateMode: "read-only",
      env: {},
      requestTimeoutMs: Math.min(30000, timeoutMs),
      hostDeps: {
        logDebug: () => {},
        logError: () => {},
        redactForLog: () =>
          "One-user native Gateway transport message redacted.",
      },
      onHelloOk: (hello) => {
        if (
          hello.auth.role !== "operator" ||
          !hello.auth.scopes.includes(ADMIN_SCOPE)
        ) {
          fail(
            "One-user owner connection did not receive operator.admin authority.",
          );
          return;
        }
        resolveReady({
          transport: "official native GatewayClient",
          role: "operator",
          scopes: [...hello.auth.scopes],
          authenticationMethod: hello.auth.method ?? null,
          protocol: hello.protocol,
          serverVersion: hello.server.version,
          connectionId: hello.server.connId,
          startedAt: new Date(startedAtMs).toISOString(),
          verifiedAt: new Date().toISOString(),
        });
      },
      onConnectError: () =>
        fail("One-user owner connection authentication failed."),
      onReconnectPaused: () =>
        fail("One-user owner connection was interrupted."),
      onClose: () => fail("One-user owner connection was interrupted."),
    });
    client.start();
    const activeClient = client;
    return await Promise.race([
      ready.then((receipt) => action(activeClient, receipt, remaining)),
      interrupted,
    ]);
  } finally {
    finished = true;
    if (timer) clearTimeout(timer);
    if (client) {
      // Reserve a separate finite cleanup window after the operation deadline.
      // Keep the authenticated socket available for one exact-run abort first.
      try {
        await beforeStop?.(client);
      } finally {
        await client
          .stopAndWait({ timeoutMs: 500 })
          .catch(() =>
            Promise.reject(
              new Error("One-user owner connection cleanup failed."),
            ),
          );
      }
    }
  }
}

/** Authenticate and verify the server grant; this probe sends no RPC or model request. */
export function probeOneUserOwnerConnection(
  options: OneUserOwnerConnectionOptions,
): Promise<OwnerConnectionReceipt> {
  return withOwnerConnection(options, async (_, receipt) => receipt);
}

/** Fixed main-session turn with genuine server-granted owner authority. No owner payload fields. */
export async function oneUserOwnerTurn(options: OneUserOwnerTurnOptions) {
  if (options.sessionKey !== MAIN_SESSION)
    throw new Error(
      "One-user owner turn requires the fixed main session and bounded input.",
    );
  return fixedOwnerTurn(options);
}

/** The separately admitted follow-up has only these two fresh session targets. */
export async function oneUserFollowupOwnerTurn(
  options: OneUserOwnerTurnOptions,
) {
  if (
    !["agent:main:owner-followup", "agent:main:followup-recall"].includes(
      options.sessionKey,
    )
  )
    throw new Error(
      "One-user follow-up owner turn requires a fixed fresh session.",
    );
  return fixedOwnerTurn(options);
}

async function fixedOwnerTurn(options: OneUserOwnerTurnOptions) {
  if (!options.message.trim() || Buffer.byteLength(options.message) > 64000)
    throw new Error(
      "One-user owner turn requires the fixed main session and bounded input.",
    );
  let inFlightRunId: string | undefined;
  return withOwnerConnection(
    options,
    async (client, ownerConnection, remaining) => {
      try {
        const accepted = await client.request(
          "chat.send",
          {
            sessionKey: options.sessionKey,
            agentId: "main",
            message: options.message,
            idempotencyKey: randomBytes(16).toString("hex"),
            deliver: false,
            thinking: "off",
            timeoutMs: Math.min(180000, remaining()),
          },
          { timeoutMs: Math.min(30000, remaining()) },
        );
        if (
          !record(accepted) ||
          typeof accepted.runId !== "string" ||
          !accepted.runId
        )
          throw new Error(
            "One-user owner turn did not receive a native run identity.",
          );
        inFlightRunId = accepted.runId;
        while (remaining() > 0) {
          const completion = await client.request(
            "agent.wait",
            {
              runId: inFlightRunId,
              timeoutMs: Math.min(10000, remaining()),
            },
            { timeoutMs: Math.min(15000, remaining()) },
          );
          if (
            record(completion) &&
            ["pending", "timeout"].includes(String(completion.status))
          )
            continue;
          if (!record(completion) || completion.status !== "ok")
            throw new Error(
              "One-user owner turn did not complete successfully.",
            );
          inFlightRunId = undefined;
          return { ownerConnection, accepted, completion };
        }
        throw new Error("One-user owner turn exceeded its absolute deadline.");
      } catch {
        throw new Error(
          "One-user owner turn failed; no inference retry is permitted.",
        );
      }
    },
    async (client) => {
      const runId = inFlightRunId;
      inFlightRunId = undefined;
      if (runId)
        await client
          .request(
            "chat.abort",
            { sessionKey: options.sessionKey, agentId: "main", runId },
            { timeoutMs: 500 },
          )
          .catch(() => {});
    },
  );
}

import { GatewayClient } from "openclaw/plugin-sdk/gateway-runtime";

const SCOPES = ["operator.read", "operator.write"];

/** One authenticated native chat socket. A failed request is never replayed. */
export class NativeChatConnection {
  private client?: GatewayClient;
  private ready?: Promise<void>;
  private rejectReady?: (error: Error) => void;
  private failure?: Error;
  private closing?: Promise<void>;
  private readonly url: string;
  private readonly token: string;

  constructor(options: { url: string; token: string }) {
    let target: URL;
    try {
      target = new URL(options.url);
    } catch {
      throw new Error("Native chat requires a loopback WebSocket URL.");
    }
    if (
      target.protocol !== "ws:" ||
      !["127.0.0.1", "[::1]"].includes(target.hostname) ||
      !target.port ||
      target.pathname !== "/" ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    )
      throw new Error("Native chat requires a loopback WebSocket URL.");
    if (
      typeof options.token !== "string" ||
      !options.token ||
      options.token.length > 4096 ||
      /[^\x21-\x7e]/.test(options.token)
    )
      throw new Error("Native chat requires an explicit Gateway token.");
    this.url = target.href;
    this.token = options.token;
  }

  private fail(message: string) {
    if (this.failure) return;
    // Set the terminal state before stop() invokes native close callbacks.
    this.failure = new Error(message);
    this.rejectReady?.(this.failure);
    this.client?.stop();
  }

  get closed(): boolean {
    return this.failure !== undefined;
  }

  private connect(): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    this.ready ??= new Promise<void>((resolve, reject) => {
      this.rejectReady = reject;
      this.client = new GatewayClient({
        url: this.url,
        token: this.token,
        role: "operator",
        scopes: [...SCOPES],
        clientName: "cli",
        mode: "cli",
        clientDisplayName: "Memory Chat",
        deviceIdentity: null,
        sharedStateMode: "read-only",
        env: {},
        requestTimeoutMs: 30000,
        notifyOnStartupRetry: true,
        hostDeps: {
          logDebug: () => {},
          logError: () => {},
          redactForLog: () => "Native chat transport message redacted.",
        },
        onHelloOk: (hello) => {
          if (
            hello.auth?.role !== "operator" ||
            !Array.isArray(hello.auth.scopes) ||
            !SCOPES.every((scope) => hello.auth.scopes.includes(scope))
          ) {
            this.fail(
              "Native chat Gateway did not grant read/write authority.",
            );
            return;
          }
          resolve();
        },
        onConnectError: () =>
          this.fail("Native chat Gateway authentication or connection failed."),
        onReconnectPaused: () =>
          this.fail("Native chat Gateway connection was interrupted."),
        onClose: () =>
          this.fail("Native chat Gateway connection was interrupted."),
      });
      this.client.start();
    });
    return this.ready;
  }

  async request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 30000,
  ): Promise<unknown> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
      throw new Error(
        "Native chat request requires a finite bounded deadline.",
      );
    if (this.failure) throw this.failure;
    const deadline = Date.now() + timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.connect().then(() => {
          if (this.failure) throw this.failure;
          if (Date.now() >= deadline) {
            this.fail(
              "Native chat Gateway request timed out; it was not replayed.",
            );
            throw this.failure;
          }
          return this.client?.request(method, params, {
            timeoutMs: deadline - Date.now(),
          });
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            this.fail(
              "Native chat Gateway request timed out; it was not replayed.",
            );
            reject(this.failure);
          }, timeoutMs);
        }),
      ]);
    } catch {
      // Native errors can contain server payloads, credentials and URL details.
      this.fail("Native chat Gateway request failed; it was not replayed.");
      throw this.failure;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  close(): Promise<void> {
    this.fail("Native chat Gateway connection is closed.");
    this.closing ??= this.client
      ? this.client.stopAndWait({ timeoutMs: 1000 }).catch(() => {
          throw new Error("Native chat Gateway connection cleanup failed.");
        })
      : Promise.resolve();
    return this.closing;
  }
}

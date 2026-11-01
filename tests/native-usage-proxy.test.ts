import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect, type Server, type Socket } from "node:net";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { inspectBudget, PAID_SELECTION } from "../src/budget-preflight.ts";
import { Lab, PROJECT } from "../src/lab.ts";
import { createLifecycleLedger } from "../src/lifecycle-request-budget.ts";
import {
  isNativeUsageInvocation,
  startNativeUsageProxy,
  verifyNativeUsageProxyContracts,
} from "../src/native-usage-proxy.ts";

const execute = promisify(execFile);
const nativeDist = dirname(fileURLToPath(import.meta.resolve("openclaw")));
const entry = resolve(nativeDist, "../openclaw.mjs");
const usageArgs = [
  "status",
  "--usage",
  "--json",
  "--agent",
  "main",
  "--timeout",
  "10000",
];
const argv = [process.execPath, entry, ...usageArgs];
const networkKeys = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "OPENROUTER_API_KEY",
] as const;

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListening();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

test("QUOTA PROXY: only the exact private read-only native command is eligible", async () => {
  assert.equal(isNativeUsageInvocation(argv), true);
  for (const candidate of [
    [process.execPath, "/synthetic/other-entry.mjs", ...usageArgs],
    [process.execPath, entry, "config", "validate", "--json"],
    [process.execPath, entry, "memory", "index", "--force", "--agent", "main"],
    [process.execPath, entry, "gateway", "--port", "18789"],
    [...argv, "--extra"],
    [...argv.slice(0, -1), "20000"],
    argv.slice(0, -1),
  ]) {
    assert.equal(isNativeUsageInvocation(candidate), false);
    assert.equal(
      await startNativeUsageProxy(candidate, {
        HTTPS_PROXY: "http://synthetic.invalid:8080",
      }),
      undefined,
    );
  }
});

test("QUOTA PROXY: absent credentials/proxy and native NO_PROXY bypass do not activate routing", async () => {
  const originalFetch = globalThis.fetch;
  const active = process.env.OPENCLAW_PROXY_ACTIVE;
  assert.equal(await startNativeUsageProxy(argv, {}), undefined);
  assert.equal(
    await startNativeUsageProxy(argv, { OPENROUTER_API_KEY: "synthetic" }),
    undefined,
  );
  assert.equal(
    await startNativeUsageProxy(argv, {
      OPENROUTER_API_KEY: "synthetic",
      HTTPS_PROXY: "http://synthetic.invalid:8080",
      no_proxy: "openrouter.ai",
    }),
    undefined,
  );
  assert.equal(
    await startNativeUsageProxy(argv, {
      OPENROUTER_API_KEY: "synthetic",
      HTTP_PROXY: "http://synthetic.invalid:8080",
      http_proxy: "",
    }),
    undefined,
  );
  assert.equal(globalThis.fetch, originalFetch);
  assert.equal(process.env.OPENCLAW_PROXY_ACTIVE, active);
});

test("QUOTA PROXY: non-OpenRouter and custom origins stay outside the adapter", async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-quota-context-"));
  const configPath = join(root, "config.json");
  try {
    const source = {
      OPENROUTER_API_KEY: "synthetic",
      HTTPS_PROXY: "http://synthetic.invalid:8080",
      OPENCLAW_CONFIG_PATH: configPath,
    };
    for (const config of [
      {
        agents: { defaults: { model: { primary: "anthropic/synthetic" } } },
        models: { providers: { openrouter: {} } },
      },
      { agents: { defaults: { model: { primary: PAID_SELECTION.chat } } } },
      {
        agents: { defaults: { model: { primary: PAID_SELECTION.chat } } },
        models: {
          providers: { openrouter: { baseUrl: "https://custom.invalid/v1" } },
        },
      },
    ]) {
      await writeFile(configPath, JSON.stringify(config));
      assert.equal(await startNativeUsageProxy(argv, source), undefined);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("QUOTA PROXY: native implementation drift fails closed before routing", async () => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-quota-contracts-"));
  try {
    for (const name of [
      "proxy-env-DxV5eJIK.mjs",
      "proxy-lifecycle-DK10inkq.mjs",
      "proxy-lifecycle-Dl57fEmL.mjs",
    ])
      await copyFile(join(nativeDist, name), join(root, name));
    await verifyNativeUsageProxyContracts(root);
    await writeFile(
      join(root, "proxy-lifecycle-Dl57fEmL.mjs"),
      "Synthetic changed runtime; must not be imported.",
    );
    await assert.rejects(
      verifyNativeUsageProxyContracts(root),
      /Unverified native quota proxy runtime/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("NATIVE QUOTA PROXY: actual metadata CLI uses CONNECT, verifies CA, and retains weekly-budget denial", {
  timeout: 180000,
}, async (context) => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-quota-network-"));
  const original = Object.fromEntries(
    networkKeys.map((key) => [key, process.env[key]]),
  );
  const sockets = new Set<Socket>();
  const tunnels: string[] = [];
  const requests: Array<{
    method?: string;
    path?: string;
    syntheticAuth: boolean;
  }> = [];
  let lab: Lab | undefined;
  let origin: Server | undefined;
  let proxy: Server | undefined;
  try {
    const certificate = join(root, "synthetic-ca.pem");
    const key = join(root, "synthetic-private-key.pem");
    await execute(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-sha256",
        "-days",
        "1",
        "-keyout",
        key,
        "-out",
        certificate,
        "-subj",
        "/CN=openrouter.ai",
        "-addext",
        "subjectAltName=DNS:openrouter.ai",
      ],
      { timeout: 10000 },
    );
    origin = createHttpsServer(
      { cert: await readFile(certificate), key: await readFile(key) },
      (req, res) => {
        requests.push({
          method: req.method,
          path: req.url,
          syntheticAuth:
            req.headers.authorization === "Bearer synthetic-quota-key",
        });
        const data =
          req.url === "/api/v1/key"
            ? {
                limit: 50,
                limit_remaining: 50,
                usage: 0,
                limit_reset: "weekly",
              }
            : req.url === "/api/v1/credits"
              ? { total_credits: 50, total_usage: 0 }
              : null;
        res.writeHead(data ? 200 : 404, { "content-type": "application/json" });
        res.end(JSON.stringify({ data }));
      },
    );
    origin.on("tlsClientError", () => {});
    proxy = createHttpServer((_req, res) => res.writeHead(405).end());
    for (const server of [origin, proxy])
      server.on("connection", (socket: Socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
      });
    const originPort = await listen(origin);
    proxy.on("connect", (req, socket, head) => {
      if (req.url !== "openrouter.ai:443") {
        socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
        return;
      }
      tunnels.push(req.url);
      const upstream = connect(originPort, "127.0.0.1", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      sockets.add(upstream);
      upstream.on("close", () => sockets.delete(upstream));
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
      socket.on("close", () => upstream.destroy());
    });
    const proxyUrl = `http://127.0.0.1:${await listen(proxy)}`;
    for (const name of networkKeys) delete process.env[name];
    for (const name of [
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "http_proxy",
      "https_proxy",
    ])
      process.env[name] = proxyUrl;
    process.env.NO_PROXY = process.env.no_proxy = "127.0.0.1,localhost,::1";
    process.env.OPENROUTER_API_KEY = "synthetic-quota-key";
    lab = await new Lab("quota", root).init();
    await lab.configureNativeModel(PAID_SELECTION.chat, PAID_SELECTION.keyEnv);

    await context.test(
      "untrusted TLS sends no provider HTTP request",
      async () => {
        assert.ok(lab);
        const status = (await lab.providerUsage()) as {
          usage: { providers: Array<{ provider: string; error?: string }> };
        };
        assert.ok(tunnels.length > 0);
        assert.equal(requests.length, 0);
        assert.ok(
          status.usage.providers.find((p) => p.provider === "openrouter")
            ?.error,
        );
      },
    );
    await context.test(
      "startup CA enables only metadata, and periodic key stays ineligible",
      async () => {
        assert.ok(lab);
        process.env.NODE_EXTRA_CA_CERTS = certificate;
        const previousTunnels = tunnels.length;
        const status = (await lab.providerUsage()) as {
          usage: {
            providers: Array<{
              provider: string;
              error?: string;
              billing: Array<{ type: string; period?: string }>;
            }>;
          };
        };
        assert.ok(tunnels.length > previousTunnels);
        assert.equal(requests.length, 2);
        assert.ok(
          requests.every((req) => req.method === "GET" && req.syntheticAuth),
        );
        assert.deepEqual(requests.map((req) => req.path).sort(), [
          "/api/v1/credits",
          "/api/v1/key",
        ]);
        const provider = status.usage.providers.find(
          (p) => p.provider === "openrouter",
        );
        assert.ok(provider);
        assert.equal(provider.error, undefined);
        assert.equal(
          provider.billing.find((b) => b.type === "budget")?.period,
          "weekly",
        );
        assert.equal(
          inspectBudget(status, Date.now(), 50).code,
          "periodic_or_unknown_reset",
        );
        assert.equal(
          inspectBudget(status, Date.now(), 50).modelRequestsAllowed,
          false,
        );
      },
    );
    await context.test(
      "metadata with an active lifecycle ledger leaves its counters untouched",
      async () => {
        assert.ok(lab);
        const ledger = join(root, "quota-ledger.json");
        createLifecycleLedger(ledger);
        const before = await readFile(ledger, "utf8");
        const previousRequests = requests.length;
        // Exercise the same child environment used by afterBudget snapshots.
        Reflect.set(lab, "lifecycleLedger", ledger);
        try {
          const status = await lab.providerUsage();
          assert.equal(
            inspectBudget(status, Date.now(), 50).code,
            "periodic_or_unknown_reset",
          );
          assert.equal(await readFile(ledger, "utf8"), before);
          assert.equal(requests.length - previousRequests, 2);
          assert.ok(
            requests
              .slice(previousRequests)
              .every((req) => req.method === "GET" && req.syntheticAuth),
          );
        } finally {
          Reflect.set(lab, "lifecycleLedger", undefined);
        }
      },
    );
  } finally {
    try {
      await lab?.close();
    } finally {
      for (const name of networkKeys) {
        if (original[name] === undefined) delete process.env[name];
        else process.env[name] = original[name];
      }
      for (const socket of sockets) socket.destroy();
      for (const server of [origin, proxy])
        if (server)
          await new Promise<void>((resolveClose, reject) =>
            server.close((error) => (error ? reject(error) : resolveClose())),
          );
      await rm(root, { recursive: true, force: true });
    }
  }
});

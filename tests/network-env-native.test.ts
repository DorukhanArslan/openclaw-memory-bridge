import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { Lab, PROJECT } from "../src/lab.ts";

const execute = promisify(execFile);
const NETWORK_KEYS = [
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
] as const;
const HOST = "synthetic-embedding.invalid";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

test("NATIVE NETWORK: embedding CLI uses CONNECT and validates an inherited extra CA", {
  timeout: 180000,
}, async (context) => {
  const root = await mkdtemp(join(PROJECT, ".lab-test-network-env-"));
  const original = Object.fromEntries(
    NETWORK_KEYS.map((key) => [key, process.env[key]]),
  );
  const sockets = new Set<Socket>();
  const tunnels: string[] = [];
  const requests: Array<{ path: string; model: unknown; input: string[] }> = [];
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    const inputs = typeof body.input === "string" ? [body.input] : body.input;
    requests.push({ path: req.url ?? "", model: body.model, input: inputs });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        data: inputs.map((_input: string, index: number) => ({
          index,
          embedding: [1, 0, 0],
        })),
        model: "synthetic-embedding",
        usage: { prompt_tokens: 1, total_tokens: 1 },
      }),
    );
  };
  const servers: Server[] = [];
  let lab: Lab | undefined;
  try {
    const certificate = join(root, "synthetic-ca.pem");
    const key = join(root, "synthetic-key.pem");
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
        `/CN=${HOST}`,
        "-addext",
        `subjectAltName=DNS:${HOST}`,
      ],
      { timeout: 10000 },
    );
    const origin = createHttpsServer(
      {
        cert: await readFile(certificate),
        key: await readFile(key),
      },
      handler,
    );
    // Missing trust is an expected negative control, not a fixture server error.
    origin.on("tlsClientError", () => {});
    const plain = createHttpServer(handler);
    const proxy = createHttpServer((_req, res) => res.writeHead(405).end());
    servers.push(origin, plain, proxy);
    for (const server of servers)
      server.on("connection", (socket: Socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
      });
    const originPort = await listen(origin);
    const plainPort = await listen(plain);
    proxy.on("connect", (req, socket, head) => {
      if (req.url !== `${HOST}:443`) {
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
    for (const name of NETWORK_KEYS) delete process.env[name];
    for (const name of [
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "http_proxy",
      "https_proxy",
      "all_proxy",
    ])
      process.env[name] = proxyUrl;
    process.env.NO_PROXY = process.env.no_proxy = "127.0.0.1,localhost,::1";

    lab = await new Lab("network", root).init();
    await lab.configureVector(
      `http://127.0.0.1:${plainPort}/v1`,
      "synthetic-embedding",
    );
    await lab.writeNote(
      "source",
      "Synthetic cobalt labels are stored in the greenhouse.",
    );
    // The production no-key API accepts only HTTP loopback providers. Change
    // this isolated native config solely to exercise HTTPS through a local
    // CONNECT fixture. No key, paid admission flag, endpoint guard, or native
    // runtime is modified. The proxy accepts only this synthetic .invalid host.
    const config = JSON.parse(await readFile(lab.config, "utf8"));
    config.memory.search.remote.baseUrl = `https://${HOST}/v1`;
    await writeFile(lab.config, JSON.stringify(config));
    requests.length = 0;
    tunnels.length = 0;

    await context.test(
      "untrusted TLS cannot send an embedding body",
      async () => {
        assert.ok(lab);
        await assert.rejects(
          lab.index(),
          /certificate|self.signed|fetch failed|CERT_/i,
        );
        assert.ok(
          tunnels.length > 0,
          "The native child must reach the configured CONNECT proxy.",
        );
        assert.equal(
          requests.length,
          0,
          "TLS validation must reject before provider HTTP.",
        );
      },
    );
    await context.test(
      "startup extra CA enables native HTTPS indexing through the proxy",
      async () => {
        assert.ok(lab);
        process.env.NODE_EXTRA_CA_CERTS = certificate;
        const previousTunnels = tunnels.length;
        await lab.index();
        assert.ok(tunnels.length > previousTunnels);
        assert.ok(requests.length > 0);
        assert.ok(
          requests.every(
            (request) =>
              request.path === "/v1/embeddings" &&
              request.model === "synthetic-embedding",
          ),
        );
        assert.ok(
          requests.some((request) =>
            request.input.some((input) => input.includes("cobalt")),
          ),
        );
        const status = JSON.stringify(await lab.status());
        assert.match(status, /"chunks":[1-9]/);
        assert.match(status, /openai-compatible/);
      },
    );
  } finally {
    try {
      await lab?.close();
    } finally {
      for (const name of NETWORK_KEYS) {
        if (original[name] === undefined) delete process.env[name];
        else process.env[name] = original[name];
      }
      for (const socket of sockets) socket.destroy();
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => server.close(() => resolve())),
        ),
      );
      await rm(root, { recursive: true, force: true });
    }
  }
});

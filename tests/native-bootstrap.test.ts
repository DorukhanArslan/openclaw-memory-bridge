import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createLifecycleLedger } from "../src/lifecycle-request-budget.ts";

const project = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.resolve("openclaw"));
const { Agent } = nativeRequire("undici/index.js");
const run = promisify(execFile);

test("Finite lifecycle preload guards the actual native prepared Undici dispatch path before network", async () => {
  const root = await mkdtemp(join(tmpdir(), "native-ledger-"));
  const ledger = join(root, "ledger.json");
  createLifecycleLedger(ledger);
  const transport = new URL(
    "../node_modules/openclaw/dist/runtime-fetch-BCy08QFk.mjs",
    import.meta.url,
  ).href;
  try {
    await run(
      process.execPath,
      [
        "--import",
        join(project, "src/native-bootstrap.ts"),
        "--input-type=module",
        "-e",
        `
      import assert from 'node:assert/strict';
      import {n as nativeFetch} from ${JSON.stringify(transport)};
      await assert.rejects(nativeFetch('https://openrouter.ai/api/v1/chat/completions', {method:'post',body:new TextEncoder().encode(JSON.stringify({model:'denied',max_completion_tokens:1024}))}), /Finite lifecycle model/);
    `,
      ],
      {
        env: { PATH: process.env.PATH, OPENCLAW_LAB_LIFECYCLE_LEDGER: ledger },
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("NATIVE HTTP: reproduce Node/bundled dispatcher mismatch; private preload preserves guarded fetch", async () => {
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res
      .writeHead(200, { "content-type": "application/json" })
      .end('{"ok":true}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const agent = new Agent({ allowH2: false });
  try {
    await assert.rejects(
      globalThis.fetch(url, {
        dispatcher: agent,
        signal: AbortSignal.timeout(5000),
      } as RequestInit),
      (error: unknown) =>
        error instanceof Error &&
        (error.cause as { code?: string })?.code === "UND_ERR_INVALID_ARG",
    );
    assert.equal(requests, 0, "The broken pairing rejects before any request.");
    const guard = new URL(
      "../node_modules/openclaw/dist/fetch-guard-CERuBdTD.mjs",
      import.meta.url,
    ).href;
    const resolver = new URL(
      "../node_modules/openclaw/dist/fetch-CAgh9xby.mjs",
      import.meta.url,
    ).href;
    const program = `
      import {i as guardedFetch} from ${JSON.stringify(guard)};
      import {t as resolveFetch} from ${JSON.stringify(resolver)};
      for (const wrapped of [false,true]) {
        const result=await guardedFetch({url:${JSON.stringify(url)},fetchImpl:wrapped?resolveFetch():undefined,policy:{allowPrivateNetwork:true},timeoutMs:5000});
        const body=await result.response.json();
        await result.release();
        if(body.ok!==true)process.exit(2);
      }
      // Production SSRF checks remain in force; no network call may reach loopback.
      let rejected=false;
      try {await guardedFetch({url:${JSON.stringify(url)},timeoutMs:5000});} catch {rejected=true;}
      if(!rejected)process.exit(3);
      console.log(JSON.stringify({nativeHttp:true,ssrfPreserved:true}));
    `;
    const { stdout, stderr } = await run(
      join(project, "node_modules/node/bin/node"),
      [
        "--import",
        join(project, "src/native-bootstrap.ts"),
        "--input-type=module",
        "--eval",
        program,
      ],
      { env: { PATH: "/usr/bin:/bin" }, timeout: 20000 },
    );
    assert.deepEqual(JSON.parse(stdout), {
      nativeHttp: true,
      ssrfPreserved: true,
    });
    assert.doesNotMatch(stderr, /UND_ERR_INVALID_ARG/);
    assert.equal(requests, 2);
  } finally {
    await agent.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

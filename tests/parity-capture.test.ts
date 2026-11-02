import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { readTrace } from "../examples/parity/trace.ts";

const execute = promisify(execFile);
const capture = new URL("../examples/parity/capture.ts", import.meta.url).href;
const KEY = "synthetic-http-provider-key";
const TOKEN = "synthetic-http-gateway-token";
type RecordLine = {
  kind: string;
  data: Record<string, unknown>;
  sequence: number;
  operationId?: string;
};
const records = async (path: string): Promise<RecordLine[]> =>
  (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
async function fixture() {
  return mkdtemp(join(tmpdir(), "parity-http-trace-"));
}
async function child(
  root: string,
  program: string,
  options: { tape?: boolean; stub?: string; journal?: string } = {},
) {
  const args = options.stub ? ["--import", options.stub] : [];
  args.push("--import", capture, "--input-type=module", "-e", program);
  try {
    const result = await execute(process.execPath, args, {
      env: {
        PATH: "/usr/bin:/bin",
        LANG: "en_US.UTF-8",
        PARITY_JOURNAL_PATH: options.journal ?? join(root, "http.trace.jsonl"),
        PARITY_CAPTURE_ID: "synthetic-http-capture",
        ...(options.tape
          ? { PARITY_CAPTURE: join(root, "http.tape.jsonl") }
          : {}),
        OPENROUTER_API_KEY: KEY,
      },
      timeout: 20000,
      maxBuffer: 32768,
    });
    return { ...result, code: 0 };
  } catch (error) {
    const result = error as Error & {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      code: typeof result.code === "number" ? result.code : -1,
    };
  }
}
async function server(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const instance = createServer(handler);
  await new Promise<void>((resolve) =>
    instance.listen(0, "127.0.0.1", resolve),
  );
  const address = instance.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}/tools/invoke`,
    close: () =>
      new Promise<void>((resolve) => instance.close(() => resolve())),
  };
}
const request = (url: string, body: unknown) =>
  `fetch(new Request(${JSON.stringify(url)},{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer ${TOKEN}'},body:JSON.stringify(${JSON.stringify(body)})}))`;

test("PARITY HTTP: durable request precedes dispatch; exact tape and caller body survive observation", async () => {
  const root = await fixture();
  let requestWasDurable = false;
  const body = {
    tool: "memory_search",
    args: { query: "Synthetic orchid" },
    sessionKey: "agent:main:first",
  };
  const response = {
    ok: true,
    result: {
      results: [
        { path: "memory/orchid.md", score: 0.5 },
        { path: "memory/orchid.md", score: 0.5 },
      ],
    },
  };
  const wire = await server((req, res) => {
    requestWasDurable = readFileSync(
      join(root, "http.trace.jsonl"),
      "utf8",
    ).includes('"kind":"http.start"');
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      assert.deepEqual(JSON.parse(raw), body);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(response));
    });
  });
  try {
    const result = await child(
      root,
      `const r=await ${request(wire.url, body)}; const text=await r.text(); console.log(JSON.stringify({status:r.status,body:JSON.parse(text),bodyUsed:r.bodyUsed}));`,
      { tape: true },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 200,
      body: response,
      bodyUsed: true,
    });
    assert.equal(requestWasDurable, true);
    assert.deepEqual(
      (await readFile(join(root, "http.tape.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((x) => JSON.parse(x)),
      [{ request: body, response, status: 200 }],
    );
    const events = await records(join(root, "http.trace.jsonl"));
    assert.ok(
      events.findIndex((e) => e.kind === "http.start") <
        events.findIndex((e) => e.kind === "http.response"),
    );
    assert.ok(
      events.findIndex((e) => e.kind === "http.response") <
        events.findIndex((e) => e.kind === "http.result"),
    );
    assert.equal(readTrace(join(root, "http.trace.jsonl")).complete, true);
    assert.equal(
      (await stat(join(root, "http.trace.jsonl"))).mode & 0o777,
      0o600,
    );
    assert.equal(
      (await stat(join(root, "http.tape.jsonl"))).mode & 0o777,
      0o600,
    );
    const text = JSON.stringify(events);
    assert.equal(text.includes(TOKEN), false);
    assert.equal(text.includes("authorization"), false);
  } finally {
    await wire.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("PARITY HTTP: malformed, non-2xx and interrupted responses retain terminal evidence", async () => {
  const root = await fixture();
  let received = 0;
  const wire = await server((req, res) => {
    received++;
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const mode = JSON.parse(body).mode;
      if (mode === "disconnect") {
        req.socket.destroy();
        return;
      }
      if (mode === "malformed") {
        res.end('{"partial":');
        return;
      }
      res.statusCode = 403;
      res.end(JSON.stringify({ ok: false, error: { code: "denied" } }));
    });
  });
  try {
    const result = await child(
      root,
      `const outcomes=[];for(const mode of ['denied','malformed','disconnect']){try{const r=await fetch(${JSON.stringify(wire.url)},{method:'POST',body:JSON.stringify({mode})});outcomes.push({mode,status:r.status,body:await r.json()});}catch{outcomes.push({mode,error:true});}}console.log(JSON.stringify(outcomes));`,
      { tape: true },
    );
    assert.equal(result.code, 0, result.stderr);
    assert.equal(received, 3);
    assert.deepEqual(JSON.parse(result.stdout), [
      {
        mode: "denied",
        status: 403,
        body: { ok: false, error: { code: "denied" } },
      },
      { mode: "malformed", error: true },
      { mode: "disconnect", error: true },
    ]);
    const events = await records(join(root, "http.trace.jsonl"));
    assert.equal(events.filter((e) => e.kind === "http.start").length, 3);
    assert.ok(
      events.some(
        (e) =>
          e.kind === "http.response" && e.data.responseRaw === '{"partial":',
      ),
    );
    assert.ok(
      events.some(
        (e) => e.kind === "http.error" && e.data.kind === "malformed-json",
      ),
    );
    assert.ok(
      events.some(
        (e) =>
          e.kind === "http.error" &&
          e.data.kind === "network" &&
          e.data.status === null,
      ),
    );
    assert.equal(readTrace(join(root, "http.trace.jsonl")).complete, true);
    assert.equal(
      (await readFile(join(root, "http.tape.jsonl"), "utf8")).trim().split("\n")
        .length,
      1,
    );
  } finally {
    await wire.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("PARITY HTTP: invalid UTF-8 or interruption after headers cannot seal a complete body trace", async () => {
  for (const mode of ["invalid-utf8", "truncated"]) {
    const root = await fixture();
    let received = 0;
    const wire = await server((_req, res) => {
      received++;
      if (mode === "invalid-utf8") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(Buffer.from([0xc3, 0x28]));
        return;
      }
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": "100",
      });
      res.flushHeaders();
      res.write('{"partial":');
      setTimeout(() => res.destroy(), 200);
    });
    try {
      const result = await child(
        root,
        `try{await ${request(wire.url, { tool: "memory_get" })};}catch{console.log('blocked');}`,
        { tape: true },
      );
      assert.notEqual(result.code, 0, mode);
      assert.equal(result.stdout.trim(), "blocked", mode);
      assert.equal(received, 1);
      assert.equal(await readFile(join(root, "http.tape.jsonl"), "utf8"), "");
      const events = await records(join(root, "http.trace.jsonl"));
      const failure = events.find((event) => event.kind === "http.error");
      assert.equal(failure?.data.kind, "incomplete-body", mode);
      assert.equal(failure?.data.status, 200, mode);
      assert.equal(failure?.data.bodyComplete, false, mode);
      assert.equal(
        events.some((event) => event.kind === "http.response"),
        false,
      );
      assert.equal(
        events.some((event) => event.kind === "http.result"),
        false,
      );
      assert.equal(readTrace(join(root, "http.trace.jsonl")).complete, false);
    } finally {
      await wire.close();
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("PARITY HTTP: split response echoes and labelled secrets are redacted without consuming the caller body", async () => {
  const root = await fixture();
  const response = {
    echo: `${KEY}/${TOKEN}`,
    apiKey: "synthetic-labelled-response-secret",
    ok: true,
  };
  const wire = await server((_req, res) => {
    const text = JSON.stringify(response);
    res.write(text.slice(0, 12));
    setImmediate(() => res.end(text.slice(12)));
  });
  try {
    const result = await child(
      root,
      `const r=await ${request(wire.url, { tool: "memory_get", args: { path: "memory/test.md" } })};const body=await r.json();if(!body.ok||body.apiKey!=='synthetic-labelled-response-secret')throw Error('caller body changed');console.log(JSON.stringify({ok:true}));`,
    );
    assert.equal(result.code, 0, result.stderr);
    const raw = await readFile(join(root, "http.trace.jsonl"), "utf8");
    for (const value of [KEY, TOKEN, response.apiKey])
      assert.equal(raw.includes(value), false);
    assert.ok(raw.includes("[REDACTED]"));
    assert.equal(readTrace(join(root, "http.trace.jsonl")).complete, true);
  } finally {
    await wire.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("PARITY HTTP: credentials cannot enter an exact replay tape before request dispatch", async () => {
  const root = await fixture();
  let received = 0;
  const wire = await server((_req, res) => {
    received++;
    res.end("{}");
  });
  try {
    const result = await child(
      root,
      `try{await ${request(wire.url, { tool: "memory_search", args: { query: KEY } })};}catch{console.log('blocked');}`,
      { tape: true },
    );
    assert.notEqual(result.code, 0);
    assert.equal(received, 0);
    assert.equal(result.stdout.trim(), "blocked");
    assert.equal(await readFile(join(root, "http.tape.jsonl"), "utf8"), "");
    const raw = await readFile(join(root, "http.trace.jsonl"), "utf8");
    assert.equal(raw.includes(KEY), false);
    assert.equal(readTrace(join(root, "http.trace.jsonl")).complete, false);
  } finally {
    await wire.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("PARITY HTTP: a sensitive response keeps a sanitized prefix and never enters the exact tape", async () => {
  const root = await fixture();
  let received = 0;
  const wire = await server((_req, res) => {
    received++;
    res.end(JSON.stringify({ echo: TOKEN }));
  });
  try {
    const result = await child(
      root,
      `try{await ${request(wire.url, { tool: "memory_get" })};}catch{console.log('blocked');}`,
      { tape: true },
    );
    assert.notEqual(result.code, 0);
    assert.equal(received, 1);
    assert.equal(await readFile(join(root, "http.tape.jsonl"), "utf8"), "");
    const text = await readFile(join(root, "http.trace.jsonl"), "utf8");
    assert.equal(text.includes(TOKEN), false);
    assert.ok(text.includes("http.response"));
    assert.equal(readTrace(join(root, "http.trace.jsonl")).complete, false);
  } finally {
    await wire.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("PARITY HTTP: existing journals, linked targets and oversized requests send no HTTP", async () => {
  const root = await fixture();
  let received = 0;
  const wire = await server((_req, res) => {
    received++;
    res.end("{}");
  });
  try {
    const existing = join(root, "existing.jsonl");
    await writeFile(existing, "preserved\n", { mode: 0o600 });
    const linked = join(root, "linked.jsonl");
    await symlink(existing, linked);
    for (const path of [existing, linked]) {
      const result = await child(
        root,
        `await ${request(wire.url, { tool: "memory_search" })};`,
        { journal: path },
      );
      assert.notEqual(result.code, 0);
    }
    assert.equal(await readFile(existing, "utf8"), "preserved\n");
    const oversized = await child(
      root,
      `try{await fetch(${JSON.stringify(wire.url)},{method:'POST',body:'x'.repeat(8*1024*1024+1)});}catch{console.log('blocked');}`,
    );
    assert.notEqual(oversized.code, 0);
    assert.equal(received, 0);
    assert.equal(readTrace(join(root, "http.trace.jsonl")).complete, false);
  } finally {
    await wire.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("PARITY HTTP: a durable-start write failure blocks transport and cannot claim completeness", async () => {
  const root = await fixture();
  const stub = join(root, "write-failure.mjs");
  await writeFile(
    stub,
    `import fs from 'node:fs';import{syncBuiltinESMExports}from'node:module';const write=fs.writeSync;fs.writeSync=(fd,buffer,...rest)=>{if(String(buffer).includes('"kind":"http.start"'))throw Error('synthetic disk failure');return write(fd,buffer,...rest);};syncBuiltinESMExports();globalThis.fetch=async()=>{fs.writeFileSync(${JSON.stringify(join(root, "transport-dispatched"))},'wrong');return Response.json({ok:true});};`,
  );
  try {
    const result = await child(
      root,
      `try{await ${request("http://127.0.0.1:1234/tools/invoke", { tool: "memory_search" })};}catch{console.log('blocked');}`,
      { stub },
    );
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout.trim(), "blocked");
    await assert.rejects(stat(join(root, "transport-dispatched")), {
      code: "ENOENT",
    });
    assert.equal(readTrace(join(root, "http.trace.jsonl")).complete, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PARITY HTTP: oversized response bodies cannot be silently truncated into a complete trace", async () => {
  const root = await fixture();
  const stub = join(root, "oversized-response.mjs");
  await writeFile(
    stub,
    "globalThis.fetch=async()=>new Response('x'.repeat(8*1024*1024+1));",
  );
  try {
    const result = await child(
      root,
      `try{await ${request("http://127.0.0.1:1234/tools/invoke", { tool: "memory_search" })};}catch{console.log('blocked');}`,
      { stub },
    );
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout.trim(), "blocked");
    assert.equal(readTrace(join(root, "http.trace.jsonl")).complete, false);
    const events = await records(join(root, "http.trace.jsonl"));
    assert.equal(
      events.filter((event) => event.kind === "http.start").length,
      1,
    );
    assert.equal(
      events.some((event) => event.kind === "http.result"),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PARITY HTTP: provider traffic is untouched and an interrupted in-flight prefix stays incomplete", async () => {
  const root = await fixture();
  const stub = join(root, "fetch-fixture.mjs");
  await writeFile(
    stub,
    "globalThis.fetch=async input=>(input instanceof Request?input.url:String(input)).includes('/tools/invoke')?new Promise(()=>{}):Response.json({unchanged:true});",
  );
  try {
    const result = await child(
      root,
      `const r=await fetch('https://openrouter.ai/api/v1/key');if(!(await r.json()).unchanged)throw Error('remote response changed');void ${request("http://127.0.0.1:1234/tools/invoke", { tool: "memory_search" })};await new Promise(r=>setTimeout(r,30));process.exit(0);`,
      { stub },
    );
    const raw = await readFile(join(root, "http.trace.jsonl"), "utf8");
    assert.equal(raw.includes("openrouter.ai"), false);
    assert.ok(
      (await records(join(root, "http.trace.jsonl"))).some(
        (e) => e.kind === "http.start",
      ),
    );
    assert.equal(readTrace(join(root, "http.trace.jsonl")).complete, false);
    assert.notEqual(result.code, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

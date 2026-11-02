import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  claimOneUserActivation,
  createOneUserAdmission,
  inspectOneUserQuota,
  readOneUserLedger,
} from "../src/one-user-budget.ts";

const execute = promisify(execFile);
const project = fileURLToPath(new URL("../", import.meta.url));
const bootstrap = join(project, "src/native-bootstrap.ts");
const nativeEntry = fileURLToPath(import.meta.resolve("openclaw"));
const quota = () =>
  inspectOneUserQuota({
    usage: {
      updatedAt: Date.now(),
      providers: [
        {
          provider: "openrouter",
          billing: [
            {
              type: "budget",
              label: "API key budget",
              unit: "USD",
              limit: 50,
              used: 0,
              period: "weekly",
            },
          ],
        },
      ],
    },
  });

test("ONE USER NATIVE: prepared chat and embedding fetches reserve before transport, preserve uncertainty and exclude metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "one-user-native-"));
  const directory = join(root, "scenario"),
    ledger = join(directory, "ledger.json");
  createOneUserAdmission(directory, quota());
  claimOneUserActivation(ledger);
  const stub = join(root, "synthetic-transport.mjs");
  const stubProgram = [
    "import {createRequire} from 'node:module';",
    `const nativeRequire=createRequire(${JSON.stringify(nativeEntry)});`,
    "globalThis.__syntheticRequests=[];",
    "nativeRequire('undici/index.js').fetch=async(input,init)=>{",
    "const body=init?.body?JSON.parse(typeof init.body==='string'?init.body:new TextDecoder().decode(init.body)):undefined;",
    "globalThis.__syntheticRequests.push({url:String(input),body,contentLength:new Headers(init?.headers).get('content-length')});",
    "if(body?.messages?.[0]?.content==='synthetic transport failure')throw new Error('synthetic transport failure');",
    "return new Response(JSON.stringify({ok:true}),{headers:{'content-type':'application/json'}});};",
  ].join("\n");
  const runtime = new URL(
    "../node_modules/openclaw/dist/runtime-fetch-BCy08QFk.mjs",
    import.meta.url,
  ).href;
  const program = [
    "import assert from 'node:assert/strict';",
    `import {n as preparedFetch} from ${JSON.stringify(runtime)};`,
    "const chat='https://openrouter.ai/api/v1/chat/completions';",
    "const embedding='https://openrouter.ai/api/v1/embeddings';",
    "await assert.rejects(preparedFetch(chat,{method:'POST',body:JSON.stringify({model:'other',max_tokens:1})}),/One-user request denied/);",
    "await assert.rejects(preparedFetch(embedding,{method:'POST',body:JSON.stringify({model:'other',input:'Synthetic'})}),/One-user request denied/);",
    "assert.equal(globalThis.__syntheticRequests.length,0);",
    "await preparedFetch(chat,{method:'POST',headers:{'content-length':'999'},body:new TextEncoder().encode(JSON.stringify({model:'openai/gpt-6-sol',messages:[{role:'user',content:'Synthetic summary'}]}))});",
    "await preparedFetch(embedding,{method:'POST',body:JSON.stringify({model:'openai/text-embedding-3-small',input:['Synthetic bicycle','Synthetic rooibos']})});",
    "await preparedFetch('https://openrouter.ai/api/v1/key');",
    "await assert.rejects(preparedFetch(chat,{method:'POST',body:JSON.stringify({model:'openai/gpt-6-sol',max_tokens:512,messages:[{role:'user',content:'synthetic transport failure'}]})}),/synthetic transport failure/);",
    "assert.equal(globalThis.__syntheticRequests.length,4);",
    "assert.equal(globalThis.__syntheticRequests[0].body.max_completion_tokens,1024);",
    "assert.equal(globalThis.__syntheticRequests[0].contentLength,null);",
    "console.log(JSON.stringify({preparedNativeChat:true,preparedNativeEmbedding:true,transportCalls:globalThis.__syntheticRequests.length,synthetic:true}));",
  ].join("\n");
  try {
    await writeFile(stub, stubProgram);
    const result = await execute(
      process.execPath,
      [
        "--import",
        pathToFileURL(stub).href,
        "--import",
        bootstrap,
        "--input-type=module",
        "-e",
        program,
      ],
      {
        env: { PATH: "/usr/bin:/bin", BRIDGE_ONE_USER_LEDGER: ledger },
        timeout: 20000,
      },
    );
    assert.deepEqual(JSON.parse(result.stdout), {
      preparedNativeChat: true,
      preparedNativeEmbedding: true,
      transportCalls: 4,
      synthetic: true,
    });
    const actual = readOneUserLedger(ledger);
    assert.equal(actual.requests, 3);
    assert.equal(actual.chatRequests, 2);
    assert.equal(actual.embeddingRequests, 1);
    assert.equal(actual.outputTokens, 1536);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ONE USER NATIVE: conflicting or unactivated admission contexts fail before setup", async () => {
  const root = await mkdtemp(join(tmpdir(), "one-user-conflict-"));
  const directory = join(root, "scenario"),
    ledger = join(directory, "ledger.json");
  createOneUserAdmission(directory, quota());
  try {
    for (const environment of [
      { BRIDGE_ONE_USER_LEDGER: ledger },
      {
        BRIDGE_ONE_USER_LEDGER: ledger,
        OPENCLAW_LAB_LIFECYCLE_LEDGER: "/synthetic/nonexistent.json",
      },
    ]) {
      await assert.rejects(
        execute(
          process.execPath,
          [
            "--import",
            bootstrap,
            "--input-type=module",
            "-e",
            "throw new Error('must not reach entry')",
          ],
          {
            env: { PATH: "/usr/bin:/bin", ...environment },
            timeout: 10000,
          },
        ),
        (error: unknown) => {
          assert.ok(error && typeof error === "object" && "stderr" in error);
          assert.match(
            String(error.stderr),
            /Conflicting native admission|invalid or uncertain admission/,
          );
          assert.doesNotMatch(String(error.stderr), /must not reach entry/);
          return true;
        },
      );
    }
    assert.equal(readOneUserLedger(ledger).requests, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

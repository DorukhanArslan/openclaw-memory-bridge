import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { inspectBudget } from "../src/budget-preflight.ts";
import {
  inspectOneUserFollowupQuota,
  ONE_USER_FOLLOWUP_LIMITS,
} from "../src/one-user-followup-budget.ts";

const execute = promisify(execFile);
const project = fileURLToPath(new URL("../", import.meta.url));
const chatUrl = "https://openrouter.ai/api/v1/chat/completions";
const embeddingUrl = "https://openrouter.ai/api/v1/embeddings";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const snapshot = (updatedAt = Date.now()) => ({
  usage: {
    updatedAt,
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
const chat = (output = 512, content = "Synthetic owner-confirmed routine") => ({
  method: "POST",
  body: JSON.stringify({
    model: "openai/gpt-6-sol",
    max_completion_tokens: output,
    messages: [{ role: "user", content }],
  }),
});
const embedding = () => ({
  method: "POST",
  body: JSON.stringify({
    model: "openai/text-embedding-3-small",
    input: "Synthetic retained orchid routine",
  }),
});

type Budget = typeof import("../src/one-user-followup-budget.ts");
type OldBudget = typeof import("../src/one-user-budget.ts");
async function fixture(
  options: {
    oldRequests?: number;
    oldContent?: string;
    admitted?: boolean;
    active?: boolean;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "one-user-followup-budget-"));
  const foundation = join(root, "foundation");
  await cp(join(project, "src"), join(foundation, "src"), { recursive: true });
  await copyFile(
    join(project, "package.json"),
    join(foundation, "package.json"),
  );
  await symlink(
    join(project, "node_modules"),
    join(foundation, "node_modules"),
  );
  await mkdir(join(foundation, ".lab"), { mode: 0o700 });
  const old = (await import(
    pathToFileURL(join(foundation, "src/one-user-budget.ts")).href
  )) as OldBudget;
  const budget = (await import(
    pathToFileURL(join(foundation, "src/one-user-followup-budget.ts")).href
  )) as Budget;
  old.createOneUserAdmission(
    old.ONE_USER_DIRECTORY,
    old.inspectOneUserQuota(snapshot()),
  );
  old.claimOneUserActivation(old.ONE_USER_LEDGER);
  for (let i = 0; i < (options.oldRequests ?? 1); i++)
    old.admitOneUserRequest(
      old.ONE_USER_LEDGER,
      chatUrl,
      chat(512, options.oldContent),
    );
  await writeFile(
    old.ONE_USER_REPORT,
    `${JSON.stringify({ kind: "current-one-user-native-lifecycle", ok: false, error: "One-user nativeMaintenance: synthetic retained failure", finishedAt: new Date().toISOString(), sourceSessionBefore: { session: { sessionId: "synthetic-main-id" } }, stages: { nativeMaintenance: "fail: synthetic boundary" } })}\n`,
    { mode: 0o600, flag: "wx" },
  );
  const oldPaths = [
    old.ONE_USER_ADMISSION,
    join(old.ONE_USER_DIRECTORY, "activation.json"),
    old.ONE_USER_LEDGER,
    old.ONE_USER_REPORT,
  ];
  const oldHashes = await Promise.all(
    oldPaths.map(async (path) => hash(await readFile(path, "utf8"))),
  );
  if (options.admitted !== false) {
    budget.createOneUserFollowupAdmission(
      budget.ONE_USER_FOLLOWUP_DIRECTORY,
      budget.inspectOneUserFollowupQuota(snapshot()),
    );
    if (options.active !== false)
      budget.claimOneUserFollowupActivation(budget.ONE_USER_FOLLOWUP_LEDGER);
  }
  return {
    root,
    foundation,
    old,
    budget,
    oldPaths,
    oldHashes,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function assertOldUnchanged(data: Awaited<ReturnType<typeof fixture>>) {
  assert.deepEqual(
    await Promise.all(
      data.oldPaths.map(async (path) => hash(await readFile(path, "utf8"))),
    ),
    data.oldHashes,
  );
}

async function writePreparationFailure(
  data: Awaited<ReturnType<typeof fixture>>,
  alter?: (report: Record<string, unknown>) => void,
) {
  const day = new Date().toISOString().slice(0, 10);
  const workspace = join(
    data.old.ONE_USER_DIRECTORY,
    "corpus/one-user/workspace",
  );
  await mkdir(join(workspace, "memory"), { recursive: true, mode: 0o700 });
  const snapshot = { "USER.md": "Synthetic unchanged original profile" };
  const report: Record<string, unknown> = {
    schemaVersion: 1,
    kind: "one-user-owner-maintenance-followup",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    nativeSourceDayUtc: day,
    sourcePath: `memory/${day}.md`,
    sourceSessionKey: "agent:main:owner-followup",
    originalMainSessionKey: "agent:main:main",
    originalAttemptReplayed: false,
    harnessSourceWrites: false,
    ok: false,
    stages: {
      sourceOwnerWrite: "not-run",
      semanticRecall: "not-run",
      promotionEligible: "not-run",
      nativeMaintenance: "not-run",
      durablePromotion: "not-run",
      restartRecall: "not-run",
      sessionContinuity: "not-run",
      previousEvidencePreserved: "pass",
    },
    steps: [],
    initialWorkspace: snapshot,
    finalWorkspace: { ...snapshot },
    error: `Memory not ready: ${JSON.stringify({ results: [], disabled: true, unavailable: true, error: "index was built for model fts-only, expected openai/text-embedding-3-small" })}\nGateway diagnostics: `,
    requestLedger: data.budget.readOneUserFollowupLedger(
      data.budget.ONE_USER_FOLLOWUP_LEDGER,
    ),
  };
  alter?.(report);
  await writeFile(
    data.budget.ONE_USER_FOLLOWUP_REPORT,
    `${JSON.stringify(report)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return { workspace, sourcePath: `memory/${day}.md`, report };
}

async function writeCompletionBoundary(
  data: Awaited<ReturnType<typeof fixture>>,
  alter?: (report: Record<string, unknown>) => void,
) {
  const failure = await writePreparationFailure(data);
  const { budget } = data;
  budget.claimOneUserFollowupPreparationRepair(
    budget.ONE_USER_FOLLOWUP_LEDGER,
    budget.inspectOneUserFollowupQuota(snapshot()),
  );
  const startedAt = Date.now();
  budget.admitOneUserFollowupRequest(
    budget.ONE_USER_FOLLOWUP_LEDGER,
    chatUrl,
    chat(),
  );
  budget.admitOneUserFollowupRequest(
    budget.ONE_USER_FOLLOWUP_LEDGER,
    chatUrl,
    chat(),
  );
  for (let i = 0; i < 3; i++)
    budget.admitOneUserFollowupRequest(
      budget.ONE_USER_FOLLOWUP_LEDGER,
      embeddingUrl,
      embedding(),
    );
  const text =
    "Sable confirmed rooibos, Monday, and COBALT-LANTERN-0915 at 09:15.\n";
  await writeFile(join(failure.workspace, failure.sourcePath), text, {
    mode: 0o600,
    flag: "wx",
  });
  const before = { "USER.md": "Synthetic unchanged original profile" };
  const after = { ...before, [failure.sourcePath]: text };
  const source = {
    version: 1,
    workspaceKey: hash(failure.workspace),
    relativePath: failure.sourcePath,
    fileHash: hash(text),
    originClass: "agent",
    observedAt: Date.now(),
    sessionId: "synthetic-owner-source-id",
    sessionKey: "agent:main:owner-followup",
    reservationId: "synthetic-native-reservation",
  };
  const report: Record<string, unknown> = {
    schemaVersion: 1,
    kind: "one-user-owner-maintenance-followup",
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    nativeSourceDayUtc: failure.sourcePath.slice(7, 17),
    sourcePath: failure.sourcePath,
    sourceSessionKey: "agent:main:owner-followup",
    originalMainSessionKey: "agent:main:main",
    originalAttemptReplayed: false,
    harnessSourceWrites: false,
    ok: false,
    stages: {
      sourceOwnerWrite: "pass",
      semanticRecall: "pass",
      promotionEligible: "not-run",
      nativeMaintenance: "not-run",
      durablePromotion: "not-run",
      restartRecall: "not-run",
      sessionContinuity: "not-run",
      previousEvidencePreserved: "pass",
    },
    steps: [
      {
        id: "owner-confirmed-new-day-source",
        session: "owner-followup",
        before,
        after,
        changes: [failure.sourcePath],
      },
    ],
    initialWorkspace: before,
    finalWorkspace: after,
    sourceProvenance: source,
    originalMainBefore: { session: { sessionId: "synthetic-main-id" } },
    sourceSession: {
      state: {
        session: {
          key: "agent:main:owner-followup",
          sessionId: source.sessionId,
          parentSessionKey: "agent:main:main",
          parentSessionId: "synthetic-main-id",
        },
      },
      initialMessages: [],
    },
    semanticRecall: {
      provider: "openai-compatible",
      model: "openai/text-embedding-3-small",
      results: [{ path: failure.sourcePath, snippet: text }],
    },
    error: `Unexpected token 's', "[secrets] m"... is not valid JSON`,
    requestLedger: budget.readOneUserFollowupLedger(
      budget.ONE_USER_FOLLOWUP_LEDGER,
    ),
  };
  alter?.(report);
  await writeFile(
    budget.ONE_USER_FOLLOWUP_PREPARATION_REPAIR_REPORT,
    `${JSON.stringify(report)}\n`,
    { mode: 0o600, flag: "wx" },
  );
  return { ...failure, partial: report, source };
}

test("FOLLOWUP BUDGET: distinct finite approval retains strict generic quota gate and exact envelope", () => {
  const data = snapshot();
  const quota = inspectOneUserFollowupQuota(data);
  assert.equal(quota.approvalScope, "one-user-maintenance-followup");
  assert.equal(quota.cumulativeHistoryVerified, false);
  assert.equal(quota.observedPeriod, "weekly");
  assert.ok(
    Math.abs(ONE_USER_FOLLOWUP_LIMITS.estimatedUsd - 2.11118784) < 1e-10,
  );
  assert.equal(
    inspectBudget(data, Date.now(), 50).code,
    "periodic_or_unknown_reset",
  );
  assert.throws(
    () => inspectOneUserFollowupQuota(snapshot(Date.now() - 30001)),
    /stale/,
  );
  const wrong = snapshot();
  const wrongBudget = wrong.usage.providers[0]?.billing[0];
  assert.ok(wrongBudget);
  wrongBudget.used = 49;
  assert.throws(() => inspectOneUserFollowupQuota(wrong), /headroom/);
});

test("FOLLOWUP BUDGET: explicit new admission binds four consumed predecessor files and never reactivates them", async () => {
  const data = await fixture();
  try {
    const { budget, old } = data;
    const predecessor = budget.inspectOneUserFollowupPredecessor();
    assert.equal(predecessor.refundApplied, false);
    assert.equal(Object.keys(predecessor.evidenceSha256).length, 4);
    assert.equal(predecessor.reservedCounters.chatRequests, 1);
    assert.ok(predecessor.reservedEstimateUsd > 0);
    assert.ok(predecessor.combinedEstimateUsd < 5);
    assert.equal(
      budget.readOneUserFollowupLedger(budget.ONE_USER_FOLLOWUP_LEDGER)
        .requests,
      0,
    );
    assert.throws(
      () =>
        budget.createOneUserFollowupAdmission(
          budget.ONE_USER_FOLLOWUP_DIRECTORY,
          budget.inspectOneUserFollowupQuota(snapshot()),
        ),
      /existing or uncertain/,
    );
    assert.throws(
      () =>
        budget.claimOneUserFollowupActivation(budget.ONE_USER_FOLLOWUP_LEDGER),
      /already activated/,
    );
    assert.throws(
      () => old.claimOneUserActivation(old.ONE_USER_LEDGER),
      /already dispatched/,
    );
    const admission = JSON.parse(
      await readFile(budget.ONE_USER_FOLLOWUP_ADMISSION, "utf8"),
    );
    assert.equal(admission.scope, "one-user-maintenance-followup");
    assert.equal(admission.automaticReplayAllowed, false);
    assert.deepEqual(admission.predecessor, predecessor);
    await assertOldUnchanged(data);
  } finally {
    await data.cleanup();
  }
});

test("FOLLOWUP BUDGET: cumulative full reservations block admission instead of refunding actual usage", async () => {
  const data = await fixture({
    oldRequests: 4,
    oldContent: "x".repeat(80000),
    admitted: false,
  });
  try {
    assert.throws(
      () =>
        data.budget.createOneUserFollowupAdmission(
          data.budget.ONE_USER_FOLLOWUP_DIRECTORY,
          data.budget.inspectOneUserFollowupQuota(snapshot()),
        ),
      /cumulative estimate/,
    );
    assert.equal(existsSync(data.budget.ONE_USER_FOLLOWUP_DIRECTORY), false);
    await assertOldUnchanged(data);
  } finally {
    await data.cleanup();
  }
});

test("FOLLOWUP BUDGET: changed original evidence or a newly reserved old attempt stops the followup before dispatch", async () => {
  for (const kind of ["report", "ledger"] as const) {
    const data = await fixture();
    try {
      const before = await readFile(
        data.budget.ONE_USER_FOLLOWUP_LEDGER,
        "utf8",
      );
      if (kind === "report")
        await writeFile(
          data.old.ONE_USER_REPORT,
          `${await readFile(data.old.ONE_USER_REPORT, "utf8")}\n`,
          { mode: 0o600 },
        );
      else
        data.old.admitOneUserRequest(data.old.ONE_USER_LEDGER, chatUrl, chat());
      assert.throws(
        () =>
          data.budget.admitOneUserFollowupRequest(
            data.budget.ONE_USER_FOLLOWUP_LEDGER,
            chatUrl,
            chat(),
          ),
        /invalid or uncertain/,
      );
      assert.equal(
        await readFile(data.budget.ONE_USER_FOLLOWUP_LEDGER, "utf8"),
        before,
      );
    } finally {
      await data.cleanup();
    }
  }
});

test("FOLLOWUP BUDGET: activation requires a fresh hash-bound quota and does not repair stale context", async () => {
  const data = await fixture({ active: false });
  try {
    const { budget } = data;
    const admission = JSON.parse(
      await readFile(budget.ONE_USER_FOLLOWUP_ADMISSION, "utf8"),
    );
    const past = Date.now() - 31000;
    admission.claimedAt = new Date(past).toISOString();
    admission.quota.snapshotUpdatedAt = past;
    const text = `${JSON.stringify(admission)}\n`;
    await writeFile(budget.ONE_USER_FOLLOWUP_ADMISSION, text, { mode: 0o600 });
    const ledger = JSON.parse(
      await readFile(budget.ONE_USER_FOLLOWUP_LEDGER, "utf8"),
    );
    ledger.admissionSha256 = hash(text);
    await writeFile(
      budget.ONE_USER_FOLLOWUP_LEDGER,
      `${JSON.stringify(ledger)}\n`,
      { mode: 0o600 },
    );
    assert.equal(
      budget.readOneUserFollowupLedger(budget.ONE_USER_FOLLOWUP_LEDGER)
        .requests,
      0,
    );
    assert.throws(
      () =>
        budget.claimOneUserFollowupActivation(budget.ONE_USER_FOLLOWUP_LEDGER),
      /stale or uncertain quota/,
    );
    assert.equal(
      existsSync(join(budget.ONE_USER_FOLLOWUP_DIRECTORY, "activation.json")),
      false,
    );
    await assertOldUnchanged(data);
  } finally {
    await data.cleanup();
  }
});

test("FOLLOWUP BUDGET: requests and missing utility bounds reserve before transport, keep uncertainty and reject unsupported capabilities", async () => {
  const data = await fixture();
  try {
    const { budget } = data,
      path = budget.ONE_USER_FOLLOWUP_LEDGER;
    budget.admitOneUserFollowupRequest(
      path,
      "https://openrouter.ai/api/v1/key",
    );
    assert.equal(budget.readOneUserFollowupLedger(path).requests, 0);
    const utility = {
      method: "POST",
      headers: { "content-length": "999" },
      body: JSON.stringify({
        model: "openai/gpt-6-sol",
        messages: [{ role: "user", content: "Synthetic utility" }],
      }),
    };
    const bounded = budget.boundOneUserFollowupUtilityRequest(
      path,
      chatUrl,
      utility,
    );
    assert.equal(new Headers(bounded?.headers).get("content-length"), null);
    assert.equal(JSON.parse(String(bounded?.body)).max_completion_tokens, 1024);
    budget.admitOneUserFollowupRequest(path, chatUrl, bounded);
    budget.admitOneUserFollowupRequest(path, embeddingUrl, embedding());
    const ledger = budget.readOneUserFollowupLedger(path);
    assert.equal(ledger.requests, 2);
    assert.equal(ledger.chatRequests, 1);
    assert.equal(ledger.embeddingRequests, 1);
    assert.equal(ledger.outputTokens, 1024);
    for (const delta of [
      { model: "other" },
      { max_tokens: 1 },
      { plugins: [] },
      { audio: {} },
      { tools: [{ type: "web_search" }] },
      { modalities: ["audio"] },
    ]) {
      const body = {
        model: "openai/gpt-6-sol",
        max_completion_tokens: 512,
        ...delta,
      };
      assert.throws(
        () =>
          budget.admitOneUserFollowupRequest(path, chatUrl, {
            method: "POST",
            body: JSON.stringify(body),
          }),
        /chat model\/output\/capability/,
      );
    }
    assert.deepEqual(budget.readOneUserFollowupLedger(path), ledger);
    assert.throws(
      () =>
        budget.admitOneUserFollowupRequest(
          path,
          "https://example.test/api/v1/chat/completions",
          chat(),
        ),
      /destination/,
    );
    assert.equal(
      budget.readOneUserFollowupLedger(path).requests,
      2,
      "A hypothetical transport failure must not refund prior reservation.",
    );
    await assertOldUnchanged(data);
  } finally {
    await data.cleanup();
  }
});

test("FOLLOWUP BUDGET: aggregate output and uncertain lock state fail closed with durable counts", async () => {
  const data = await fixture();
  try {
    const { budget } = data,
      path = budget.ONE_USER_FOLLOWUP_LEDGER;
    for (let i = 0; i < 8; i++)
      budget.admitOneUserFollowupRequest(path, chatUrl, chat(2048));
    assert.throws(
      () => budget.admitOneUserFollowupRequest(path, chatUrl, chat(2048)),
      /chat_output_tokens/,
    );
    assert.equal(budget.readOneUserFollowupLedger(path).outputTokens, 16384);
    await writeFile(
      join(budget.ONE_USER_FOLLOWUP_DIRECTORY, "ledger.lock"),
      "synthetic uncertain owner",
      { flag: "wx", mode: 0o600 },
    );
    assert.throws(
      () => budget.admitOneUserFollowupRequest(path, chatUrl, chat()),
      /locked or uncertain/,
    );
    assert.equal(budget.readOneUserFollowupLedger(path).requests, 8);
    assert.equal(
      existsSync(join(budget.ONE_USER_FOLLOWUP_DIRECTORY, "ledger.lock")),
      true,
    );
    await assertOldUnchanged(data);
  } finally {
    await data.cleanup();
  }
});

test("FOLLOWUP BUDGET: parallel native callers cannot exceed fourteen paid attempts", async () => {
  const data = await fixture();
  try {
    const moduleUrl = pathToFileURL(
      join(data.foundation, "src/one-user-followup-budget.ts"),
    ).href;
    const program = `import{admitOneUserFollowupRequest}from${JSON.stringify(moduleUrl)};let admitted=0,denied=0;for(let i=0;i<3;i++){try{admitOneUserFollowupRequest(${JSON.stringify(data.budget.ONE_USER_FOLLOWUP_LEDGER)},${JSON.stringify(chatUrl)},${JSON.stringify(chat())});admitted++}catch{denied++}}console.log(JSON.stringify({admitted,denied}));`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        execute(process.execPath, ["--input-type=module", "-e", program], {
          cwd: data.foundation,
          env: { PATH: "/usr/bin:/bin" },
          timeout: 20000,
        }),
      ),
    );
    const outcomes = results.map((result) => JSON.parse(result.stdout));
    assert.equal(
      outcomes.reduce((sum, value) => sum + value.admitted, 0),
      14,
    );
    assert.equal(
      outcomes.reduce((sum, value) => sum + value.denied, 0),
      1,
    );
    assert.equal(
      data.budget.readOneUserFollowupLedger(
        data.budget.ONE_USER_FOLLOWUP_LEDGER,
      ).chatRequests,
      14,
    );
    await assertOldUnchanged(data);
  } finally {
    await data.cleanup();
  }
});

test("FOLLOWUP NATIVE: prepared transport reserves chat and embedding before dispatch and rejects every mixed scope", async () => {
  const data = await fixture();
  try {
    const bootstrap = pathToFileURL(
      join(data.foundation, "src/native-bootstrap.ts"),
    ).href;
    const nativeEntry = import.meta.resolve("openclaw");
    const nativeRequire = createRequire(nativeEntry);
    assert.equal(nativeRequire("undici/package.json").version, "8.10.2");
    const stub = join(data.root, "synthetic-transport.mjs");
    await writeFile(
      stub,
      [
        "import {createRequire} from 'node:module';",
        `const nativeRequire=createRequire(${JSON.stringify(nativeEntry)});`,
        "globalThis.__syntheticRequests=[];",
        "nativeRequire('undici/index.js').fetch=async(input,init)=>{",
        "const body=init?.body?JSON.parse(typeof init.body==='string'?init.body:new TextDecoder().decode(init.body)):undefined;",
        "globalThis.__syntheticRequests.push({url:String(input),body,contentLength:new Headers(init?.headers).get('content-length')});",
        "if(body?.messages?.[0]?.content==='synthetic transport failure')throw new Error('synthetic transport failure');",
        "return new Response(JSON.stringify({ok:true}));};",
      ].join("\n"),
    );
    const runtime = new URL(
      "../node_modules/openclaw/dist/runtime-fetch-BCy08QFk.mjs",
      import.meta.url,
    ).href;
    const program = [
      "import assert from 'node:assert/strict';",
      `import {n as preparedFetch} from ${JSON.stringify(runtime)};`,
      `const chat=${JSON.stringify(chatUrl)},embedding=${JSON.stringify(embeddingUrl)};`,
      "await assert.rejects(preparedFetch(chat,{method:'POST',body:JSON.stringify({model:'other',max_tokens:1})}),/request denied/);",
      "assert.equal(globalThis.__syntheticRequests.length,0);",
      "await preparedFetch(chat,{method:'POST',headers:{'content-length':'999'},body:new TextEncoder().encode(JSON.stringify({model:'openai/gpt-6-sol',messages:[{role:'user',content:'Synthetic owner summary'}]}))});",
      "await preparedFetch(embedding,{method:'POST',body:JSON.stringify({model:'openai/text-embedding-3-small',input:['Synthetic orchid','Synthetic rooibos']})});",
      "await preparedFetch('https://openrouter.ai/api/v1/key');",
      "await assert.rejects(preparedFetch(chat,{method:'POST',body:JSON.stringify({model:'openai/gpt-6-sol',max_tokens:512,messages:[{role:'user',content:'synthetic transport failure'}]})}),/synthetic transport failure/);",
      "assert.equal(globalThis.__syntheticRequests.length,4);",
      "assert.equal(globalThis.__syntheticRequests[0].body.max_completion_tokens,1024);",
      "assert.equal(globalThis.__syntheticRequests[0].contentLength,null);",
      "console.log(JSON.stringify({synthetic:true,transportCalls:globalThis.__syntheticRequests.length}));",
    ].join("\n");
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
        cwd: data.foundation,
        env: {
          PATH: "/usr/bin:/bin",
          BRIDGE_ONE_USER_FOLLOWUP_LEDGER: data.budget.ONE_USER_FOLLOWUP_LEDGER,
        },
        timeout: 20000,
      },
    );
    assert.deepEqual(JSON.parse(result.stdout), {
      synthetic: true,
      transportCalls: 4,
    });
    const ledger = data.budget.readOneUserFollowupLedger(
      data.budget.ONE_USER_FOLLOWUP_LEDGER,
    );
    assert.equal(ledger.requests, 3);
    assert.equal(ledger.chatRequests, 2);
    assert.equal(ledger.embeddingRequests, 1);
    assert.equal(ledger.outputTokens, 1536);
    for (const env of [
      {
        BRIDGE_ONE_USER_FOLLOWUP_LEDGER: data.budget.ONE_USER_FOLLOWUP_LEDGER,
        BRIDGE_ONE_USER_LEDGER: data.old.ONE_USER_LEDGER,
      },
      {
        BRIDGE_ONE_USER_FOLLOWUP_LEDGER: data.budget.ONE_USER_FOLLOWUP_LEDGER,
        OPENCLAW_LAB_LIFECYCLE_LEDGER: "/synthetic/legacy-ledger.json",
      },
      {
        BRIDGE_ONE_USER_LEDGER: data.old.ONE_USER_LEDGER,
        OPENCLAW_LAB_LIFECYCLE_LEDGER: "/synthetic/legacy-ledger.json",
      },
    ]) {
      await assert.rejects(
        execute(
          process.execPath,
          [
            "--import",
            bootstrap,
            "-e",
            "process.stdout.write('should not run')",
          ],
          {
            cwd: data.foundation,
            env: { PATH: "/usr/bin:/bin", ...env },
            timeout: 10000,
          },
        ),
        /Conflicting native admission contexts/,
      );
    }
    assert.deepEqual(
      data.budget.readOneUserFollowupLedger(
        data.budget.ONE_USER_FOLLOWUP_LEDGER,
      ),
      ledger,
    );
    await assertOldUnchanged(data);
  } finally {
    await data.cleanup();
  }
});

test("FOLLOWUP PREPARATION: single zero-dispatch repair preserves allowance and frozen failure evidence", async () => {
  const data = await fixture();
  try {
    const failure = await writePreparationFailure(data);
    const { budget } = data;
    const protectedPaths = [
      budget.ONE_USER_FOLLOWUP_ADMISSION,
      join(budget.ONE_USER_FOLLOWUP_DIRECTORY, "activation.json"),
      budget.ONE_USER_FOLLOWUP_LEDGER,
      budget.ONE_USER_FOLLOWUP_REPORT,
    ];
    const before = await Promise.all(
      protectedPaths.map((path) => readFile(path, "utf8")),
    );
    budget.claimOneUserFollowupPreparationRepair(
      budget.ONE_USER_FOLLOWUP_LEDGER,
      budget.inspectOneUserFollowupQuota(snapshot()),
    );
    const receipt = JSON.parse(
      await readFile(budget.ONE_USER_FOLLOWUP_PREPARATION_REPAIR, "utf8"),
    );
    assert.equal(receipt.newAllowanceCreated, false);
    assert.equal(receipt.automaticReplayAllowed, false);
    assert.equal(receipt.failedReportSha256, hash(before[3] ?? ""));
    assert.equal(
      receipt.policySha256,
      JSON.parse(before[0] ?? "").policySha256,
    );
    assert.equal(receipt.initialLedger.requests, 0);
    assert.equal(
      receipt.reportPath,
      budget.ONE_USER_FOLLOWUP_PREPARATION_REPAIR_REPORT,
    );
    assert.equal(
      budget.ONE_USER_FOLLOWUP_PREPARATION_REPAIR_REPORT,
      join(
        budget.ONE_USER_FOLLOWUP_DIRECTORY,
        "preparation-repair-report.json",
      ),
    );
    assert.deepEqual(
      await Promise.all(protectedPaths.map((path) => readFile(path, "utf8"))),
      before,
    );
    assert.throws(
      () =>
        budget.claimOneUserFollowupPreparationRepair(
          budget.ONE_USER_FOLLOWUP_LEDGER,
          budget.inspectOneUserFollowupQuota(snapshot()),
        ),
      /already consumed/,
    );
    assert.throws(
      () =>
        budget.claimOneUserFollowupActivation(budget.ONE_USER_FOLLOWUP_LEDGER),
      /already activated/,
    );
    budget.admitOneUserFollowupRequest(
      budget.ONE_USER_FOLLOWUP_LEDGER,
      chatUrl,
      chat(),
    );
    await writeFile(
      join(failure.workspace, failure.sourcePath),
      "Synthetic post-admission native source",
      { mode: 0o600 },
    );
    budget.validateOneUserFollowupContext(budget.ONE_USER_FOLLOWUP_LEDGER);
    assert.equal(
      budget.readOneUserFollowupLedger(budget.ONE_USER_FOLLOWUP_LEDGER)
        .requests,
      1,
    );
    assert.equal(
      await readFile(budget.ONE_USER_FOLLOWUP_REPORT, "utf8"),
      before[3],
    );
    await assertOldUnchanged(data);
  } finally {
    await data.cleanup();
  }
});

test("FOLLOWUP PREPARATION: any prior paid reservation or current dated source denies repair without resetting counters", async () => {
  for (const reason of ["reservation", "source"] as const) {
    const data = await fixture();
    try {
      const failure = await writePreparationFailure(data);
      if (reason === "reservation")
        data.budget.admitOneUserFollowupRequest(
          data.budget.ONE_USER_FOLLOWUP_LEDGER,
          chatUrl,
          chat(),
        );
      else
        await writeFile(
          join(failure.workspace, failure.sourcePath),
          "Source already exists",
          { mode: 0o600 },
        );
      const ledgerBefore = await readFile(
        data.budget.ONE_USER_FOLLOWUP_LEDGER,
        "utf8",
      );
      assert.throws(
        () =>
          data.budget.claimOneUserFollowupPreparationRepair(
            data.budget.ONE_USER_FOLLOWUP_LEDGER,
            data.budget.inspectOneUserFollowupQuota(snapshot()),
          ),
        /nonzero|source already exists/,
      );
      assert.equal(
        existsSync(data.budget.ONE_USER_FOLLOWUP_PREPARATION_REPAIR),
        false,
      );
      assert.equal(
        await readFile(data.budget.ONE_USER_FOLLOWUP_LEDGER, "utf8"),
        ledgerBefore,
      );
      await assertOldUnchanged(data);
    } finally {
      await data.cleanup();
    }
  }
});

test("FOLLOWUP PREPARATION: model steps, unrelated failure, incomplete preservation or uncertain cleanup cannot qualify", async () => {
  for (const alter of [
    (report: Record<string, unknown>) => {
      report.steps = [{ id: "source-owner-model-turn" }];
    },
    (report: Record<string, unknown>) => {
      (report.stages as Record<string, unknown>).sourceOwnerWrite = "pass";
    },
    (report: Record<string, unknown>) => {
      (report.stages as Record<string, unknown>).previousEvidencePreserved =
        "not-run";
    },
    (report: Record<string, unknown>) => {
      report.error = "Unrelated readiness timeout";
    },
    (report: Record<string, unknown>) => {
      report.error = `Memory not ready: ${JSON.stringify({ results: [], disabled: true, unavailable: true, error: "another model mismatch" })}`;
    },
    (report: Record<string, unknown>) => {
      report.cleanupError = "";
    },
    (report: Record<string, unknown>) => {
      report.evidenceError = "snapshot uncertain";
    },
    (report: Record<string, unknown>) => {
      report.finalWorkspace = { "USER.md": "Changed profile" };
    },
    (report: Record<string, unknown>) => {
      (report.requestLedger as Record<string, unknown>).requests = 1;
    },
  ]) {
    const data = await fixture();
    try {
      await writePreparationFailure(data, alter);
      assert.throws(
        () =>
          data.budget.claimOneUserFollowupPreparationRepair(
            data.budget.ONE_USER_FOLLOWUP_LEDGER,
            data.budget.inspectOneUserFollowupQuota(snapshot()),
          ),
        /not a zero-dispatch readiness mismatch/,
      );
      assert.equal(
        existsSync(data.budget.ONE_USER_FOLLOWUP_PREPARATION_REPAIR),
        false,
      );
      assert.equal(
        data.budget.readOneUserFollowupLedger(
          data.budget.ONE_USER_FOLLOWUP_LEDGER,
        ).requests,
        0,
      );
      await assertOldUnchanged(data);
    } finally {
      await data.cleanup();
    }
  }
});

test("FOLLOWUP PREPARATION: fresh quota and an unused repair output are mandatory", async () => {
  for (const reason of ["stale", "output"] as const) {
    const data = await fixture();
    try {
      await writePreparationFailure(data);
      if (reason === "output")
        await writeFile(
          data.budget.ONE_USER_FOLLOWUP_PREPARATION_REPAIR_REPORT,
          "uncertain previous output",
          { mode: 0o600, flag: "wx" },
        );
      const quota = data.budget.inspectOneUserFollowupQuota(snapshot());
      const candidate =
        reason === "stale"
          ? { ...quota, snapshotUpdatedAt: Date.now() - 30001 }
          : quota;
      assert.throws(
        () =>
          data.budget.claimOneUserFollowupPreparationRepair(
            data.budget.ONE_USER_FOLLOWUP_LEDGER,
            candidate,
          ),
        /stale quota|already consumed or uncertain/,
      );
      assert.equal(
        existsSync(data.budget.ONE_USER_FOLLOWUP_PREPARATION_REPAIR),
        false,
      );
      await assertOldUnchanged(data);
    } finally {
      await data.cleanup();
    }
  }
});

test("FOLLOWUP PREPARATION: frozen failed report or repair receipt tampering blocks all later paid reservations", async () => {
  for (const reason of ["report", "receipt"] as const) {
    const data = await fixture();
    try {
      await writePreparationFailure(data);
      data.budget.claimOneUserFollowupPreparationRepair(
        data.budget.ONE_USER_FOLLOWUP_LEDGER,
        data.budget.inspectOneUserFollowupQuota(snapshot()),
      );
      const before = await readFile(
        data.budget.ONE_USER_FOLLOWUP_LEDGER,
        "utf8",
      );
      if (reason === "report")
        await writeFile(
          data.budget.ONE_USER_FOLLOWUP_REPORT,
          `${await readFile(data.budget.ONE_USER_FOLLOWUP_REPORT, "utf8")}\n`,
          { mode: 0o600 },
        );
      else {
        const receipt = JSON.parse(
          await readFile(
            data.budget.ONE_USER_FOLLOWUP_PREPARATION_REPAIR,
            "utf8",
          ),
        );
        receipt.initialLedger.outputTokens = 1;
        await writeFile(
          data.budget.ONE_USER_FOLLOWUP_PREPARATION_REPAIR,
          `${JSON.stringify(receipt)}\n`,
          { mode: 0o600 },
        );
      }
      assert.throws(
        () =>
          data.budget.admitOneUserFollowupRequest(
            data.budget.ONE_USER_FOLLOWUP_LEDGER,
            chatUrl,
            chat(),
          ),
        /invalid or uncertain/,
      );
      assert.equal(
        await readFile(data.budget.ONE_USER_FOLLOWUP_LEDGER, "utf8"),
        before,
      );
      await assertOldUnchanged(data);
    } finally {
      await data.cleanup();
    }
  }
});

test("FOLLOWUP COMPLETION: remaining-step checkpoint preserves the same allowance and all completed source evidence", async () => {
  const data = await fixture();
  try {
    const boundary = await writeCompletionBoundary(data);
    const { budget } = data;
    const protectedPaths = [
      budget.ONE_USER_FOLLOWUP_ADMISSION,
      join(budget.ONE_USER_FOLLOWUP_DIRECTORY, "activation.json"),
      budget.ONE_USER_FOLLOWUP_REPORT,
      budget.ONE_USER_FOLLOWUP_PREPARATION_REPAIR,
      budget.ONE_USER_FOLLOWUP_PREPARATION_REPAIR_REPORT,
      budget.ONE_USER_FOLLOWUP_LEDGER,
    ];
    const before = await Promise.all(
      protectedPaths.map((path) => readFile(path, "utf8")),
    );
    budget.claimOneUserFollowupCompletion(
      budget.ONE_USER_FOLLOWUP_LEDGER,
      budget.inspectOneUserFollowupQuota(snapshot()),
    );
    const completion = JSON.parse(
      await readFile(budget.ONE_USER_FOLLOWUP_COMPLETION, "utf8"),
    );
    assert.equal(completion.newAllowanceCreated, false);
    assert.equal(completion.sourceReplayAllowed, false);
    assert.equal(completion.checkpointLedger.requests, 5);
    assert.equal(completion.partialReportSha256, hash(before[4] ?? ""));
    assert.equal(completion.preparationRepairSha256, hash(before[3] ?? ""));
    assert.equal(completion.source.fileHash, boundary.source.fileHash);
    assert.equal(
      completion.source.reservationId,
      boundary.source.reservationId,
    );
    assert.equal(
      completion.reportPath,
      budget.ONE_USER_FOLLOWUP_COMPLETION_REPORT,
    );
    assert.equal(
      budget.ONE_USER_FOLLOWUP_COMPLETION_REPORT,
      join(budget.ONE_USER_FOLLOWUP_DIRECTORY, "completion-report.json"),
    );
    assert.deepEqual(
      await Promise.all(protectedPaths.map((path) => readFile(path, "utf8"))),
      before,
    );
    assert.throws(
      () =>
        budget.claimOneUserFollowupCompletion(
          budget.ONE_USER_FOLLOWUP_LEDGER,
          budget.inspectOneUserFollowupQuota(snapshot()),
        ),
      /already consumed/,
    );
    budget.admitOneUserFollowupRequest(
      budget.ONE_USER_FOLLOWUP_LEDGER,
      chatUrl,
      chat(),
    );
    const ledger = budget.readOneUserFollowupLedger(
      budget.ONE_USER_FOLLOWUP_LEDGER,
    );
    assert.equal(ledger.requests, 6);
    assert.equal(ledger.admissionSha256, completion.admissionSha256);
    assert.equal(ledger.policySha256, completion.policySha256);
    assert.deepEqual(
      await Promise.all(
        protectedPaths.slice(0, 5).map((path) => readFile(path, "utf8")),
      ),
      before.slice(0, 5),
    );
    assert.equal(
      await readFile(join(boundary.workspace, boundary.sourcePath), "utf8"),
      boundary.partial.finalWorkspace &&
        (boundary.partial.finalWorkspace as Record<string, unknown>)[
          boundary.sourcePath
        ],
    );
    await assertOldUnchanged(data);
  } finally {
    await data.cleanup();
  }
});

test("FOLLOWUP COMPLETION: attempted maintenance, other errors, uncertain cleanup or changed lineage cannot qualify", async () => {
  for (const alter of [
    (report: Record<string, unknown>) => {
      (report.steps as unknown[]).push({
        id: "native-owner-memory-maintenance",
      });
    },
    (report: Record<string, unknown>) => {
      (report.stages as Record<string, unknown>).promotionEligible = "pass";
    },
    (report: Record<string, unknown>) => {
      report.error = "Another local parser failure";
    },
    (report: Record<string, unknown>) => {
      report.cleanupError = "uncertain";
    },
    (report: Record<string, unknown>) => {
      report.evidenceError = "";
    },
    (report: Record<string, unknown>) => {
      (report.sourceProvenance as Record<string, unknown>).originClass =
        "untrusted";
    },
    (report: Record<string, unknown>) => {
      (report.sourceProvenance as Record<string, unknown>).sessionId =
        "another-session";
    },
    (report: Record<string, unknown>) => {
      (
        report.originalMainBefore as { session: { sessionId: string } }
      ).session.sessionId = "another-main";
    },
  ]) {
    const data = await fixture();
    try {
      await writeCompletionBoundary(data, alter);
      const before = await readFile(
        data.budget.ONE_USER_FOLLOWUP_LEDGER,
        "utf8",
      );
      assert.throws(
        () =>
          data.budget.claimOneUserFollowupCompletion(
            data.budget.ONE_USER_FOLLOWUP_LEDGER,
            data.budget.inspectOneUserFollowupQuota(snapshot()),
          ),
        /not the known incomplete preview boundary/,
      );
      assert.equal(existsSync(data.budget.ONE_USER_FOLLOWUP_COMPLETION), false);
      assert.equal(
        await readFile(data.budget.ONE_USER_FOLLOWUP_LEDGER, "utf8"),
        before,
      );
      await assertOldUnchanged(data);
    } finally {
      await data.cleanup();
    }
  }
});

test("FOLLOWUP COMPLETION: source modification or ledger advancement before claim blocks a stale checkpoint", async () => {
  for (const reason of ["source", "ledger"] as const) {
    const data = await fixture();
    try {
      const boundary = await writeCompletionBoundary(data);
      if (reason === "source")
        await writeFile(
          join(boundary.workspace, boundary.sourcePath),
          "Changed source",
          { mode: 0o600 },
        );
      else
        data.budget.admitOneUserFollowupRequest(
          data.budget.ONE_USER_FOLLOWUP_LEDGER,
          chatUrl,
          chat(),
        );
      const before = await readFile(
        data.budget.ONE_USER_FOLLOWUP_LEDGER,
        "utf8",
      );
      assert.throws(
        () =>
          data.budget.claimOneUserFollowupCompletion(
            data.budget.ONE_USER_FOLLOWUP_LEDGER,
            data.budget.inspectOneUserFollowupQuota(snapshot()),
          ),
        /not the known incomplete preview boundary/,
      );
      assert.equal(existsSync(data.budget.ONE_USER_FOLLOWUP_COMPLETION), false);
      assert.equal(
        await readFile(data.budget.ONE_USER_FOLLOWUP_LEDGER, "utf8"),
        before,
      );
      await assertOldUnchanged(data);
    } finally {
      await data.cleanup();
    }
  }
});

test("FOLLOWUP COMPLETION: all counters stay monotonic and the partial report, repair receipt and source remain frozen", async () => {
  for (const reason of ["rollback", "partial", "repair", "source"] as const) {
    const data = await fixture();
    try {
      const boundary = await writeCompletionBoundary(data);
      data.budget.claimOneUserFollowupCompletion(
        data.budget.ONE_USER_FOLLOWUP_LEDGER,
        data.budget.inspectOneUserFollowupQuota(snapshot()),
      );
      if (reason === "rollback") {
        const ledger = JSON.parse(
          await readFile(data.budget.ONE_USER_FOLLOWUP_LEDGER, "utf8"),
        );
        ledger.chatInputBytes--;
        ledger.inputBytes--;
        await writeFile(
          data.budget.ONE_USER_FOLLOWUP_LEDGER,
          `${JSON.stringify(ledger)}\n`,
          { mode: 0o600 },
        );
      } else if (reason === "source")
        await writeFile(
          join(boundary.workspace, boundary.sourcePath),
          "Changed source",
          { mode: 0o600 },
        );
      else {
        const path =
          reason === "partial"
            ? data.budget.ONE_USER_FOLLOWUP_PREPARATION_REPAIR_REPORT
            : data.budget.ONE_USER_FOLLOWUP_PREPARATION_REPAIR;
        await writeFile(path, `${await readFile(path, "utf8")}\n`, {
          mode: 0o600,
        });
      }
      const before = await readFile(
        data.budget.ONE_USER_FOLLOWUP_LEDGER,
        "utf8",
      );
      assert.throws(
        () =>
          data.budget.admitOneUserFollowupRequest(
            data.budget.ONE_USER_FOLLOWUP_LEDGER,
            chatUrl,
            chat(),
          ),
        /invalid or uncertain/,
      );
      assert.equal(
        await readFile(data.budget.ONE_USER_FOLLOWUP_LEDGER, "utf8"),
        before,
      );
      await assertOldUnchanged(data);
    } finally {
      await data.cleanup();
    }
  }
});

test("FOLLOWUP COMPLETION: stale quota and uncertain existing completion output deny the single checkpoint", async () => {
  for (const reason of ["stale", "output"] as const) {
    const data = await fixture();
    try {
      await writeCompletionBoundary(data);
      if (reason === "output")
        await writeFile(
          data.budget.ONE_USER_FOLLOWUP_COMPLETION_REPORT,
          "uncertain previous completion",
          { mode: 0o600, flag: "wx" },
        );
      const quota = data.budget.inspectOneUserFollowupQuota(snapshot());
      const candidate =
        reason === "stale"
          ? { ...quota, snapshotUpdatedAt: Date.now() - 30001 }
          : quota;
      assert.throws(
        () =>
          data.budget.claimOneUserFollowupCompletion(
            data.budget.ONE_USER_FOLLOWUP_LEDGER,
            candidate,
          ),
        /stale quota|already consumed or uncertain/,
      );
      assert.equal(existsSync(data.budget.ONE_USER_FOLLOWUP_COMPLETION), false);
      assert.equal(
        data.budget.readOneUserFollowupLedger(
          data.budget.ONE_USER_FOLLOWUP_LEDGER,
        ).requests,
        5,
      );
      await assertOldUnchanged(data);
    } finally {
      await data.cleanup();
    }
  }
});

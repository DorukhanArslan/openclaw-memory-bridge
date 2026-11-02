import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Lab } from "../src/lab.ts";
import {
  extractOneUserReply,
  ONE_USER_FLUSH_MARKER,
  ONE_USER_REQUIRED_STAGES,
  type OneUserControls,
  oneUserLifecyclePassed,
  runOneUserLifecycle,
  snapshotOneUserWorkspace,
} from "../src/one-user-lifecycle.ts";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

test("ONE USER DRIVER: required stages cannot pass through omission or a model's claim", () => {
  const stages = Object.fromEntries(
    ONE_USER_REQUIRED_STAGES.map((stage) => [stage, "pass"]),
  );
  assert.equal(oneUserLifecyclePassed({ stages }), true);
  for (const stage of ONE_USER_REQUIRED_STAGES) {
    const incomplete = { ...stages };
    delete incomplete[stage];
    assert.equal(oneUserLifecyclePassed({ stages: incomplete }), false);
    assert.equal(
      oneUserLifecyclePassed({ stages: { ...stages, [stage]: "not-run" } }),
      false,
    );
  }
  assert.equal(
    oneUserLifecyclePassed({ stages, error: "synthetic failure" }),
    false,
  );
  for (const field of ["evidenceError", "cleanupError"])
    assert.equal(
      oneUserLifecyclePassed({ stages, [field]: "synthetic failure" }),
      false,
    );
  assert.equal(oneUserLifecyclePassed({}), false);
});

test("ONE USER DRIVER: reply evidence excludes tool arguments and user text", () => {
  assert.equal(
    extractOneUserReply({ payloads: [{ text: "CLI answer" }] }),
    "CLI answer",
  );
  assert.equal(
    extractOneUserReply({
      completion: { terminalReply: { text: "Gateway answer" } },
    }),
    "Gateway answer",
  );
  assert.equal(
    extractOneUserReply({}, [
      {
        role: "assistant",
        content: [{ type: "text", text: "History answer" }],
      },
    ]),
    "History answer",
  );
  assert.equal(
    extractOneUserReply({ arbitrary: "not an answer" }, [
      { role: "user", content: "do not accept this" },
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            name: "write",
            arguments: { text: "not a reply" },
          },
        ],
      },
      { role: "toolResult", content: "saved" },
    ]),
    "",
  );
});

test("ONE USER DRIVER: evidence snapshots preserve sources and reject links/oversized files", async () => {
  const root = await mkdtemp(join(tmpdir(), "one-user-snapshot-"));
  try {
    await mkdir(join(root, "memory"));
    await writeFile(join(root, "USER.md"), "Synthetic profile\n");
    await writeFile(join(root, "memory/day.md"), "Synthetic event\n");
    await writeFile(join(root, "ignored.json"), "not copied");
    const snapshot = await snapshotOneUserWorkspace(root);
    assert.equal(snapshot["USER.md"], "Synthetic profile\n");
    assert.equal(snapshot["memory/day.md"], "Synthetic event\n");
    assert.equal(snapshot["MEMORY.md"], null);
    assert.equal(snapshot["ignored.json"], undefined);
    assert.equal(
      await readFile(join(root, "USER.md"), "utf8"),
      "Synthetic profile\n",
    );
    await symlink(join(root, "USER.md"), join(root, "memory/link.md"));
    await assert.rejects(snapshotOneUserWorkspace(root), /workspace link/);
    await rm(join(root, "memory/link.md"));
    await writeFile(join(root, "memory/oversized.md"), "x".repeat(100001));
    await assert.rejects(snapshotOneUserWorkspace(root), /evidence bound/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// These deterministic native-shaped fixtures test the coordinator and its
// failure boundaries. They are never persisted as genuine model acceptance.
async function fixture(
  allowWrites = true,
  options: {
    staleReply?: boolean;
    staleCanonicalSources?: boolean;
    priorFlushKind?: string;
    nonownerTeacher?: boolean;
    nonownerTrigger?: boolean;
    untrustedFlush?: boolean;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "one-user-driver-"));
  const directory = join(root, "corpus");
  const workspace = join(directory, "workspace");
  const state = join(directory, "native-state");
  await mkdir(join(workspace, "memory"), { recursive: true });
  await mkdir(join(state, "state"), { recursive: true });
  await writeFile(join(directory, "openclaw.log"), "");
  const day = new Date().toISOString().slice(0, 10);
  const daily = `memory/${day}.md`;
  const histories = new Map<string, Array<Record<string, unknown>>>();
  const parents = new Map<string, string>();
  const checkpoints: Record<string, unknown>[] = [];
  const phases: string[] = [];
  let semantic = false,
    flush = "normal",
    flushDone = false,
    compacted = 0,
    localCalls = 0,
    finished = 0;
  const profile = (drink: string) =>
    `Sable is a fictional botanist. Bicycle commute. 08:00 planning. Orchids on Monday. Current drink: ${drink} tea.\n`;
  const addReply = (
    session: string,
    input: string,
    reply: string,
    tool?: string,
    owner = false,
  ) => {
    const rows = histories.get(session) ?? [];
    rows.push({
      role: "user",
      content: input,
      ...(owner ? { __openclaw: { senderIsOwner: true } } : {}),
    });
    if (tool)
      rows.push(
        { role: "assistant", content: [{ type: "toolCall", name: tool }] },
        {
          role: "toolResult",
          toolName: tool,
          isError: false,
          content: [{ type: "text", text: "fixture success" }],
        },
      );
    rows.push({ role: "assistant", content: [{ type: "text", text: reply }] });
    histories.set(session, rows);
  };
  const sessionState = async (session: string) => ({
    session: {
      sessionId: `fixture-${session}`,
      parentSessionKey: parents.get(session),
    },
    nativeMaintenance: {
      compactionCount: compacted,
      memoryFlush:
        session === "main"
          ? flushDone
            ? { kind: "succeeded" }
            : options.priorFlushKind
              ? { kind: options.priorFlushKind }
              : null
          : null,
    },
  });
  const fake = {
    directory,
    state,
    name: "fixture-one-user",
    createSession: async (session: string) => {
      histories.set(session, histories.get(session) ?? []);
    },
    sessionHistory: async (session: string) => ({
      messages: structuredClone(histories.get(session) ?? []),
    }),
    sessionState,
    index: async () => ({ fixture: true }),
    search: async (query: string) => ({
      provider: semantic ? "openai-compatible" : "none",
      ...(semantic ? { model: "openai/text-embedding-3-small" } : {}),
      results:
        query === "pedal-powered commuting" && !semantic
          ? []
          : [
              {
                path: "USER.md",
                startLine: 1,
                endLine: 1,
                snippet:
                  "Sable currently drinks rooibos and commutes by bicycle.",
              },
            ],
    }),
    get: async () => ({ text: profile("rooibos") }),
    configureFlush: async (mode: string) => {
      flush = mode;
    },
    chat: async (session: string, input: string, owner = false) => {
      let reply = "Acknowledged.";
      if (session === "profile-check")
        reply = "Rooibos tea; Monday orchids (USER.md).";
      if (session === "after-restart")
        reply = `${options.staleReply ? "Mint and rooibos" : "Rooibos"}; Monday; thermometer 18 C; cobalt lantern 09:15 ${ONE_USER_FLUSH_MARKER} (USER.md, ${daily}).`;
      if (session === "main" && flush === "test") {
        const dispatchedAt = Date.now();
        await appendFile(
          join(directory, "openclaw.log"),
          `${JSON.stringify({
            "0": '{"subsystem":"auto-reply/memory-flush"}',
            "1": {
              event: "memory_flush_dispatched",
              runId: "fixture-flush",
              sessionId: "internal-session-effects-fixture",
              sessionKey: "agent:main:internal-session-effects:fixture",
              sourceSessionId: "fixture-main",
              sourceSessionKey: "agent:main:main",
            },
            _meta: {
              logLevelName: "DEBUG",
              date: new Date(dispatchedAt).toISOString(),
            },
          })}\n`,
        );
        await appendFile(
          join(workspace, daily),
          `- Cobalt lantern inspection 09:15: ${ONE_USER_FLUSH_MARKER}.\n`,
        );
        const content = await readFile(join(workspace, daily), "utf8");
        const database = new DatabaseSync(join(state, "state/openclaw.sqlite"));
        database.exec(
          "CREATE TABLE plugin_state_entries(plugin_id TEXT, namespace TEXT, entry_key TEXT, value_json TEXT)",
        );
        const workspaceKey = sha256(workspace);
        database
          .prepare("INSERT INTO plugin_state_entries VALUES(?,?,?,?)")
          .run(
            "core:memory-artifact-provenance",
            "workspace-files",
            `${workspaceKey}:${sha256(daily)}`,
            JSON.stringify({
              version: 1,
              reservationId: "fixture-reservation",
              workspaceKey,
              relativePath: daily,
              fileHash: sha256(content),
              originClass: options.untrustedFlush ? "untrusted" : "agent",
              observedAt: Date.now(),
              sessionId: "internal-session-effects-fixture",
              sessionKey: "agent:main:internal-session-effects:fixture",
            }),
          );
        database.close();
        flushDone = true;
      }
      addReply(session, input, reply, undefined, owner);
      return {
        completion: { terminalReply: { text: reply } },
        state: await sessionState(session),
      };
    },
    waitForFlush: async (session: string) => sessionState(session),
    compactSession: async () => ({
      native: { compacted: true, result: { summary: "Fixture summary" } },
      state: { nativeMaintenance: { compactionCount: ++compacted } },
    }),
    remStage: async () => ({ fixture: true }),
    dreamRun: async () => {
      await writeFile(
        join(workspace, "MEMORY.md"),
        `Sable checked the thermometer. source=${daily}\n`,
      );
      await writeFile(
        join(workspace, "DREAMS.md"),
        "Synthetic fixture diary, not model evidence.\n",
      );
      await appendFile(
        join(directory, "openclaw.log"),
        `${["light", "rem", "deep"]
          .map(
            (phase) => `fixture dream diary entry written for ${phase} phase`,
          )
          .join("\n")}\n`,
      );
      return { completed: true, completionStatus: "succeeded" };
    },
    dreamStatus: async () => ({ fixture: true }),
    dreamDiary: async () => ({ content: "fixture only" }),
    restart: async () => {
      if (options.staleCanonicalSources)
        await writeFile(
          join(workspace, "memory/preferences.md"),
          profile("mint"),
        );
      return { fixture: true, restarted: true };
    },
  };
  const controls: OneUserControls = {
    ledgerPath: join(root, "fixture-ledger.json"),
    evidenceDirectory: root,
    activate: async () => {},
    phase: async (name) => {
      phases.push(name);
      if (name === "semantic") semantic = true;
      if (name === "flush") flush = "test";
    },
    rpc: async (method, params) => {
      if (method === "sessions.create") {
        const session = String(params?.key).split(":").at(-1) as string;
        histories.set(session, []);
        parents.set(session, String(params?.parentSessionKey));
        return { fixture: true };
      }
      if (method === "sessions.usage") {
        const user = await readFile(join(workspace, "USER.md"), "utf8");
        return {
          sessions: [
            {
              key: "agent:main:profile-check",
              sessionId: "fixture-profile-check",
              contextWeight: {
                injectedWorkspaceFiles: [
                  {
                    name: "USER.md",
                    missing: false,
                    rawChars: user.trimEnd().length,
                    injectedChars: user.trimEnd().length,
                  },
                ],
              },
            },
          ],
        };
      }
      throw new Error("Unexpected fixture RPC.");
    },
    localTurn: async (session, input) => {
      localCalls++;
      const teacher = input.startsWith("For our ongoing greenhouse routine");
      if (teacher) {
        addReply(
          session,
          input,
          "Acknowledged the standing checklist.",
          undefined,
          !options.nonownerTeacher,
        );
        return { payloads: [{ text: "Acknowledged the standing checklist." }] };
      }
      const update = input.startsWith("My current morning drink");
      if (allowWrites) {
        await writeFile(
          join(workspace, "USER.md"),
          profile(update ? "rooibos" : "mint"),
        );
        await writeFile(
          join(workspace, "memory/preferences.md"),
          profile(update ? "rooibos" : "mint"),
        );
        if (!update)
          await writeFile(
            join(workspace, daily),
            "Thermometer 18 C at 08:00.\n",
          );
      }
      addReply(
        session,
        input,
        "Saved the requested fixture facts.",
        allowWrites ? (update ? "edit" : "write") : undefined,
        true,
      );
      return { payloads: [{ text: "Saved the requested fixture facts." }] };
    },
    ownerTurn: async (session, input) =>
      fake.chat(session, input, !options.nonownerTrigger),
    checkpoint: async (report) => {
      checkpoints.push(JSON.parse(JSON.stringify(report)));
    },
    finish: async () => {
      finished++;
    },
  };
  return {
    root,
    fake: fake as unknown as Lab,
    controls,
    phases,
    checkpoints,
    counts: () => ({ localCalls, finished }),
  };
}

test("ONE USER DRIVER FIXTURE: complete native-shaped sequence preserves lineage and cleanup", async () => {
  const f = await fixture(true, { priorFlushKind: "skipped" });
  try {
    const result = await runOneUserLifecycle(f.fake, f.controls);
    assert.equal(result.ok, true, String(result.error));
    assert.equal(oneUserLifecyclePassed(result), true);
    assert.deepEqual(f.phases, ["profile", "semantic", "flush", "maintenance"]);
    assert.deepEqual(f.counts(), { localCalls: 3, finished: 1 });
    assert.ok(f.checkpoints.length > 8);
    assert.equal(
      (result.flushEvidence as { attribution: { accepted: boolean } })
        .attribution.accepted,
      true,
    );
    assert.match((result.finalRecall as { bot: string }).bot, /rooibos/i);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("ONE USER DRIVER FIXTURE: restart cannot pass with stale current preference in reply or canonical source", async () => {
  for (const options of [
    { staleReply: true },
    { staleCanonicalSources: true },
  ]) {
    const f = await fixture(true, options);
    try {
      const result = await runOneUserLifecycle(f.fake, f.controls);
      assert.equal(result.ok, false);
      assert.match(String(result.error), /restartRecall/);
      assert.equal(oneUserLifecyclePassed(result), false);
      assert.equal(f.counts().finished, 1);
      assert.ok(result.finalWorkspace);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

test("ONE USER DRIVER FIXTURE: missing native owner attestation or untrusted flush stops before maintenance", async () => {
  for (const options of [
    { nonownerTeacher: true },
    { nonownerTrigger: true },
    { untrustedFlush: true },
  ]) {
    const f = await fixture(true, options);
    try {
      const result = await runOneUserLifecycle(f.fake, f.controls);
      assert.equal(result.ok, false);
      assert.match(
        String(result.error),
        options.nonownerTeacher ? /flushInputStaged/ : /flushPhysicalWrite/,
      );
      assert.equal(oneUserLifecyclePassed(result), false);
      assert.ok(!f.phases.includes("maintenance"));
      assert.equal(
        (result.stages as Record<string, string>).compaction,
        "not-run",
      );
      assert.equal(f.counts().finished, 1);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

test("ONE USER DRIVER FIXTURE: claimed writes without changed native sources stop and checkpoint", async () => {
  const f = await fixture(false);
  try {
    const result = await runOneUserLifecycle(f.fake, f.controls);
    assert.equal(result.ok, false);
    assert.match(String(result.error), /profileWrite/);
    assert.deepEqual(f.phases, ["profile"]);
    assert.deepEqual(f.counts(), { localCalls: 1, finished: 1 });
    assert.ok(f.checkpoints.length >= 2);
    assert.equal(
      (result.stages as Record<string, string>).semanticRecall,
      "not-run",
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

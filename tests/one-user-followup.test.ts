import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Lab } from "../src/lab.ts";
import {
  ONE_USER_FOLLOWUP_RECALL,
  ONE_USER_FOLLOWUP_REQUIRED_STAGES,
  ONE_USER_FOLLOWUP_SOURCE,
  type OneUserFollowupControls,
  oneUserFollowupPassed,
  runOneUserFollowup,
} from "../src/one-user-followup.ts";
import { ONE_USER_FLUSH_MARKER } from "../src/one-user-lifecycle.ts";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type Dict = Record<string, unknown>;
type FixtureOptions = {
  nonOwnerSource?: boolean;
  untrustedSource?: boolean;
  wrongSourceHash?: boolean;
  inheritedHistory?: boolean;
  noOwnerGrant?: boolean;
  noEligibleCandidate?: boolean;
  missingDeep?: boolean;
  staleReply?: boolean;
  mutateOriginalSource?: boolean;
  mutateOriginalReport?: boolean;
  cleanupFailure?: boolean;
  previewParseFailure?: boolean;
};

// These disposable native-shaped fixtures test acceptance boundaries only.
// Their SQLite rows, tool traces and model replies are deliberately synthetic.
async function fixture(options: FixtureOptions = {}) {
  const temporary = await mkdtemp(join(tmpdir(), "one-user-followup-"));
  const previous = join(temporary, "prior");
  const root = join(previous, "corpus");
  const directory = join(root, "one-user");
  const workspace = join(directory, "workspace");
  const state = join(directory, "state");
  const databasePath = join(state, "state/openclaw.sqlite");
  await mkdir(join(workspace, "memory"), { recursive: true });
  await mkdir(join(state, "state"), { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const previousDay = new Date(Date.now() - 86400000)
    .toISOString()
    .slice(0, 10);
  const daily = `memory/${day}.md`;
  const previousDaily = `memory/${previousDay}.md`;
  const previousReport = JSON.stringify({
    kind: "current-one-user-native-lifecycle",
    ok: false,
    nativeSourceDayUtc: previousDay,
    stages: { flushPhysicalWrite: "pass", compaction: "pass" },
    sourceSessionBefore: { session: { sessionId: "fixture-main" } },
  });
  const originalFiles = new Map<string, string>([
    [join(previous, "report.json"), previousReport],
    [join(previous, "admission.json"), "synthetic consumed admission\n"],
    [join(previous, "activation.json"), "synthetic consumed activation\n"],
    [join(previous, "ledger.json"), "synthetic reserved counters\n"],
    [join(workspace, "USER.md"), "Sable; rooibos tea; Monday orchids.\n"],
    [join(workspace, "memory/preferences.md"), "Rooibos, Monday, bicycle.\n"],
    [join(workspace, previousDaily), "Existing quarantined historical note.\n"],
  ]);
  await Promise.all(
    [...originalFiles].map(([path, content]) => writeFile(path, content)),
  );
  await writeFile(join(directory, "openclaw.log"), "");
  const database = new DatabaseSync(databasePath);
  database.exec(
    "CREATE TABLE plugin_state_entries(plugin_id TEXT,namespace TEXT,entry_key TEXT,value_json TEXT)",
  );
  database.close();
  const histories = new Map<string, Dict[]>([["main", []]]);
  const parents = new Map<string, { key: string; id: string }>();
  const checkpoints: Dict[] = [];
  const calls = { owner: 0, maintenance: 0, restart: 0, finish: 0 };
  const phases: string[] = [];
  const activity = { activate: 0, createSource: 0, search: 0, index: 0 };
  let previewFailed = false;
  let completionMode = false;
  let phase = "inactive";
  let flush = "normal";
  let queryRecorded = false;
  let configuredProvider = "keyword";
  let indexedProvider = "keyword";
  const assertIndexReady = () =>
    assert.equal(
      configuredProvider,
      indexedProvider,
      "Native Gateway readiness requires the selected provider's rebuilt index.",
    );
  const sessionState = async (session: string) => {
    assertIndexReady();
    return {
      session: {
        sessionId: `fixture-${session}`,
        parentSessionKey: parents.get(session)?.key,
        parentSessionId: parents.get(session)?.id,
      },
      nativeMaintenance: { compactionCount: session === "main" ? 1 : 0 },
    };
  };
  const newSource = `# ${day} (UTC)\n\n- Sable confirmed on ${day}: rooibos tea; Monday orchids; bicycle; cobalt lantern 09:15; ${ONE_USER_FLUSH_MARKER}.\n- Historical ${previousDay} 08:00 thermometer: 18 C.\n`;
  const fake = {
    root,
    directory,
    state,
    sessionState,
    sessionHistory: async (session: string) => {
      assertIndexReady();
      return { messages: structuredClone(histories.get(session) ?? []) };
    },
    configureFlush: async (mode: string) => {
      flush = mode;
    },
    index: async () => {
      activity.index++;
      assert.equal(configuredProvider, "semantic");
      indexedProvider = configuredProvider;
      return { synthetic: true };
    },
    search: async (query: string, session: string) => {
      activity.search++;
      assert.equal(
        completionMode,
        false,
        "A completion must inherit its genuine semantic query evidence.",
      );
      assertIndexReady();
      assert.equal(configuredProvider, "semantic");
      assert.equal(query, ONE_USER_FLUSH_MARKER);
      assert.equal(session, ONE_USER_FOLLOWUP_SOURCE);
      assert.equal(
        phase,
        "maintenance",
        "Real-query signals need dreaming enabled.",
      );
      queryRecorded = true;
      return {
        provider: "openai-compatible",
        model: "openai/text-embedding-3-small",
        results: [
          { path: daily, snippet: newSource, startLine: 1, endLine: 4 },
        ],
      };
    },
    promote: async (apply: boolean) => {
      assert.equal(apply, false);
      assert.equal(queryRecorded, true);
      if (options.previewParseFailure && !previewFailed) {
        previewFailed = true;
        throw new Error(
          "Synthetic native promotion-preview JSON parse failure",
        );
      }
      return {
        candidates: options.noEligibleCandidate
          ? []
          : [
              {
                path: daily,
                signalCount: 1,
                uniqueQueries: 1,
                provenance: { originClass: "agent" },
              },
            ],
      };
    },
    dreamRun: async () => {
      calls.maintenance++;
      assert.equal(phase, "maintenance");
      assert.equal(flush, "off");
      if (!options.missingDeep)
        await writeFile(
          join(workspace, "MEMORY.md"),
          `## Native-shaped fixture promotion\n- Rooibos tea; cobalt lantern ${ONE_USER_FLUSH_MARKER}. source=${daily}:3-4\n`,
        );
      await writeFile(
        join(workspace, "DREAMS.md"),
        "Synthetic fixture diary.\n",
      );
      const published = options.missingDeep
        ? ["light", "rem"]
        : ["light", "rem", "deep"];
      await appendFile(
        join(directory, "openclaw.log"),
        `fixture dreaming promotion complete (workspaces=1, candidates=1, applied=${options.missingDeep ? 0 : 1}, failed=0, degraded=0, narrativesPending=3).\n${published.map((item) => `fixture dream diary entry written for ${item} phase`).join("\n")}\n`,
      );
      if (options.mutateOriginalSource)
        await appendFile(
          join(workspace, previousDaily),
          "Unexpected source mutation.\n",
        );
      if (options.mutateOriginalReport)
        await appendFile(join(previous, "report.json"), " ");
      return { completed: true, completionStatus: "succeeded" };
    },
    dreamStatus: async () => ({ synthetic: true }),
    dreamDiary: async () => ({ synthetic: true }),
    restart: async () => {
      calls.restart++;
      assert.equal(phase, "recall");
      assert.equal(flush, "off");
      return { restarted: true, synthetic: true };
    },
  };
  const controls: OneUserFollowupControls = {
    ledgerPath: join(temporary, "followup/ledger.json"),
    evidenceDirectory: join(temporary, "followup"),
    activate: async () => {
      activity.activate++;
      phase = "keyword";
    },
    phase: async (value) => {
      phase = value;
      phases.push(value);
      flush = value === "semantic" ? "normal" : "off";
      if (value === "semantic") configuredProvider = "semantic";
    },
    rpc: async (method, params) => {
      assertIndexReady();
      assert.equal(method, "sessions.create");
      const session = String(params?.key).split(":").at(-1) as string;
      const parent = String(params?.parentSessionKey)
        .split(":")
        .at(-1) as string;
      assert.equal(params?.emitCommandHooks, false);
      if (session === ONE_USER_FOLLOWUP_SOURCE) {
        activity.createSource++;
        assert.equal(
          completionMode,
          false,
          "A completion cannot recreate its source child.",
        );
      }
      parents.set(session, {
        key: String(params?.parentSessionKey),
        id: `fixture-${parent}`,
      });
      histories.set(
        session,
        options.inheritedHistory
          ? [{ role: "user", content: "Inherited fixture conversation" }]
          : [],
      );
      return { synthetic: true };
    },
    ownerTurn: async (session, input) => {
      assertIndexReady();
      calls.owner++;
      const rows = histories.get(session) ?? [];
      rows.push({
        role: "user",
        content: input,
        __openclaw: {
          senderIsOwner: !(
            session === ONE_USER_FOLLOWUP_SOURCE && options.nonOwnerSource
          ),
        },
      });
      let reply: string;
      if (session === ONE_USER_FOLLOWUP_SOURCE) {
        assert.equal(
          completionMode,
          false,
          "A completion cannot dispatch the source-owner turn again.",
        );
        assert.equal(
          phase,
          "keyword",
          "The first source write must keep the retained keyword index/provider identity.",
        );
        assert.equal(configuredProvider, "keyword");
        assert.equal(flush, "normal");
        await writeFile(join(workspace, daily), newSource);
        const workspaceKey = sha256(await realpath(workspace));
        const provenance = {
          version: 1,
          reservationId: "synthetic-source-write",
          workspaceKey,
          relativePath: daily,
          fileHash: options.wrongSourceHash
            ? "0".repeat(64)
            : sha256(newSource),
          originClass: options.untrustedSource ? "untrusted" : "agent",
          observedAt: Date.now(),
          sessionId: `fixture-${session}`,
          sessionKey: `agent:main:${session}`,
        };
        const writer = new DatabaseSync(databasePath);
        writer
          .prepare("INSERT INTO plugin_state_entries VALUES(?,?,?,?)")
          .run(
            "core:memory-artifact-provenance",
            "workspace-files",
            `${workspaceKey}:${sha256(daily)}`,
            JSON.stringify(provenance),
          );
        writer.close();
        rows.push(
          {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                name: "write",
                arguments: { path: daily, content: newSource },
              },
            ],
          },
          {
            role: "toolResult",
            toolName: "write",
            isError: false,
            content: "Synthetic write completed.",
          },
        );
        reply = "The new confirmation note was written.";
      } else {
        assert.equal(session, ONE_USER_FOLLOWUP_RECALL);
        assert.equal(phase, "recall");
        assert.equal(flush, "off");
        reply = `${options.staleReply ? "Mint and rooibos" : "Rooibos"} tea; Monday orchids; historical thermometer 18 C; cobalt lantern 09:15 ${ONE_USER_FLUSH_MARKER}. Sources: USER.md and ${daily}.`;
        rows.push(
          {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                name: "memory_get",
                arguments: { path: daily },
              },
            ],
          },
          { role: "toolResult", toolName: "memory_get", content: newSource },
        );
      }
      rows.push({
        role: "assistant",
        content: [{ type: "text", text: reply }],
      });
      histories.set(session, rows);
      return {
        ownerConnection: {
          role: "operator",
          scopes: options.noOwnerGrant
            ? ["operator.write"]
            : ["operator.admin"],
        },
        accepted: { runId: `fixture-run-${session}` },
        completion: { status: "ok", terminalReply: { text: reply } },
      };
    },
    checkpoint: async (value) => {
      checkpoints.push(structuredClone(value));
    },
    finish: async () => {
      calls.finish++;
      if (options.cleanupFailure)
        throw new Error("Synthetic scoped cleanup failure");
    },
  };
  return {
    lab: fake as unknown as Lab,
    controls,
    calls,
    phases,
    checkpoints,
    originalFiles,
    daily,
    activity,
    sourcePath: join(workspace, daily),
    databasePath,
    sourceHash: sha256(newSource),
    prepareCompletion: async (partial: Dict) => {
      const path = join(
        controls.evidenceDirectory,
        "preparation-repair-report.json",
      );
      await mkdir(controls.evidenceDirectory, { recursive: true });
      const bytes = `${JSON.stringify(partial, null, 2)}\n`;
      await writeFile(path, bytes, { flag: "wx" });
      Reflect.set(controls, "completionCheckpoint", path);
      completionMode = true;
      configuredProvider = "keyword";
      phase = "inactive";
      return { path, bytes, sha256: sha256(bytes) };
    },
    dispose: () => rm(temporary, { recursive: true, force: true }),
  };
}

test("FOLLOW-UP DRIVER: all required evidence and cleanup gates must pass", () => {
  const stages = Object.fromEntries(
    ONE_USER_FOLLOWUP_REQUIRED_STAGES.map((stage) => [stage, "pass"]),
  );
  assert.equal(oneUserFollowupPassed({ stages }), true);
  for (const stage of ONE_USER_FOLLOWUP_REQUIRED_STAGES) {
    const partial = { ...stages };
    delete partial[stage];
    assert.equal(oneUserFollowupPassed({ stages: partial }), false);
  }
  for (const field of ["error", "cleanupError", "evidenceError"])
    assert.equal(
      oneUserFollowupPassed({ stages, [field]: "synthetic uncertainty" }),
      false,
    );
});

test("FOLLOW-UP DRIVER: isolated owner source, real-query eligibility, maintenance and fresh linked recall retain original evidence", async () => {
  const setup = await fixture();
  try {
    const report = await runOneUserFollowup(setup.lab, setup.controls);
    assert.equal(report.ok, true, String(report.error ?? report.evidenceError));
    assert.equal(oneUserFollowupPassed(report), true);
    assert.deepEqual(setup.phases, ["semantic", "maintenance", "recall"]);
    assert.deepEqual(setup.calls, {
      owner: 2,
      maintenance: 1,
      restart: 1,
      finish: 1,
    });
    assert.equal(report.originalAttemptReplayed, false);
    assert.equal(report.harnessSourceWrites, false);
    assert.equal((report.sourceProvenance as Dict).originClass, "agent");
    assert.equal((report.sourceProvenance as Dict).relativePath, setup.daily);
    for (const [path, original] of setup.originalFiles)
      assert.equal(await readFile(path, "utf8"), original);
    assert.equal(setup.checkpoints.at(-1)?.ok, true);
  } finally {
    await setup.dispose();
  }
});

test("FOLLOW-UP DRIVER: server grant, native owner metadata and current native agent hash are independent preconditions", async () => {
  for (const options of [
    { noOwnerGrant: true },
    { nonOwnerSource: true },
    { untrustedSource: true },
    { wrongSourceHash: true },
  ]) {
    const setup = await fixture(options);
    try {
      const report = await runOneUserFollowup(setup.lab, setup.controls);
      assert.equal(report.ok, false);
      assert.match(
        String(report.error),
        /owner connection receipt|native owner input|native agent provenance/,
      );
      assert.equal(setup.calls.maintenance, 0);
      assert.equal(setup.calls.restart, 0);
      assert.equal(setup.calls.finish, 1);
    } finally {
      await setup.dispose();
    }
  }
});

test("FOLLOW-UP DRIVER: inherited history is rejected before any model-shaped turn", async () => {
  const setup = await fixture({ inheritedHistory: true });
  try {
    const report = await runOneUserFollowup(setup.lab, setup.controls);
    assert.equal(report.ok, false);
    assert.match(String(report.error), /fresh native child/);
    assert.equal(setup.calls.owner, 0);
  } finally {
    await setup.dispose();
  }
});

test("FOLLOW-UP DRIVER: native promotion eligibility stops an ungrounded sweep before paid maintenance", async () => {
  const setup = await fixture({ noEligibleCandidate: true });
  try {
    const report = await runOneUserFollowup(setup.lab, setup.controls);
    assert.equal(report.ok, false);
    assert.match(String(report.error), /promotionEligible/);
    assert.equal(setup.calls.maintenance, 0);
    assert.equal(setup.calls.owner, 1);
  } finally {
    await setup.dispose();
  }
});

test("FOLLOW-UP DRIVER: zero promotions and missing deep publisher cannot pass the maintenance gate", async () => {
  const setup = await fixture({ missingDeep: true });
  try {
    const report = await runOneUserFollowup(setup.lab, setup.controls);
    assert.equal(report.ok, false);
    assert.match(String(report.error), /nativeMaintenance/);
    assert.equal(setup.calls.maintenance, 1);
    assert.equal(setup.calls.restart, 0);
    assert.equal(setup.calls.owner, 1);
  } finally {
    await setup.dispose();
  }
});

test("FOLLOW-UP DRIVER: final model answer cannot retain stale mint as a current preference", async () => {
  const setup = await fixture({ staleReply: true });
  try {
    const report = await runOneUserFollowup(setup.lab, setup.controls);
    assert.equal(report.ok, false);
    assert.match(String(report.error), /restartRecall/);
    assert.equal(setup.calls.restart, 1);
  } finally {
    await setup.dispose();
  }
});

test("FOLLOW-UP DRIVER: original source/report mutations and cleanup uncertainty override otherwise successful gates", async () => {
  for (const options of [
    { mutateOriginalSource: true },
    { mutateOriginalReport: true },
    { cleanupFailure: true },
  ]) {
    const setup = await fixture(options);
    try {
      const report = await runOneUserFollowup(setup.lab, setup.controls);
      assert.equal(report.ok, false);
      assert.equal(oneUserFollowupPassed(report), false);
      assert.match(
        String(report.evidenceError ?? report.cleanupError),
        /source changed|evidence changed|cleanup failure/,
      );
      assert.equal(setup.calls.owner, 2);
      assert.equal(setup.calls.finish, 1);
      assert.equal(setup.checkpoints.at(-1)?.ok, false);
    } finally {
      await setup.dispose();
    }
  }
});

test("FOLLOW-UP COMPLETION: immutable paid preparation is inherited without another source turn, child creation or semantic query", async () => {
  const setup = await fixture({ previewParseFailure: true });
  try {
    const partial = await runOneUserFollowup(setup.lab, setup.controls);
    assert.equal(partial.ok, false);
    assert.match(String(partial.error), /promotion-preview JSON parse failure/);
    assert.equal((partial.stages as Dict).sourceOwnerWrite, "pass");
    assert.equal((partial.stages as Dict).semanticRecall, "pass");
    assert.equal((partial.stages as Dict).previousEvidencePreserved, "pass");
    assert.deepEqual(setup.calls, {
      owner: 1,
      maintenance: 0,
      restart: 0,
      finish: 1,
    });
    assert.equal(setup.activity.createSource, 1);
    assert.equal(setup.activity.search, 1);
    const checkpoint = await setup.prepareCompletion(partial);
    const completed = await runOneUserFollowup(setup.lab, setup.controls);
    assert.equal(
      completed.ok,
      true,
      String(completed.error ?? completed.evidenceError),
    );
    assert.equal(oneUserFollowupPassed(completed), true);
    assert.deepEqual(setup.calls, {
      owner: 2,
      maintenance: 1,
      restart: 1,
      finish: 2,
    });
    assert.equal(setup.activity.createSource, 1);
    assert.equal(setup.activity.search, 1);
    const inherited = completed.inheritedEvidence as Dict;
    assert.equal(inherited.path, checkpoint.path);
    assert.equal(inherited.sha256, checkpoint.sha256);
    assert.deepEqual(inherited.stages, ["sourceOwnerWrite", "semanticRecall"]);
    assert.equal(
      inherited.sourceSessionKey,
      `agent:main:${ONE_USER_FOLLOWUP_SOURCE}`,
    );
    assert.equal(
      inherited.sourceSessionId,
      `fixture-${ONE_USER_FOLLOWUP_SOURCE}`,
    );
    assert.equal(inherited.sourceFileSha256, setup.sourceHash);
    assert.equal((completed.sourceSession as Dict).inherited, true);
    const steps = completed.steps as Dict[];
    assert.equal(steps.length, 2);
    assert.equal(
      steps.some((step) => step.id === "owner-confirmed-new-day-source"),
      false,
    );
    assert.equal(await readFile(checkpoint.path, "utf8"), checkpoint.bytes);
    for (const [path, original] of setup.originalFiles)
      assert.equal(await readFile(path, "utf8"), original);
  } finally {
    await setup.dispose();
  }
});

test("FOLLOW-UP COMPLETION: changed current source, saved provenance, parent or preparation stages fail before reactivation", async () => {
  for (const corruption of [
    "current-source",
    "saved-provenance",
    "saved-parent",
    "saved-stages",
    "current-provenance",
  ] as const) {
    const setup = await fixture({ previewParseFailure: true });
    try {
      const partial = await runOneUserFollowup(setup.lab, setup.controls);
      assert.equal(partial.ok, false);
      assert.match(
        String(partial.error),
        /promotion-preview JSON parse failure/,
      );
      const edited = structuredClone(partial);
      if (corruption === "saved-provenance")
        (edited.sourceProvenance as Dict).fileHash = "0".repeat(64);
      if (corruption === "saved-parent") {
        const sourceSession = edited.sourceSession as {
          state: { session: Dict };
        };
        sourceSession.state.session.parentSessionId = "unexpected-parent-id";
      }
      if (corruption === "saved-stages")
        (edited.stages as Dict).semanticRecall = "not-run";
      const checkpoint = await setup.prepareCompletion(edited);
      if (corruption === "current-source")
        await appendFile(
          setup.sourcePath,
          "Unexpected current source mutation.\n",
        );
      if (corruption === "current-provenance") {
        const database = new DatabaseSync(setup.databasePath);
        const row = database
          .prepare("SELECT value_json FROM plugin_state_entries")
          .get() as { value_json: string };
        const provenance = JSON.parse(row.value_json);
        provenance.originClass = "untrusted";
        database
          .prepare("UPDATE plugin_state_entries SET value_json=?")
          .run(JSON.stringify(provenance));
        database.close();
      }
      const activated = setup.activity.activate;
      const rejected = await runOneUserFollowup(setup.lab, setup.controls);
      assert.equal(
        rejected.ok,
        false,
        `Corruption must not pass: ${corruption}`,
      );
      assert.ok(rejected.error, `No causal failure recorded for ${corruption}`);
      assert.equal(
        setup.activity.activate,
        activated,
        `Corrupt ${corruption} must fail before reactivation.`,
      );
      assert.equal(setup.calls.owner, 1);
      assert.equal(setup.calls.maintenance, 0);
      assert.equal(setup.activity.createSource, 1);
      assert.equal(setup.activity.search, 1);
      assert.equal(await readFile(checkpoint.path, "utf8"), checkpoint.bytes);
    } finally {
      await setup.dispose();
    }
  }
});

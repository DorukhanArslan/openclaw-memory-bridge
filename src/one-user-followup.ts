import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Lab } from "./lab.ts";
import {
  extractOneUserReply,
  ONE_USER_FLUSH_MARKER,
  snapshotOneUserWorkspace,
} from "./one-user-lifecycle.ts";

export const ONE_USER_FOLLOWUP_SOURCE = "owner-followup";
export const ONE_USER_FOLLOWUP_RECALL = "followup-recall";
export const ONE_USER_FOLLOWUP_REQUIRED_STAGES = [
  "sourceOwnerWrite",
  "semanticRecall",
  "promotionEligible",
  "nativeMaintenance",
  "durablePromotion",
  "restartRecall",
  "sessionContinuity",
  "previousEvidencePreserved",
] as const;
export const ONE_USER_FOLLOWUP_STAGES = ONE_USER_FOLLOWUP_REQUIRED_STAGES;

export type OneUserFollowupControls = {
  ledgerPath: string;
  evidenceDirectory: string;
  completionCheckpoint?: string;
  activate(path: string): Promise<void>;
  phase(name: "semantic" | "maintenance" | "recall"): Promise<void>;
  rpc(
    method: string,
    params?: Record<string, unknown>,
    timeout?: number,
  ): Promise<unknown>;
  ownerTurn(session: string, message: string): Promise<unknown>;
  checkpoint(report: Record<string, unknown>): Promise<void>;
  finish(): Promise<void>;
};
type Dict = Record<string, unknown>;
type Snapshot = Record<string, string | null>;
type Message = {
  role?: string;
  content?: unknown;
  toolName?: string;
  isError?: boolean;
  __openclaw?: unknown;
};
type State = {
  session?: {
    sessionId?: string;
    parentSessionKey?: string;
    parentSessionId?: string;
  };
  nativeMaintenance?: { compactionCount?: number };
};
const record = (value: unknown): value is Dict =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const key = (session: string) => `agent:main:${session}`;
const parts = (value: unknown): string =>
  typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value
          .filter(
            (item) =>
              record(item) &&
              item.type === "text" &&
              typeof item.text === "string",
          )
          .map((item) => (item as { text: string }).text)
          .join("\n")
      : "";
const hasOwnerInput = (messages: Message[], input: string) =>
  messages.some(
    (message) =>
      message.role === "user" &&
      parts(message.content) === input &&
      record(message.__openclaw) &&
      message.__openclaw.senderIsOwner === true,
  );
const toolCalls = (messages: Message[]) =>
  messages.flatMap((message) =>
    message.role === "assistant" && Array.isArray(message.content)
      ? message.content
          .filter((part) => record(part) && part.type === "toolCall")
          .map((part) =>
            String((part as Dict).name ?? (part as Dict).toolName ?? ""),
          )
      : [],
  );
const changes = (before: Snapshot, after: Snapshot) =>
  Object.keys({ ...before, ...after }).filter(
    (path) => before[path] !== after[path],
  );

export function oneUserFollowupPassed(report: Dict): boolean {
  return (
    !report.error &&
    !report.evidenceError &&
    !report.cleanupError &&
    record(report.stages) &&
    ONE_USER_FOLLOWUP_STAGES.every(
      (stage) => (report.stages as Dict)[stage] === "pass",
    )
  );
}

/** Read only: this never manufactures or repairs native artifact provenance. */
export async function readFollowupSourceProvenance(options: {
  stateDir: string;
  workspace: string;
  relativePath: string;
  sourceSessionKey: string;
  sourceSessionId: string;
  startedAtMs: number;
  finishedAtMs: number;
}) {
  if (!/^memory\/\d{4}-\d{2}-\d{2}\.md$/.test(options.relativePath))
    throw new Error(
      "Follow-up provenance accepts only its dated memory source.",
    );
  const workspaceKey = hash(await realpath(options.workspace));
  const fileHash = hash(
    await readFile(join(options.workspace, options.relativePath)),
  );
  const database = new DatabaseSync(
    join(options.stateDir, "state/openclaw.sqlite"),
    { readOnly: true },
  );
  let row: { value_json?: unknown } | undefined;
  try {
    row = database
      .prepare(
        "SELECT value_json FROM plugin_state_entries WHERE plugin_id=? AND namespace=? AND entry_key=?",
      )
      .get(
        "core:memory-artifact-provenance",
        "workspace-files",
        `${workspaceKey}:${hash(options.relativePath)}`,
      ) as typeof row;
  } finally {
    database.close();
  }
  const value =
    typeof row?.value_json === "string" ? JSON.parse(row.value_json) : null;
  if (
    !record(value) ||
    value.version !== 1 ||
    value.workspaceKey !== workspaceKey ||
    value.relativePath !== options.relativePath ||
    value.fileHash !== fileHash ||
    value.originClass !== "agent" ||
    value.sessionKey !== options.sourceSessionKey ||
    value.sessionId !== options.sourceSessionId ||
    typeof value.reservationId !== "string" ||
    !value.reservationId ||
    typeof value.observedAt !== "number" ||
    value.observedAt < options.startedAtMs ||
    value.observedAt > options.finishedAtMs
  )
    throw new Error(
      "Follow-up source lacks current native agent provenance for its fresh owner session.",
    );
  return value;
}

/** Current new-day continuation in the retained corpus; the original attempt is immutable. */
export async function runOneUserFollowup(
  lab: Lab,
  controls: OneUserFollowupControls,
): Promise<Dict> {
  const day = new Date().toISOString().slice(0, 10);
  const daily = `memory/${day}.md`;
  const workspace = join(lab.directory, "workspace");
  const previousDirectory = dirname(lab.root);
  const preservedPaths = [
    "admission.json",
    "activation.json",
    "ledger.json",
    "report.json",
  ];
  const stages: Record<string, string> = Object.fromEntries(
    ONE_USER_FOLLOWUP_STAGES.map((stage) => [stage, "not-run"]),
  );
  const report: Dict = {
    schemaVersion: 1,
    kind: "one-user-owner-maintenance-followup",
    startedAt: new Date().toISOString(),
    nativeSourceDayUtc: day,
    sourcePath: daily,
    sourceSessionKey: key(ONE_USER_FOLLOWUP_SOURCE),
    originalMainSessionKey: key("main"),
    originalAttemptReplayed: false,
    harnessSourceWrites: false,
    stages,
    steps: [],
    ok: false,
  };
  const steps = report.steps as Dict[];
  const checkpoint = () => controls.checkpoint({ ...report });
  const snapshot = () => snapshotOneUserWorkspace(workspace);
  const history = async (session: string) =>
    ((await lab.sessionHistory(session)) as { messages?: Message[] })
      .messages ?? [];
  const check = (stage: string, accepted: boolean, reason: string) => {
    stages[stage] = accepted ? "pass" : `fail: ${reason}`;
    if (!accepted) throw new Error(`One-user follow-up ${stage}: ${reason}`);
  };
  let preserved: Record<string, string> | undefined;
  let protectedSources: Snapshot | undefined;
  let inheritedCheckpointHash: string | undefined;
  const checkPreserved = async () => {
    const final = await snapshot();
    report.finalWorkspace = final;
    if (protectedSources)
      for (const [path, content] of Object.entries(protectedSources))
        if (final[path] !== content)
          throw new Error(`An original source changed: ${path}`);
    if (preserved)
      for (const [name, expected] of Object.entries(preserved))
        if (hash(await readFile(join(previousDirectory, name))) !== expected)
          throw new Error(`Original consumed evidence changed: ${name}`);
    if (
      controls.completionCheckpoint &&
      inheritedCheckpointHash &&
      hash(await readFile(controls.completionCheckpoint)) !==
        inheritedCheckpointHash
    )
      throw new Error("The immutable paid-preparation checkpoint changed.");
    if (protectedSources && preserved)
      stages.previousEvidencePreserved = "pass";
  };
  const linked = async (session: string, parent: string, parentId: string) => {
    const creation = await controls.rpc("sessions.create", {
      key: key(session),
      agentId: "main",
      parentSessionKey: key(parent),
      emitCommandHooks: false,
    });
    const state = (await lab.sessionState(session)) as State;
    const messages = await history(session);
    if (
      !state.session?.sessionId ||
      state.session.parentSessionKey !== key(parent) ||
      state.session.parentSessionId !== parentId ||
      messages.some((message) =>
        ["user", "assistant", "toolResult"].includes(message.role ?? ""),
      )
    )
      throw new Error(
        "Follow-up needs a fresh native child with an exact persisted parent and empty history.",
      );
    return { creation, state, initialMessages: messages };
  };
  const turn = async (id: string, session: string, input: string) => {
    const before = await snapshot(),
      prior = await history(session);
    const step: Dict = { id, session, input, before, after: before };
    steps.push(step);
    try {
      step.output = await controls.ownerTurn(session, input);
      const receipt =
        record(step.output) && record(step.output.ownerConnection)
          ? step.output.ownerConnection
          : undefined;
      if (
        receipt?.role !== "operator" ||
        !Array.isArray(receipt.scopes) ||
        !receipt.scopes.includes("operator.admin")
      )
        throw new Error(
          "Follow-up turn lacks the actual native server-granted owner connection receipt.",
        );
      const next = await history(session);
      if (next.length < prior.length)
        throw new Error("Follow-up native history unexpectedly shortened.");
      const delta = next.slice(prior.length);
      step.historyDelta = delta;
      step.bot = extractOneUserReply(step.output, delta);
      if (!hasOwnerInput(delta, input) || !String(step.bot).trim())
        throw new Error(
          "Follow-up turn lacks native owner input or an observable model reply.",
        );
      return step;
    } finally {
      step.after = await snapshot();
      step.changes = changes(before, step.after as Snapshot);
      await checkpoint();
    }
  };
  try {
    preserved = Object.fromEntries(
      await Promise.all(
        preservedPaths.map(async (name) => [
          name,
          hash(await readFile(join(previousDirectory, name))),
        ]),
      ),
    );
    const previous = JSON.parse(
      await readFile(join(previousDirectory, "report.json"), "utf8"),
    );
    if (
      previous.kind !== "current-one-user-native-lifecycle" ||
      previous.nativeSourceDayUtc >= day ||
      previous.ok !== false ||
      previous.stages?.flushPhysicalWrite !== "pass" ||
      previous.stages?.compaction !== "pass"
    )
      throw new Error(
        "The fixed follow-up needs its retained partial prior-day scenario, not a replay.",
      );
    const initial = await snapshot();
    report.initialWorkspace = initial;
    let completion: Dict | undefined;
    let inheritedSourceState: State | undefined;
    let inheritedSourceStep: Dict | undefined;
    let inheritedSourceProvenance: Dict | undefined;
    if (controls.completionCheckpoint) {
      if (
        resolve(controls.completionCheckpoint) !==
        resolve(controls.evidenceDirectory, "preparation-repair-report.json")
      )
        throw new Error(
          "Completion requires the fixed immutable preparation checkpoint.",
        );
      const bytes = await readFile(controls.completionCheckpoint);
      inheritedCheckpointHash = hash(bytes);
      const saved: unknown = JSON.parse(bytes.toString("utf8"));
      if (
        !record(saved) ||
        saved.kind !== "one-user-owner-maintenance-followup" ||
        saved.ok !== false ||
        saved.nativeSourceDayUtc !== day ||
        saved.sourcePath !== daily ||
        !record(saved.stages) ||
        saved.stages.sourceOwnerWrite !== "pass" ||
        saved.stages.semanticRecall !== "pass" ||
        saved.stages.previousEvidencePreserved !== "pass" ||
        ![
          "promotionEligible",
          "nativeMaintenance",
          "durablePromotion",
          "restartRecall",
          "sessionContinuity",
        ].every((stage) => (saved.stages as Dict)[stage] === "not-run") ||
        !Array.isArray(saved.steps) ||
        saved.steps.length !== 1 ||
        !record(saved.steps[0]) ||
        !record(saved.sourceSession) ||
        !record(saved.sourceSession.state) ||
        !record(saved.sourceSession.state.session) ||
        !Array.isArray(saved.sourceSession.initialMessages) ||
        saved.sourceSession.initialMessages.length !== 0 ||
        !record(saved.sourceProvenance) ||
        !record(saved.semanticRecall) ||
        !record(saved.previousEvidenceHashes)
      )
        throw new Error(
          "Completion checkpoint does not establish only the completed owner source and semantic stages.",
        );
      const step = saved.steps[0];
      const state = saved.sourceSession.state as State;
      const mainId = previous.sourceSessionBefore?.session?.sessionId;
      const sourceId = state.session?.sessionId;
      const output = record(step.output) ? step.output : undefined;
      const receipt =
        output && record(output.ownerConnection)
          ? output.ownerConnection
          : undefined;
      const delta = Array.isArray(step.historyDelta)
        ? (step.historyDelta as Message[])
        : [];
      if (
        step.id !== "owner-confirmed-new-day-source" ||
        step.session !== ONE_USER_FOLLOWUP_SOURCE ||
        typeof step.input !== "string" ||
        !record(step.before) ||
        step.before[daily] != null ||
        !record(step.after) ||
        typeof step.after[daily] !== "string" ||
        !Array.isArray(step.changes) ||
        step.changes.length !== 1 ||
        step.changes[0] !== daily ||
        !sourceId ||
        state.session?.parentSessionKey !== key("main") ||
        state.session.parentSessionId !== mainId ||
        !hasOwnerInput(delta, step.input) ||
        !toolCalls(delta).includes("write") ||
        !delta.some(
          (message) =>
            message.role === "toolResult" &&
            message.toolName === "write" &&
            message.isError !== true,
        ) ||
        receipt?.role !== "operator" ||
        !Array.isArray(receipt.scopes) ||
        !receipt.scopes.includes("operator.admin") ||
        typeof initial[daily] !== "string" ||
        hash(initial[daily]) !== saved.sourceProvenance.fileHash ||
        hash(step.after[daily]) !== saved.sourceProvenance.fileHash ||
        !preserved ||
        !Object.entries(preserved).every(
          ([name, expected]) =>
            (saved.previousEvidenceHashes as Dict)[name] === expected,
        )
      )
        throw new Error(
          "Completion checkpoint owner, source hash or original native lineage is inconsistent.",
        );
      const semantic = saved.semanticRecall;
      if (
        semantic.provider !== "openai-compatible" ||
        semantic.model !== "openai/text-embedding-3-small" ||
        !Array.isArray(semantic.results) ||
        !semantic.results.some(
          (hit) =>
            record(hit) &&
            hit.path === daily &&
            typeof hit.snippet === "string" &&
            hit.snippet.includes(ONE_USER_FLUSH_MARKER),
        )
      )
        throw new Error(
          "Completion checkpoint lacks the actual trusted-source semantic recall.",
        );
      const provenance = await readFollowupSourceProvenance({
        stateDir: lab.state,
        workspace,
        relativePath: daily,
        sourceSessionKey: key(ONE_USER_FOLLOWUP_SOURCE),
        sourceSessionId: sourceId,
        startedAtMs: Date.parse(String(saved.startedAt)),
        finishedAtMs: Date.parse(String(saved.finishedAt)),
      });
      if (
        !Number.isFinite(Date.parse(String(saved.startedAt))) ||
        !Number.isFinite(Date.parse(String(saved.finishedAt))) ||
        !Object.entries(provenance).every(
          ([name, value]) => (saved.sourceProvenance as Dict)[name] === value,
        )
      )
        throw new Error(
          "Completion checkpoint native artifact evidence changed.",
        );
      completion = saved;
      inheritedSourceStep = step;
      inheritedSourceState = state;
      inheritedSourceProvenance = provenance;
      report.inheritedEvidence = {
        path: controls.completionCheckpoint,
        sha256: inheritedCheckpointHash,
        stages: ["sourceOwnerWrite", "semanticRecall"],
        sourceSessionKey: key(ONE_USER_FOLLOWUP_SOURCE),
        sourceSessionId: sourceId,
        sourceFileSha256: provenance.fileHash,
      };
      report.executionMode = "remaining-maintenance-completion";
    }
    if (!completion && initial[daily] !== undefined && initial[daily] !== null)
      throw new Error(
        "The current UTC daily source already exists; do not rewrite it for a follow-up.",
      );
    protectedSources = Object.fromEntries(
      Object.entries(initial).filter(
        ([path]) =>
          path === "USER.md" ||
          path === "memory/preferences.md" ||
          /^memory\/[^/]+\.md$/.test(path),
      ),
    );
    report.previousEvidenceHashes = preserved;
    report.protectedSourceHashes = Object.fromEntries(
      Object.entries(protectedSources).map(([path, text]) => [
        path,
        text === null ? null : hash(text),
      ]),
    );
    await controls.activate(controls.ledgerPath);
    if (completion) {
      // Completion never replays the source or search. Restore provider/index
      // identity before inspecting the existing native source session.
      await controls.phase("semantic");
      await lab.configureFlush("off");
      await lab.index();
    }
    // The retained corpus has a keyword-only index. Keep its matching provider
    // while opening native sessions and writing the owner's fresh confirmation.
    const mainBefore = (await lab.sessionState("main")) as State;
    const mainId = mainBefore.session?.sessionId;
    if (!mainId || mainId !== previous.sourceSessionBefore?.session?.sessionId)
      throw new Error(
        "The original main session identity changed before the follow-up.",
      );
    report.originalMainBefore = mainBefore;
    let sourceId: string;
    if (
      completion &&
      inheritedSourceState &&
      inheritedSourceStep &&
      inheritedSourceProvenance
    ) {
      const currentState = (await lab.sessionState(
        ONE_USER_FOLLOWUP_SOURCE,
      )) as State;
      const currentHistory = await history(ONE_USER_FOLLOWUP_SOURCE);
      const savedHistory = inheritedSourceStep.historyDelta as Message[];
      if (
        currentState.session?.sessionId !==
          inheritedSourceState.session?.sessionId ||
        currentState.session?.parentSessionKey !== key("main") ||
        currentState.session.parentSessionId !== mainId ||
        currentHistory.length !== savedHistory.length ||
        !hasOwnerInput(currentHistory, String(inheritedSourceStep.input)) ||
        currentHistory.filter((message) => message.role === "user").length !==
          1 ||
        !toolCalls(currentHistory).includes("write")
      )
        throw new Error(
          "The existing native owner source session changed after its immutable checkpoint.",
        );
      sourceId = currentState.session.sessionId as string;
      report.sourceSession = {
        ...(completion.sourceSession as Dict),
        inherited: true,
        checkpointSha256: inheritedCheckpointHash,
        currentState,
      };
      report.sourceProvenance = inheritedSourceProvenance;
      report.semanticRecall = completion.semanticRecall;
      stages.sourceOwnerWrite = "pass";
      stages.semanticRecall = "pass";
    } else {
      const sourceSession = await linked(
        ONE_USER_FOLLOWUP_SOURCE,
        "main",
        mainId,
      );
      report.sourceSession = sourceSession;
      sourceId = sourceSession.state.session?.sessionId as string;
      const sourceStarted = Date.now();
      const source = await turn(
        "owner-confirmed-new-day-source",
        ONE_USER_FOLLOWUP_SOURCE,
        `This is a new synthetic owner confirmation for Sable, the fictional botanist, on UTC date ${day}. Current facts: morning drink rooibos tea; orchids watered Monday; transport bicycle; inspect the cobalt lantern daily at 09:15; permanent checklist identifier ${ONE_USER_FLUSH_MARKER}. Historical observation, not a new measurement: ${previous.nativeSourceDayUtc} at 08:00, thermometer 18 C. Use the native write tool to create ONLY ${daily}, a concise new dated note recording this confirmation and historical observation. Start the fact paragraph with "Sable confirmed on ${day}:" so it clearly records this new confirmation. Do not read old daily notes, change any existing source, or write USER.md, memory/preferences.md, MEMORY.md or DREAMS.md. Reply briefly after writing.`,
      );
      const afterSource = source.after as Snapshot;
      const sourceHistory = source.historyDelta as Message[];
      const nativeProvenance = await readFollowupSourceProvenance({
        stateDir: lab.state,
        workspace,
        relativePath: daily,
        sourceSessionKey: key(ONE_USER_FOLLOWUP_SOURCE),
        sourceSessionId: sourceId,
        startedAtMs: sourceStarted,
        finishedAtMs: Date.now(),
      });
      report.sourceProvenance = nativeProvenance;
      check(
        "sourceOwnerWrite",
        (source.changes as string[]).length === 1 &&
          (source.changes as string[])[0] === daily &&
          toolCalls(sourceHistory).includes("write") &&
          sourceHistory.some(
            (message) =>
              message.role === "toolResult" &&
              message.toolName === "write" &&
              message.isError !== true,
          ) &&
          /rooibos/i.test(afterSource[daily] ?? "") &&
          /Monday/i.test(afterSource[daily] ?? "") &&
          /18/.test(afterSource[daily] ?? "") &&
          /09:15/.test(afterSource[daily] ?? "") &&
          (afterSource[daily] ?? "").includes(ONE_USER_FLUSH_MARKER),
        "no isolated owner-authored current-day source with the confirmed facts was observed",
      );
      // Rebuild the index for the newly selected provider before starting a
      // Gateway whose native readiness checks require that provider's identity.
      await controls.phase("semantic");
      await lab.configureFlush("off");
      await lab.index();
    }
    // Native memory_search records real recall/query signals only while dreaming
    // is enabled. The manual yearly job has not run yet; this is still preflight.
    await controls.phase("maintenance");
    await lab.configureFlush("off");
    if (!completion) {
      const semantic = await lab.search(
        ONE_USER_FLUSH_MARKER,
        ONE_USER_FOLLOWUP_SOURCE,
      );
      report.semanticRecall = semantic;
      const sourceHit = semantic.results.find(
        (hit) =>
          hit.path === daily && hit.snippet.includes(ONE_USER_FLUSH_MARKER),
      );
      check(
        "semanticRecall",
        semantic.provider === "openai-compatible" &&
          semantic.model === "openai/text-embedding-3-small" &&
          Boolean(sourceHit),
        "genuine semantic search did not recall the new trusted daily source",
      );
      // The native tool persists recall signals asynchronously after its response.
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const preview = await lab.promote(false);
    report.nativePromotionPreview = preview;
    const candidates =
      record(preview) && Array.isArray(preview.candidates)
        ? preview.candidates
        : [];
    check(
      "promotionEligible",
      candidates.some(
        (candidate) =>
          record(candidate) &&
          candidate.path === daily &&
          record(candidate.provenance) &&
          candidate.provenance.originClass === "agent" &&
          Number(candidate.signalCount) >= 1 &&
          Number(candidate.uniqueQueries) >= 1 &&
          !candidate.promotedAt,
      ),
      "the actual native promotion preview has no eligible trusted new-day candidate",
    );
    const beforeMaintenance = await snapshot();
    const logPath = join(lab.directory, "openclaw.log");
    const offset = await readFile(logPath)
      .then((bytes) => bytes.length)
      .catch(() => 0);
    steps.push({ id: "native-owner-memory-maintenance" });
    await checkpoint();
    const sweep = await lab.dreamRun();
    const deadline = Date.now() + 150000;
    let publicationLog = "";
    while (Date.now() < deadline) {
      publicationLog = (await readFile(logPath))
        .subarray(offset)
        .toString("utf8");
      if (
        ["light", "rem", "deep"].every((phase) =>
          publicationLog.includes(
            `dream diary entry written for ${phase} phase`,
          ),
        ) ||
        /narrative generation (?:failed|used fallback)/i.test(publicationLog) ||
        /dreaming promotion complete \([^\n]*applied=0[,)]/.test(publicationLog)
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const afterMaintenance = await snapshot();
    const publications = Object.fromEntries(
      ["light", "rem", "deep"].map((phase) => [
        phase,
        publicationLog.includes(`dream diary entry written for ${phase} phase`),
      ]),
    );
    const applied = Number(
      /dreaming promotion complete \([^\n]*applied=(\d+)[,)]/.exec(
        publicationLog,
      )?.[1] ?? 0,
    );
    report.maintenance = {
      sweep,
      before: beforeMaintenance,
      after: afterMaintenance,
      phasePublications: publications,
      appliedPromotions: applied,
      status: await lab.dreamStatus(),
      diary: await lab.dreamDiary(),
      diagnostics: publicationLog
        .split("\n")
        .filter((line) =>
          /dream diary|promotion complete|narrative|fallback|degraded/i.test(
            line,
          ),
        )
        .slice(-80),
    };
    check(
      "nativeMaintenance",
      record(sweep) &&
        sweep.completed === true &&
        sweep.completionStatus === "succeeded" &&
        Object.values(publications).every(Boolean) &&
        !/narrative generation (?:failed|used fallback)/i.test(publicationLog),
      "all three native model diary publishers did not complete without fallback",
    );
    const durable = afterMaintenance["MEMORY.md"] ?? "";
    check(
      "durablePromotion",
      applied > 0 &&
        durable !== (beforeMaintenance["MEMORY.md"] ?? "") &&
        durable.includes(daily) &&
        /rooibos|COBALT-LANTERN-0915|cobalt|09:15/i.test(durable),
      "maintenance did not apply a sourced promotion from the new trusted note",
    );
    await controls.phase("recall");
    await lab.configureFlush("off");
    await lab.index();
    report.restart = await lab.restart();
    const finalSession = await linked(
      ONE_USER_FOLLOWUP_RECALL,
      ONE_USER_FOLLOWUP_SOURCE,
      sourceId,
    );
    report.finalProbeSession = finalSession;
    const final = await turn(
      "fresh-owner-recall-after-restart",
      ONE_USER_FOLLOWUP_RECALL,
      `In this fresh session, use saved memory sources to state Sable's current morning drink, usual orchid-watering day, the historical ${previous.nativeSourceDayUtc} 08:00 thermometer result, and daily inspection time plus exact permanent checklist identifier. Cite saved source paths. Do not guess, edit or write files. Keep the reply concise.`,
    );
    report.finalRecall = {
      bot: final.bot,
      output: final.output,
      historyDelta: final.historyDelta,
    };
    const bot = String(final.bot);
    check(
      "restartRecall",
      /rooibos/i.test(bot) &&
        !/mint/i.test(bot) &&
        /Monday/i.test(bot) &&
        /18/.test(bot) &&
        /09:15/.test(bot) &&
        bot.includes(ONE_USER_FLUSH_MARKER) &&
        /USER\.md|memory\/|MEMORY\.md/.test(bot) &&
        !(final.changes as string[]).length &&
        !toolCalls(final.historyDelta as Message[]).some(
          (name) => !["memory_search", "memory_get", "read"].includes(name),
        ),
      "fresh post-restart model reply did not recover all current confirmed facts without writes",
    );
    const mainAfter = (await lab.sessionState("main")) as State;
    const sourceAfter = (await lab.sessionState(
      ONE_USER_FOLLOWUP_SOURCE,
    )) as State;
    report.originalMainAfter = mainAfter;
    report.sourceSessionAfter = sourceAfter;
    check(
      "sessionContinuity",
      mainAfter.session?.sessionId === mainId &&
        sourceAfter.session?.sessionId === sourceId &&
        sourceAfter.session.parentSessionKey === key("main") &&
        sourceAfter.session.parentSessionId === mainId &&
        finalSession.state.session?.parentSessionId === sourceId,
      "native main and child lineage did not survive the continuation",
    );
  } catch (error) {
    report.error =
      error instanceof Error ? error.message : "One-user follow-up failed.";
  } finally {
    try {
      await controls.finish();
    } catch (error) {
      report.cleanupError =
        error instanceof Error ? error.message : "Follow-up cleanup failed.";
    }
    try {
      await checkPreserved();
    } catch (error) {
      stages.previousEvidencePreserved =
        "fail: original evidence or sources changed";
      report.evidenceError =
        error instanceof Error
          ? error.message
          : "Follow-up evidence check failed.";
    }
    report.ok = oneUserFollowupPassed(report);
    report.finishedAt = new Date().toISOString();
    await checkpoint();
  }
  return report;
}

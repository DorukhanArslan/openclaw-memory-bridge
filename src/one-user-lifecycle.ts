import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { captureFlushWriteEvidence } from "./flush-write-evidence.ts";
import type { Lab } from "./lab.ts";

export type OneUserControls = {
  ledgerPath: string;
  evidenceDirectory: string;
  quota?: unknown;
  activate(ledgerPath: string): Promise<void>;
  phase(name: "profile" | "flush" | "semantic" | "maintenance"): Promise<void>;
  rpc(
    method: string,
    params?: Record<string, unknown>,
    timeout?: number,
  ): Promise<unknown>;
  localTurn(session: string, message: string): Promise<unknown>;
  ownerTurn(session: string, message: string): Promise<unknown>;
  checkpoint(report: Record<string, unknown>): Promise<void>;
  finish(): Promise<void>;
};

type Snapshot = Record<string, string | null>;
type Message = {
  role?: string;
  content?: unknown;
  toolName?: string;
  isError?: boolean;
  __openclaw?: unknown;
};
type History = { messages?: Message[] };
type SessionState = {
  session?: { sessionId?: string; parentSessionKey?: string };
  nativeMaintenance?: {
    compactionCount?: number;
    memoryFlush?: { kind?: string } | null;
  };
};
type Step = Record<string, unknown> & {
  id: string;
  before: Snapshot;
  after: Snapshot;
  historyDelta?: Message[];
  bot?: string;
};
export const ONE_USER_REQUIRED_STAGES = [
  "profileWrite",
  "preferenceUpdate",
  "keywordRecall",
  "semanticRecall",
  "profileContext",
  "flushInputStaged",
  "flushPhysicalWrite",
  "compaction",
  "nativeMaintenance",
  "durablePromotion",
  "restartRecall",
  "sessionContinuity",
] as const;
export const ONE_USER_FLUSH_MARKER = "COBALT-LANTERN-0915";
const MAIN = "main";
const SEMANTIC_QUERY = "pedal-powered commuting";
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export async function snapshotOneUserWorkspace(
  workspace: string,
): Promise<Snapshot> {
  const files: Snapshot = Object.fromEntries(
    ["USER.md", "memory/preferences.md", "MEMORY.md", "DREAMS.md"].map(
      (name) => [name, null],
    ),
  );
  const visit = async (directory: string, prefix = "") => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Error("Unexpected one-user workspace link.");
      const relative = prefix + entry.name;
      if (entry.isDirectory())
        await visit(join(directory, entry.name), `${relative}/`);
      else if (entry.isFile() && /\.(md|txt)$/.test(entry.name)) {
        const text = await readFile(join(directory, entry.name), "utf8");
        if (Buffer.byteLength(text) > 100000)
          throw new Error("One-user source exceeds its evidence bound.");
        files[relative] = text;
      }
    }
  };
  await visit(workspace);
  return files;
}

function textParts(content: unknown): string {
  if (typeof content === "string") return content;
  return Array.isArray(content)
    ? content
        .filter(
          (part) =>
            record(part) &&
            part.type === "text" &&
            typeof part.text === "string",
        )
        .map((part) => (part as { text: string }).text)
        .join("\n")
    : "";
}

export function extractOneUserReply(
  output: unknown,
  messages: Message[] = [],
): string {
  if (record(output)) {
    if (Array.isArray(output.payloads)) {
      const text = output.payloads
        .filter((part) => record(part) && typeof part.text === "string")
        .map((part) => (part as { text: string }).text)
        .join("\n");
      if (text.trim()) return text;
    }
    if (
      record(output.meta) &&
      typeof output.meta.finalAssistantVisibleText === "string"
    )
      return output.meta.finalAssistantVisibleText;
    if (
      record(output.completion) &&
      record(output.completion.terminalReply) &&
      typeof output.completion.terminalReply.text === "string"
    )
      return output.completion.terminalReply.text;
  }
  for (const message of [...messages].reverse()) {
    const text = message.role === "assistant" ? textParts(message.content) : "";
    if (text.trim()) return text;
  }
  return "";
}

function toolNames(messages: Message[]): string[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant" || !Array.isArray(message.content))
      return [];
    return message.content
      .filter((part) => record(part) && part.type === "toolCall")
      .map((part) =>
        String(
          (part as Record<string, unknown>).name ??
            (part as Record<string, unknown>).toolName ??
            "",
        ),
      );
  });
}
const hasWrites = (messages: Message[]) =>
  toolNames(messages).some((name) => /(?:^|\.)(?:write|edit)$/.test(name));
const hasSuccessfulWrite = (messages: Message[]) =>
  hasWrites(messages) &&
  messages.some(
    (message) =>
      message.role === "toolResult" &&
      /^(?:write|edit)$/.test(message.toolName ?? "") &&
      message.isError !== true,
  );
const hasNativeOwnerInput = (messages: Message[], input: string) =>
  messages.some(
    (message) =>
      message.role === "user" &&
      textParts(message.content) === input &&
      record(message.__openclaw) &&
      message.__openclaw.senderIsOwner === true,
  );
const changes = (before: Snapshot, after: Snapshot) =>
  Object.keys({ ...before, ...after })
    .filter((path) => before[path] !== after[path])
    .map((path) => ({
      path,
      before: before[path] ?? null,
      after: after[path] ?? null,
    }));

export function oneUserLifecyclePassed(
  report: Record<string, unknown>,
): boolean {
  const stages = report.stages;
  return (
    !report.error &&
    !report.evidenceError &&
    !report.cleanupError &&
    record(stages) &&
    ONE_USER_REQUIRED_STAGES.every((stage) => stages[stage] === "pass")
  );
}

/** Fixed current scenario: native agents write every memory source, never this driver. */
export async function runOneUserLifecycle(
  lab: Lab,
  controls: OneUserControls,
): Promise<Record<string, unknown>> {
  const workspace = join(lab.directory, "workspace");
  const day = new Date().toISOString().slice(0, 10);
  const dailyPath = `memory/${day}.md`;
  const key = (session: string) => `agent:main:${session}`;
  const stages: Record<string, string> = Object.fromEntries(
    ONE_USER_REQUIRED_STAGES.map((stage) => [stage, "not-run"]),
  );
  const steps: Step[] = [];
  const report: Record<string, unknown> = {
    schemaVersion: 1,
    kind: "current-one-user-native-lifecycle",
    startedAt: new Date().toISOString(),
    nativeSourceDayUtc: day,
    syntheticUser: "Sable, a fictional botanist",
    corpus: lab.name,
    sourceSessionKey: key(MAIN),
    formalSupersession:
      "unsupported; this scenario verifies explicit profile replacement, not native lineage retirement",
    harnessSourceWrites: false,
    stages,
    steps,
    ok: false,
  };
  const checkpoint = () => controls.checkpoint({ ...report });
  const check = (stage: string, accepted: boolean, reason: string) => {
    stages[stage] = accepted ? "pass" : `fail: ${reason}`;
    if (!accepted) throw new Error(`One-user ${stage}: ${reason}`);
  };
  const snapshot = () => snapshotOneUserWorkspace(workspace);
  const history = async (session: string) =>
    (await lab.sessionHistory(session)) as History;
  const capture = async (
    id: string,
    action: () => Promise<unknown>,
    session?: string,
    input?: string,
    transport?: string,
  ): Promise<Step> => {
    const before = await snapshot();
    const prior = session ? ((await history(session)).messages ?? []) : [];
    const step: Step = { id, session, input, transport, before, after: before };
    steps.push(step);
    try {
      step.output = await action();
      if (session) {
        const next = (await history(session)).messages ?? [];
        if (next.length < prior.length)
          throw new Error(
            "Native history unexpectedly shortened during a turn.",
          );
        step.historyDelta = next.slice(prior.length);
        step.bot = extractOneUserReply(step.output, step.historyDelta);
        if (!step.bot.trim())
          throw new Error("Native turn has no observable assistant reply.");
        step.state = await lab.sessionState(session);
      }
      return step;
    } catch (error) {
      step.error =
        error instanceof Error ? error.message : "Native step failed.";
      throw error;
    } finally {
      step.after = await snapshot();
      step.changes = changes(before, step.after);
      await checkpoint();
    }
  };
  const local = (id: string, session: string, input: string) =>
    capture(
      id,
      () => controls.localTurn(session, input),
      session,
      input,
      "official agent --local",
    );
  const chat = (id: string, session: string, input: string) =>
    capture(
      id,
      () => lab.chat(session, input),
      session,
      input,
      "native Gateway chat.send",
    );
  const owner = (id: string, session: string, input: string) =>
    capture(
      id,
      () => controls.ownerTurn(session, input),
      session,
      input,
      "official native GatewayClient with verified operator.admin grant",
    );
  const linkedSession = async (session: string) => {
    const creation = await controls.rpc("sessions.create", {
      key: key(session),
      agentId: "main",
      parentSessionKey: key(MAIN),
      emitCommandHooks: false,
    });
    const state = (await lab.sessionState(session)) as SessionState;
    const messages = (await history(session)).messages ?? [];
    if (
      messages.some((message) =>
        ["user", "assistant", "toolResult"].includes(message.role ?? ""),
      )
    )
      throw new Error(
        "Recall probe unexpectedly inherited conversation history.",
      );
    if (state.session?.parentSessionKey !== key(MAIN))
      throw new Error(
        "Native recall session has no matching navigation parent.",
      );
    return { key: key(session), creation, state, initialMessages: messages };
  };
  try {
    await controls.activate(controls.ledgerPath);
    await controls.phase("profile");
    report.initialWorkspace = await snapshot();
    const initial = report.initialWorkspace as Snapshot;
    if (
      initial["USER.md"] ||
      initial["memory/preferences.md"] ||
      Object.keys(initial).some(
        (path) => path.startsWith("memory/") && initial[path],
      )
    )
      throw new Error("Current one-user scenario needs a fresh memory corpus.");
    await lab.createSession(MAIN);
    const sourceBefore = (await lab.sessionState(MAIN)) as SessionState;
    const mainId = sourceBefore.session?.sessionId;
    if (!mainId)
      throw new Error("Native main session identity is unavailable.");
    report.sourceSessionBefore = sourceBefore;
    const transient = Array.from(
      { length: 18 },
      (_, i) =>
        `Temporary greenhouse planning item ${i + 1}: count the empty trays before tomorrow's rehearsal.`,
    ).join("\n");
    const first = await local(
      "native-profile-and-event-write",
      MAIN,
      `I am Sable, a fictional botanist in this synthetic greenhouse test. I commute by bicycle, plan at 08:00, prefer mint tea, and water orchids on Monday. Use native write tools to save my current facts in USER.md and memory/preferences.md. Express my travel fact as "Transport: bicycle". For native UTC date ${day}, write today's thermometer event: 18 C at 08:00, in ${dailyPath}. Keep these source files concise. The following temporary planning context can be summarized later but need not be saved as durable facts:\n${transient}\nReply in one short sentence after successful writes.`,
    );
    check(
      "profileWrite",
      hasSuccessfulWrite(first.historyDelta ?? []) &&
        hasNativeOwnerInput(first.historyDelta ?? [], String(first.input)) &&
        /Sable/i.test(first.after["USER.md"] ?? "") &&
        /botanist/i.test(first.after["USER.md"] ?? "") &&
        /bicycle/i.test(first.after["USER.md"] ?? "") &&
        /mint/i.test(first.after["memory/preferences.md"] ?? "") &&
        /thermometer/i.test(first.after[dailyPath] ?? "") &&
        /18/.test(first.after[dailyPath] ?? ""),
      "real native source writes were not observed",
    );
    const update = await local(
      "native-current-preference-update",
      MAIN,
      `My current morning drink is now rooibos tea instead of mint tea. Use native tools to update the current preference in BOTH USER.md and memory/preferences.md; preserve my name, botanist identity, bicycle commute, 08:00 planning and Monday orchid schedule. Old mint preference may remain only as dated history in ${dailyPath}. Reply briefly after the actual update.`,
    );
    check(
      "preferenceUpdate",
      hasSuccessfulWrite(update.historyDelta ?? []) &&
        hasNativeOwnerInput(update.historyDelta ?? [], String(update.input)) &&
        ["USER.md", "memory/preferences.md"].every(
          (path) =>
            /rooibos/i.test(update.after[path] ?? "") &&
            !/mint/i.test(update.after[path] ?? ""),
        ) &&
        /Sable/i.test(update.after["USER.md"] ?? "") &&
        /Monday/i.test(update.after["USER.md"] ?? "") &&
        /bicycle/i.test(update.after["USER.md"] ?? ""),
      "current profile did not retain the requested updated facts",
    );
    const preFlush = (await lab.sessionState(MAIN)) as SessionState;
    report.preStagingFlushState = preFlush;

    const keywordSources = await snapshot();
    if (
      Object.values(keywordSources).some((text) =>
        /\b(?:pedal|commuting)\b/i.test(text ?? ""),
      )
    )
      throw new Error(
        "The semantic query vocabulary already appears in the source corpus.",
      );

    await lab.index();
    const keyword = await lab.search("rooibos", MAIN);
    const negative = await lab.search(SEMANTIC_QUERY, MAIN);
    report.keywordRecall = keyword;
    report.semanticKeywordBaseline = negative;
    check(
      "keywordRecall",
      keyword.provider === "none" &&
        keyword.results.some((hit) => /rooibos/i.test(hit.snippet)) &&
        negative.provider === "none" &&
        negative.results.length === 0,
      "keyword baseline or current fact recall is invalid",
    );
    await controls.phase("semantic");
    await lab.index();
    const semantic = await lab.search(SEMANTIC_QUERY, MAIN);
    report.semanticRecall = semantic;
    const bicycleHit = semantic.results.find((hit) =>
      /bicycle/i.test(hit.snippet),
    );
    check(
      "semanticRecall",
      semantic.provider === "openai-compatible" &&
        semantic.model === "openai/text-embedding-3-small" &&
        Boolean(bicycleHit),
      "genuine embedding retrieval did not find the bicycle source",
    );
    if (bicycleHit)
      report.semanticSource = await lab.get(
        bicycleHit.path,
        bicycleHit.startLine,
        Math.min(200, bicycleHit.endLine - bicycleHit.startLine + 1),
      );
    await lab.configureFlush("off");
    report.profileProbeSession = await linkedSession("profile-check");
    const profile = await chat(
      "fresh-session-profile-recall",
      "profile-check",
      "What is my current morning drink and usual orchid-watering day? Read saved sources and cite their paths. Do not change any file. Keep the answer brief.",
    );
    const usage = await controls.rpc("sessions.usage", {
      key: key("profile-check"),
      agentId: "main",
      includeContextWeight: true,
      limit: 1,
    });
    const profileId = (profile.state as SessionState).session?.sessionId;
    const rows =
      record(usage) && Array.isArray(usage.sessions) ? usage.sessions : [];
    const row = rows.find(
      (item) =>
        record(item) &&
        item.key === key("profile-check") &&
        item.sessionId === profileId,
    );
    const context =
      record(row) && record(row.contextWeight) ? row.contextWeight : undefined;
    const files =
      context && Array.isArray(context.injectedWorkspaceFiles)
        ? context.injectedWorkspaceFiles
        : [];
    const user = files.find((item) => record(item) && item.name === "USER.md");
    report.profileContext = {
      usage,
      userSourceSha256: sha256(profile.before["USER.md"] ?? ""),
    };
    check(
      "profileContext",
      record(user) &&
        user.missing === false &&
        user.injectionStatus !== "native_unverified" &&
        Number(user.injectedChars) > 0 &&
        user.rawChars === (profile.before["USER.md"] ?? "").trimEnd().length &&
        /rooibos/i.test(profile.bot ?? "") &&
        /Monday/i.test(profile.bot ?? "") &&
        changes(profile.before, profile.after).length === 0,
      "fresh native context did not load the actual saved profile",
    );

    await controls.phase("flush");
    await lab.configureFlush("off");
    const teach = await local(
      "readonly-conversation-event",
      MAIN,
      `For our ongoing greenhouse routine, I inspect the cobalt lantern at 09:15 every morning. My standing checklist identifier is ${ONE_USER_FLUSH_MARKER}. This is a durable routine and permanent identifier: remember the identifier verbatim for future planning. Acknowledge briefly.`,
    );
    check(
      "flushInputStaged",
      hasNativeOwnerInput(teach.historyDelta ?? [], String(teach.input)) &&
        !hasWrites(teach.historyDelta ?? []) &&
        !Object.values(teach.after).some((text) =>
          text?.includes(ONE_USER_FLUSH_MARKER),
        ) &&
        changes(teach.before, teach.after).length === 0,
      "the staged fact lacks native owner attestation or changed sources before flush admission",
    );
    await lab.configureFlush("test");
    const flushBefore = (await lab.sessionState(MAIN)) as SessionState;
    report.flushStateBeforeTrigger = flushBefore;
    const beforeFiles = await snapshot();
    const logPath = join(lab.directory, "openclaw.log");
    const logOffset = await readFile(logPath)
      .then((data) => data.length)
      .catch(() => 0);
    const startedAtMs = Date.now();
    const trigger = await owner(
      "native-flush-trigger",
      MAIN,
      "Reply ACK only. Do not edit or write any file in this foreground reply.",
    );
    const flushState = (await lab.waitForFlush(MAIN)) as SessionState;
    const afterFiles = await snapshot();
    const finishedAtMs = Date.now();
    const flushEvidence = await captureFlushWriteEvidence({
      stateDir: lab.state,
      workspaceDir: workspace,
      logText: await readFile(logPath, "utf8"),
      logOffset,
      beforeFiles,
      afterFiles,
      foregroundHistoryDelta: trigger.historyDelta ?? [],
      sourceSessionKey: key(MAIN),
      sourceSessionId: mainId,
      marker: ONE_USER_FLUSH_MARKER,
      startedAtMs,
      finishedAtMs,
    });
    report.flushEvidence = { state: flushState, attribution: flushEvidence };
    check(
      "flushPhysicalWrite",
      hasNativeOwnerInput(trigger.historyDelta ?? [], String(trigger.input)) &&
        flushState.nativeMaintenance?.memoryFlush?.kind === "succeeded" &&
        flushEvidence.accepted &&
        flushEvidence.provenance?.originClass === "agent",
      `native owner flush attribution or promotion trust failed: ${flushEvidence.reasons.join("; ")}`,
    );
    await checkpoint();
    await lab.configureFlush("off");
    const compact = await capture("native-summarizing-compaction", () =>
      lab.compactSession(MAIN, true),
    );
    const compactOutput = record(compact.output) ? compact.output : {};
    const compactNative = record(compactOutput.native)
      ? compactOutput.native
      : {};
    const compactState = record(compactOutput.state) ? compactOutput.state : {};
    check(
      "compaction",
      compactNative.compacted === true &&
        record(compactNative.result) &&
        typeof compactNative.result.summary === "string" &&
        Boolean(compactNative.result.summary.trim()) &&
        record(compactState.nativeMaintenance) &&
        Number(compactState.nativeMaintenance.compactionCount) >
          Number(flushState.nativeMaintenance?.compactionCount ?? 0),
      "native summarizing compaction did not commit",
    );

    await lab.index();
    await lab.search("Sable cobalt lantern", MAIN);
    await lab.search(ONE_USER_FLUSH_MARKER, MAIN);
    await controls.phase("maintenance");
    report.nativeGroundedStaging = await lab.remStage();
    const beforeMaintenance = await snapshot();
    const maintenanceLogOffset = await readFile(logPath)
      .then((data) => data.length)
      .catch(() => 0);
    const dream = await capture("native-memory-maintenance", () =>
      lab.dreamRun(),
    );
    const sweep = record(dream.output) ? dream.output : {};
    const deadline = Date.now() + 150000;
    let publicationLog = "";
    while (Date.now() < deadline) {
      publicationLog = (await readFile(logPath))
        .subarray(maintenanceLogOffset)
        .toString("utf8");
      if (
        ["light", "rem", "deep"].every((phase) =>
          publicationLog.includes(
            `dream diary entry written for ${phase} phase`,
          ),
        ) ||
        /narrative generation (?:failed|used fallback)/i.test(publicationLog)
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const afterMaintenance = await snapshot();
    report.maintenance = {
      sweep,
      before: beforeMaintenance,
      after: afterMaintenance,
      status: await lab.dreamStatus(),
      diary: await lab.dreamDiary(),
      phasePublications: Object.fromEntries(
        ["light", "rem", "deep"].map((phase) => [
          phase,
          publicationLog.includes(
            `dream diary entry written for ${phase} phase`,
          ),
        ]),
      ),
      diagnostics: publicationLog
        .split("\n")
        .filter((line) =>
          /dream diary|fallback|degraded|promotion|consolidation|denied/i.test(
            line,
          ),
        )
        .slice(-80),
    };
    check(
      "nativeMaintenance",
      sweep.completed === true &&
        sweep.completionStatus === "succeeded" &&
        ["light", "rem", "deep"].every((phase) =>
          publicationLog.includes(
            `dream diary entry written for ${phase} phase`,
          ),
        ) &&
        !/narrative generation (?:failed|used fallback)/i.test(publicationLog),
      "all native phase publishers did not complete without fallback",
    );
    const durable = afterMaintenance["MEMORY.md"] ?? "";
    check(
      "durablePromotion",
      durable !== (beforeMaintenance["MEMORY.md"] ?? "") &&
        /Sable|thermometer|cobalt|bicycle/i.test(durable) &&
        /(?:source=|Source: )memory\//.test(durable),
      "maintenance did not publish a changed sourced durable fact",
    );

    await lab.configureFlush("off");
    await lab.index();
    report.restart = await lab.restart();
    report.finalProbeSession = await linkedSession("after-restart");
    const final = await chat(
      "fresh-session-recall-after-restart",
      "after-restart",
      `In this fresh session after maintenance and restart, read USER.md, memory/preferences.md and ${dailyPath}. What is my current morning drink, usual orchid-watering day, 08:00 thermometer result, and latest inspection routine/code? Cite saved source paths; do not guess or change any file. Keep the answer short.`,
    );
    report.finalRecall = {
      bot: final.bot,
      native: final.output,
      historyDelta: final.historyDelta,
      sourceSnapshot: final.after,
    };
    check(
      "restartRecall",
      /rooibos/i.test(final.bot ?? "") &&
        !/mint/i.test(final.bot ?? "") &&
        /Monday/i.test(final.bot ?? "") &&
        /18/.test(final.bot ?? "") &&
        /cobalt|lantern/i.test(final.bot ?? "") &&
        /09:15/.test(final.bot ?? "") &&
        (final.bot ?? "").includes(ONE_USER_FLUSH_MARKER) &&
        /USER\.md|memory\/|MEMORY\.md/.test(final.bot ?? "") &&
        ["USER.md", "memory/preferences.md"].every(
          (path) =>
            /rooibos/i.test(final.after[path] ?? "") &&
            !/mint/i.test(final.after[path] ?? ""),
        ) &&
        changes(final.before, final.after).length === 0,
      "fresh post-restart reply did not recall the current saved facts with sources",
    );
    const sourceAfter = (await lab.sessionState(MAIN)) as SessionState;
    report.sourceSessionAfter = sourceAfter;
    check(
      "sessionContinuity",
      sourceAfter.session?.sessionId === mainId,
      "main native session identity changed during the lifecycle",
    );
    report.ok = oneUserLifecyclePassed(report);
  } catch (error) {
    report.error =
      error instanceof Error ? error.message : "One-user lifecycle failed.";
    report.ok = false;
  } finally {
    try {
      report.finalWorkspace = await snapshot();
    } catch (error) {
      report.evidenceError =
        error instanceof Error ? error.message : "Final snapshot failed.";
      report.ok = false;
    }
    try {
      await controls.finish();
    } catch (error) {
      report.cleanupError =
        error instanceof Error ? error.message : "Scope cleanup failed.";
      report.ok = false;
    }
    report.finishedAt = new Date().toISOString();
    await checkpoint();
  }
  return report;
}

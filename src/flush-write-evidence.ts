import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

type Snapshot = Readonly<Record<string, string | null>>;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const OWNER = "core:memory-artifact-provenance";
const NAMESPACE = "workspace-files";
const READ_TOOLS = new Set(["read", "memory_search", "memory_get"]);

export type FlushWriteEvidenceInput = {
  stateDir: string;
  workspaceDir: string;
  logText: string;
  /** UTF-8 byte offset captured before the triggering turn. */
  logOffset?: number;
  beforeFiles: Snapshot;
  afterFiles: Snapshot;
  foregroundHistoryDelta: unknown[];
  sourceSessionKey: string;
  sourceSessionId: string;
  marker: string;
  startedAtMs: number;
  finishedAtMs: number;
  relativePath?: string;
};

type CommonInput = Omit<FlushWriteEvidenceInput, "stateDir" | "workspaceDir">;
type Dispatch = {
  runId: string;
  sessionKey: string;
  sessionId: string;
  sourceSessionKey: string;
  sourceSessionId: string;
  loggedAt: number;
};
type Provenance = {
  workspaceKey: string;
  relativePath: string;
  fileHash: string;
  originClass: "agent" | "untrusted";
  observedAt: number;
  sessionId: string;
  sessionKey: string;
};
export type FlushWriteEvidence = {
  accepted: boolean;
  reasons: string[];
  relativePath?: string;
  beforeSha256?: string;
  afterSha256?: string;
  appendedBytes?: number;
  dispatch?: Dispatch;
  provenance?: Provenance;
  dispatchesObserved: number;
  foregroundToolNames: string[];
  provenanceSource: "supplied provenance" | "native SQLite, read-only";
};

function memoryPath(value: string): boolean {
  return (
    value.startsWith("memory/") &&
    value.endsWith(".md") &&
    !value.startsWith("memory/dreaming/") &&
    !value.startsWith("memory/.dreams/") &&
    !/[\\\0]/.test(value) &&
    value.split("/").every((part) => part && part !== "." && part !== "..")
  );
}

function markerPath(input: CommonInput): string | undefined {
  const candidates = Object.entries(input.afterFiles).filter(
    ([path, text]) =>
      memoryPath(path) &&
      typeof text === "string" &&
      text.includes(input.marker) &&
      !input.beforeFiles[path]?.includes(input.marker),
  );
  if (candidates.length !== 1) return;
  const path = candidates[0]?.[0];
  if (input.relativePath !== undefined && input.relativePath !== path) return;
  return path;
}

function toolNames(history: unknown[]): string[] {
  const names = new Set<string>();
  const seen = new WeakSet<object>();
  const add = (value: unknown) => {
    names.add(
      typeof value === "string" && value.trim()
        ? (value.split(/[.:]/).at(-1)?.toLowerCase() ?? "unknown")
        : "unknown",
    );
  };
  const visit = (value: unknown, depth = 0) => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    if (depth > 8) {
      names.add("unknown");
      return;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const item = value as RecordValue;
    if (["toolCall", "tool_use", "function_call"].includes(String(item.type)))
      add(item.name);
    if (["toolResult", "tool"].includes(String(item.role)))
      add(item.toolName ?? item.name);
    if (Array.isArray(item.tool_calls))
      for (const call of item.tool_calls)
        add(
          record(call) && record(call.function)
            ? call.function.name
            : undefined,
        );
    for (const [key, child] of Object.entries(item))
      if (key !== "tool_calls") visit(child, depth + 1);
  };
  visit(history);
  return [...names].sort();
}

function timestamp(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Date.parse(value)
        : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dispatches(input: CommonInput): Dispatch[] {
  const bytes = Buffer.from(input.logText, "utf8");
  const offset = input.logOffset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length)
    return [];
  let tail = bytes.subarray(offset).toString("utf8");
  // A pre-turn offset can land in an unfinished old record. Never parse it as new.
  if (offset > 0 && bytes[offset - 1] !== 10) {
    const newline = tail.indexOf("\n");
    tail = newline < 0 ? "" : tail.slice(newline + 1);
  }
  const found = new Map<string, Dispatch>();
  for (const line of tail.split("\n")) {
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!record(row)) continue;
    const meta = record(row._meta) ? row._meta : {};
    if (String(meta.logLevelName ?? row.level).toLowerCase() !== "debug")
      continue;
    let subsystem = row.subsystem;
    for (const value of [row["0"], meta.name])
      if (typeof value === "string")
        try {
          const parsed = JSON.parse(value);
          if (record(parsed) && parsed.subsystem) subsystem = parsed.subsystem;
        } catch {
          // Other native logger names are unrelated to this event.
        }
    if (subsystem !== "auto-reply/memory-flush") continue;
    const loggedAt = timestamp(meta.date ?? row.time ?? row.timestamp);
    if (
      loggedAt === undefined ||
      loggedAt < input.startedAtMs ||
      loggedAt > input.finishedAtMs
    )
      continue;
    for (const event of [row, ...Object.values(row).filter(record)]) {
      if (
        event.event !== "memory_flush_dispatched" ||
        event.sourceSessionKey !== input.sourceSessionKey ||
        event.sourceSessionId !== input.sourceSessionId ||
        typeof event.runId !== "string" ||
        !event.runId ||
        typeof event.sessionId !== "string" ||
        !event.sessionId.startsWith("internal-session-effects-") ||
        typeof event.sessionKey !== "string" ||
        !event.sessionKey.includes(":internal-session-effects:")
      )
        continue;
      const dispatch: Dispatch = {
        runId: event.runId,
        sessionId: event.sessionId,
        sessionKey: event.sessionKey,
        sourceSessionId: input.sourceSessionId,
        sourceSessionKey: input.sourceSessionKey,
        loggedAt,
      };
      const key = JSON.stringify([
        dispatch.runId,
        dispatch.sessionId,
        dispatch.sessionKey,
      ]);
      if (!found.has(key)) found.set(key, dispatch);
    }
  }
  return [...found.values()];
}

/** Pure classifier: supplied rows and snapshots are fixtures unless captured natively. */
export function classifyFlushWriteEvidence(
  input: CommonInput & { workspaceKey: string; provenance: unknown },
): FlushWriteEvidence {
  const reasons: string[] = [];
  const evidence: FlushWriteEvidence = {
    accepted: false,
    reasons,
    dispatchesObserved: 0,
    foregroundToolNames: toolNames(input.foregroundHistoryDelta),
    provenanceSource: "supplied provenance",
  };
  if (
    !input.marker ||
    input.marker.length > 512 ||
    /[\r\n\0]/.test(input.marker) ||
    !input.sourceSessionKey ||
    !input.sourceSessionId ||
    !Number.isSafeInteger(input.startedAtMs) ||
    !Number.isSafeInteger(input.finishedAtMs) ||
    input.startedAtMs > input.finishedAtMs
  ) {
    reasons.push("Invalid marker or operation time window.");
    return evidence;
  }
  if (
    Object.values(input.beforeFiles).some((text) =>
      text?.includes(input.marker),
    )
  )
    reasons.push("The marker was already present before the triggering turn.");
  if (evidence.foregroundToolNames.some((name) => !READ_TOOLS.has(name)))
    reasons.push("Foreground history contains a mutating or unverified tool.");
  const relativePath = markerPath(input);
  if (!relativePath) {
    reasons.push("Exactly one normalized memory source must gain the marker.");
    return evidence;
  }
  evidence.relativePath = relativePath;
  const before = input.beforeFiles[relativePath] ?? "";
  const after = input.afterFiles[relativePath] ?? "";
  evidence.beforeSha256 = sha256(before);
  evidence.afterSha256 = sha256(after);
  if (!after.startsWith(before))
    reasons.push("The source change is not an append-only flush write.");
  else evidence.appendedBytes = Buffer.byteLength(after.slice(before.length));
  const events = dispatches(input);
  evidence.dispatchesObserved = events.length;
  const provenance = input.provenance;
  if (
    !record(provenance) ||
    provenance.version !== 1 ||
    typeof provenance.reservationId !== "string" ||
    !provenance.reservationId ||
    provenance.workspaceKey !== input.workspaceKey ||
    provenance.relativePath !== relativePath ||
    provenance.fileHash !== evidence.afterSha256 ||
    !["agent", "untrusted"].includes(String(provenance.originClass)) ||
    !Number.isSafeInteger(provenance.observedAt) ||
    typeof provenance.sessionId !== "string" ||
    typeof provenance.sessionKey !== "string"
  ) {
    reasons.push(
      "Latest native file provenance does not match this source/hash.",
    );
    return evidence;
  }
  evidence.provenance = {
    workspaceKey: String(provenance.workspaceKey),
    relativePath,
    fileHash: String(provenance.fileHash),
    originClass: provenance.originClass as Provenance["originClass"],
    observedAt: provenance.observedAt as number,
    sessionId: provenance.sessionId,
    sessionKey: provenance.sessionKey,
  };
  const matching = events.filter(
    (event) =>
      event.sessionId === provenance.sessionId &&
      event.sessionKey === provenance.sessionKey,
  );
  if (matching.length !== 1)
    reasons.push("No unique current flush dispatch owns the observed write.");
  else {
    evidence.dispatch = matching[0];
    if (
      evidence.provenance.observedAt < (matching[0]?.loggedAt ?? Infinity) ||
      evidence.provenance.observedAt > input.finishedAtMs
    )
      reasons.push(
        "The provenance write is outside its flush dispatch window.",
      );
  }
  evidence.accepted = reasons.length === 0;
  return evidence;
}

/** Capture only one native provenance row; never migrate, update, or repair SQLite. */
export async function captureFlushWriteEvidence(
  input: FlushWriteEvidenceInput,
): Promise<FlushWriteEvidence> {
  let database: DatabaseSync | undefined;
  try {
    const workspace = await realpath(input.workspaceDir);
    const normalized = workspace.replaceAll("\\", "/");
    const workspaceKey = sha256(
      process.platform === "win32" ? normalized.toLowerCase() : normalized,
    );
    const relativePath = markerPath(input);
    if (!relativePath)
      return classifyFlushWriteEvidence({
        ...input,
        workspaceKey,
        provenance: null,
      });
    const actualPath = join(workspace, relativePath);
    if (
      (await realpath(actualPath)) !== actualPath ||
      (await readFile(actualPath, "utf8")) !== input.afterFiles[relativePath]
    )
      throw new Error();
    database = new DatabaseSync(join(input.stateDir, "state/openclaw.sqlite"), {
      readOnly: true,
    });
    const rows = database
      .prepare(
        "SELECT value_json FROM plugin_state_entries WHERE plugin_id = ? AND namespace = ? AND entry_key = ?",
      )
      .all(OWNER, NAMESPACE, `${workspaceKey}:${sha256(relativePath)}`);
    const provenance =
      rows.length === 1 && typeof rows[0]?.value_json === "string"
        ? JSON.parse(rows[0].value_json)
        : null;
    const result = classifyFlushWriteEvidence({
      ...input,
      workspaceKey,
      provenance,
    });
    result.provenanceSource = "native SQLite, read-only";
    return result;
  } catch {
    const result = classifyFlushWriteEvidence({
      ...input,
      workspaceKey: "unavailable",
      provenance: null,
    });
    result.reasons.push(
      "Native provenance or stable source bytes are unavailable.",
    );
    return result;
  } finally {
    database?.close();
  }
}

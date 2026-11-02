import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
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
import {
  captureFlushWriteEvidence,
  classifyFlushWriteEvidence,
} from "../src/flush-write-evidence.ts";

// Synthetic provenance/log fixtures test attribution, not a live model capability.
const NOW = Date.parse("2026-11-02T10:00:00Z");
const PATH = "memory/2026-11-02.md";
const MARKER = "synthetic-flush-only-cobalt-meter";
const SOURCE_ID = "synthetic-user-session";
const SOURCE_KEY = "agent:main:conversation";
const INTERNAL_ID = "internal-session-effects-synthetic-flush";
const INTERNAL_KEY = "agent:main:internal-session-effects:synthetic-flush";
const BEFORE = "# Daily note\n\n";
const AFTER = `${BEFORE}- ${MARKER} at 08:10.\n`;
const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

function event(overrides = {}) {
  return {
    event: "memory_flush_dispatched",
    runId: "synthetic-flush-run",
    sessionId: INTERNAL_ID,
    sessionKey: INTERNAL_KEY,
    sourceSessionId: SOURCE_ID,
    sourceSessionKey: SOURCE_KEY,
    ...overrides,
  };
}

function log(payload = event(), time = NOW + 100, level = "DEBUG") {
  return `${JSON.stringify({
    "0": '{"subsystem":"auto-reply/memory-flush"}',
    "1": payload,
    "2": "memory flush dispatched",
    _meta: { date: new Date(time).toISOString(), logLevelName: level },
  })}\n`;
}

function fixture(workspaceKey = sha256("/synthetic/workspace")) {
  return {
    logText: log(),
    logOffset: 0,
    beforeFiles: { [PATH]: BEFORE },
    afterFiles: { [PATH]: AFTER },
    foregroundHistoryDelta: [] as unknown[],
    sourceSessionId: SOURCE_ID,
    sourceSessionKey: SOURCE_KEY,
    marker: MARKER,
    startedAtMs: NOW,
    finishedAtMs: NOW + 1000,
    workspaceKey,
    provenance: {
      version: 1,
      reservationId: "synthetic-write-reservation",
      workspaceKey,
      relativePath: PATH,
      fileHash: sha256(AFTER),
      originClass: "agent",
      observedAt: NOW + 200,
      sessionId: INTERNAL_ID,
      sessionKey: INTERNAL_KEY,
    },
  };
}

test("FLUSH EVIDENCE: joins native dispatch identity, append, hash, and observation window", () => {
  const input = fixture();
  input.foregroundHistoryDelta = [
    { role: "assistant", content: [{ type: "toolCall", name: "read" }] },
  ];
  const result = classifyFlushWriteEvidence(input);
  assert.equal(result.accepted, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.afterSha256, sha256(AFTER));
  assert.equal(
    result.appendedBytes,
    Buffer.byteLength(AFTER.slice(BEFORE.length)),
  );
  assert.equal(result.dispatch?.runId, "synthetic-flush-run");
  assert.equal(result.provenance?.sessionId, INTERNAL_ID);
  assert.equal(result.provenanceSource, "supplied provenance");
});

test("FLUSH EVIDENCE: marker must be new, unique, normalized, and appended", () => {
  const variants: Partial<Parameters<typeof classifyFlushWriteEvidence>[0]>[] =
    [
      { beforeFiles: { [PATH]: AFTER } },
      { beforeFiles: { [PATH]: BEFORE, "USER.md": MARKER } },
      { beforeFiles: { [PATH]: "content replaced by the next writer" } },
      { afterFiles: { [PATH]: AFTER, "memory/other.md": MARKER } },
      { afterFiles: { "memory/../outside.md": MARKER } },
      { relativePath: "memory/other.md" },
      { marker: "" },
    ];
  for (const overrides of variants)
    assert.equal(
      classifyFlushWriteEvidence({ ...fixture(), ...overrides }).accepted,
      false,
    );
});

test("FLUSH EVIDENCE: foreground mutations and unverified tools invalidate attribution", () => {
  for (const message of [
    { role: "assistant", content: [{ type: "toolCall", name: "write" }] },
    { role: "toolResult", toolName: "edit", isError: true },
    {
      role: "assistant",
      tool_calls: [{ function: { name: "functions.apply_patch" } }],
    },
    { role: "assistant", content: [{ type: "toolCall", name: "exec" }] },
    { role: "assistant", content: [{ type: "toolCall" }] },
  ]) {
    const result = classifyFlushWriteEvidence({
      ...fixture(),
      foregroundHistoryDelta: [message],
    });
    assert.equal(result.accepted, false);
    assert.ok(result.reasons.some((reason) => reason.includes("Foreground")));
  }
});

test("FLUSH EVIDENCE: byte offset excludes old logs and only current debug source identity matches", () => {
  const prefix = `synthetic UTF-8 prefix: çığ\n${log()}`;
  assert.equal(
    classifyFlushWriteEvidence({
      ...fixture(),
      logText: prefix,
      logOffset: Buffer.byteLength(prefix),
    }).accepted,
    false,
  );
  assert.equal(
    classifyFlushWriteEvidence({
      ...fixture(),
      logText: prefix + log(),
      logOffset: Buffer.byteLength(prefix),
    }).accepted,
    true,
  );
  for (const entry of [
    log(event({ sourceSessionId: "other-session" })),
    log(event({ sourceSessionKey: "agent:main:other" })),
    log(event(), NOW - 1),
    log(event(), NOW + 1001),
    log(event(), NOW + 100, "INFO"),
    log().replace("auto-reply/memory-flush", "unrelated/subsystem"),
    `${JSON.stringify({ level: "debug", subsystem: "auto-reply/memory-flush", time: NOW + 100, message: JSON.stringify(event()) })}\n`,
  ])
    assert.equal(
      classifyFlushWriteEvidence({ ...fixture(), logText: entry }).accepted,
      false,
    );
});

test("FLUSH EVIDENCE: latest provenance must belong to flush, match bytes, and occur after dispatch", () => {
  for (const overrides of [
    { version: 2 },
    { reservationId: "" },
    { workspaceKey: sha256("other-workspace") },
    { relativePath: "memory/other.md" },
    { fileHash: sha256("different bytes") },
    { sessionId: SOURCE_ID, sessionKey: SOURCE_KEY },
    { observedAt: NOW + 99 },
    { observedAt: NOW + 1001 },
  ]) {
    const input = fixture();
    assert.equal(
      classifyFlushWriteEvidence({
        ...input,
        provenance: { ...input.provenance, ...overrides },
      }).accepted,
      false,
    );
  }
  assert.equal(
    classifyFlushWriteEvidence({
      ...fixture(),
      logText: log() + log(event({ runId: "another-run" })),
    }).accepted,
    false,
  );
});

test("FLUSH EVIDENCE: readonly SQLite capture filters exact owner, namespace, workspace, and path", async () => {
  const root = await mkdtemp(join(tmpdir(), "flush-evidence-"));
  try {
    const workspace = join(root, "workspace"),
      stateDir = join(root, "native-state");
    await mkdir(join(workspace, "memory"), { recursive: true });
    await mkdir(join(stateDir, "state"), { recursive: true });
    await writeFile(join(workspace, PATH), AFTER);
    const input = fixture(sha256(workspace));
    const databasePath = join(stateDir, "state/openclaw.sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec(
      "CREATE TABLE plugin_state_entries(plugin_id TEXT, namespace TEXT, entry_key TEXT, value_json TEXT)",
    );
    const insert = database.prepare(
      "INSERT INTO plugin_state_entries VALUES(?,?,?,?)",
    );
    insert.run(
      "core:memory-artifact-provenance",
      "workspace-files",
      `${input.workspaceKey}:${sha256(PATH)}`,
      JSON.stringify(input.provenance),
    );
    insert.run(
      "core:unrelated",
      "workspace-files",
      `${input.workspaceKey}:${sha256(PATH)}`,
      "malformed foreign JSON",
    );
    insert.run(
      "core:memory-artifact-provenance",
      "workspace-files",
      `${sha256("other")}:${sha256(PATH)}`,
      "malformed foreign JSON",
    );
    insert.run(
      "core:memory-artifact-provenance",
      "workspace-files",
      `${input.workspaceKey}:${sha256("memory/other.md")}`,
      "malformed foreign JSON",
    );
    database.close();
    const before = await readFile(databasePath);
    const result = await captureFlushWriteEvidence({
      ...input,
      stateDir,
      workspaceDir: workspace,
    });
    assert.equal(result.accepted, true);
    assert.equal(result.provenanceSource, "native SQLite, read-only");
    assert.deepEqual(await readFile(databasePath), before);
    await writeFile(join(workspace, PATH), "a later writer changed the source");
    assert.equal(
      (
        await captureFlushWriteEvidence({
          ...input,
          stateDir,
          workspaceDir: workspace,
        })
      ).accepted,
      false,
    );
    await rm(join(workspace, PATH));
    await writeFile(join(root, "outside.md"), AFTER);
    await symlink(join(root, "outside.md"), join(workspace, PATH));
    assert.equal(
      (
        await captureFlushWriteEvidence({
          ...input,
          stateDir,
          workspaceDir: workspace,
        })
      ).accepted,
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("FLUSH EVIDENCE: missing native database remains unavailable and is never created", async () => {
  const root = await mkdtemp(join(tmpdir(), "flush-evidence-missing-"));
  try {
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, "memory"), { recursive: true });
    await writeFile(join(workspace, PATH), AFTER);
    const input = fixture(sha256(workspace));
    const result = await captureFlushWriteEvidence({
      ...input,
      stateDir: root,
      workspaceDir: workspace,
    });
    assert.equal(result.accepted, false);
    await assert.rejects(readFile(join(root, "state/openclaw.sqlite")), {
      code: "ENOENT",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

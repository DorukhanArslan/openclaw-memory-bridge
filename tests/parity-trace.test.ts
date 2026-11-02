import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { readTrace, TraceJournal } from "../examples/parity/trace.ts";

const execute = promisify(execFile);
const options = { captureId: "synthetic-capture", route: "sdk-http" };
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "parity-journal-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("TRACE: durable prefixes retain ordered requests, payloads, generations and restart barriers", async () =>
  fixture(async (root) => {
    const path = join(root, "capture.jsonl"),
      journal = new TraceJournal(path, options);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    journal.beginGeneration("before-restart");
    const first = journal.start("http", {
      body: { query: "synthetic", hits: [1, 1, 2] },
    });
    const second = journal.start("cli", {
      argv: ["memory", "status", "--json"],
    });
    journal.end(second, "cli.result", {
      stdout: '{"ok":true}\n',
      stderr: "diagnostic\n",
      status: 0,
    });
    journal.barrier("before-http-completion");
    let prefix = readTrace(path);
    assert.equal(prefix.complete, false);
    assert.deepEqual(prefix.pending, [first]);
    assert.equal(prefix.records.at(-1)?.kind, "trace.barrier");
    journal.end(first, "http.response", {
      status: 200,
      raw: '{"results":[1,1,2]}',
    });
    journal.barrier("before-restart");
    journal.beginGeneration("after-restart");
    journal.record("session.reopened", { parent: "original-main" });
    const manifest = journal.finish();
    prefix = readTrace(path);
    assert.equal(prefix.complete, true);
    assert.deepEqual(prefix.errors, []);
    assert.equal(prefix.events, manifest.events);
    assert.equal(prefix.sha256, manifest.sha256);
    assert.deepEqual(prefix.records[2]?.data, {
      body: { query: "synthetic", hits: [1, 1, 2] },
    });
    assert.deepEqual(
      prefix.records
        .filter((r) => r.kind === "generation.start")
        .map((r) => r.generation),
      [1, 2],
    );
    assert.ok(
      prefix.records.every(
        (r, i) =>
          r.sequence === i + 1 && Number.isFinite(Date.parse(r.wallTime)),
      ),
    );
    assert.ok(
      prefix.records
        .slice(1)
        .every(
          (r, i) =>
            BigInt(r.monotonicNs) >=
            BigInt(prefix.records[i]?.monotonicNs ?? "0"),
        ),
    );
    assert.throws(() => journal.record("late", {}), /closed or poisoned/);
    assert.equal(
      readTrace(path).complete,
      true,
      "A completed immutable trace is not rewritten by a late caller.",
    );
  }));

test("TRACE: selected credentials, generated Gateway tokens, nested keys and URL credentials never reach disk", async () =>
  fixture(async (root) => {
    const path = join(root, "capture.jsonl"),
      selected = "synthetic-provider-secret-222",
      gateway = "synthetic-generated-gateway-333";
    const journal = new TraceJournal(path, { ...options, secrets: [selected] });
    journal.addSecret(gateway);
    const safeURL =
      "http://127.0.0.1:1234/tools/invoke?query=Ankara%20Istanbul";
    journal.record("http.response", {
      selected: `Before ${selected} after`,
      gateway: `Before ${gateway} after`,
      nested: {
        api_key: "unregistered-structured-secret",
        authorization: "Basic opaque-header",
        maxTokens: 512,
      },
      raw: '{ "access_token" : "raw-secret-444", "ok": true }',
      bearer: "Bearer unregistered-bearer-555",
      url: "https://url-user:url-password@example.com/path?token=url-secret-666&query=flowers",
      safeURL,
    });
    journal.finish();
    const bytes = await readFile(path, "utf8");
    for (const secret of [
      selected,
      gateway,
      "unregistered-structured-secret",
      "opaque-header",
      "raw-secret-444",
      "unregistered-bearer-555",
      "url-user",
      "url-password",
      "url-secret-666",
    ])
      assert.equal(bytes.includes(secret), false, secret);
    const event = readTrace(path).records[1];
    assert.ok(event);
    assert.equal(
      (event.data as Record<string, unknown>).safeURL,
      safeURL,
      "Safe payload URLs are not normalized.",
    );
    assert.equal(
      (
        (event.data as Record<string, unknown>).nested as Record<
          string,
          unknown
        >
      ).maxTokens,
      512,
    );
    const unsafeScope = join(root, "unsafe-scope.jsonl");
    assert.throws(
      () =>
        new TraceJournal(unsafeScope, {
          ...options,
          captureId: selected,
          secrets: [selected],
        }),
      /creation failed/,
    );
    assert.equal(
      (await readFile(unsafeScope, "utf8")).includes(selected),
      false,
    );
  }));

test("TRACE: existing targets, symlinks and public directories are rejected without repair", async () =>
  fixture(async (root) => {
    const existing = join(root, "existing.jsonl");
    await writeFile(existing, "untouched", { mode: 0o600 });
    assert.throws(() => new TraceJournal(existing, options));
    assert.equal(await readFile(existing, "utf8"), "untouched");
    const linked = join(root, "linked.jsonl");
    await symlink(existing, linked);
    assert.throws(() => new TraceJournal(linked, options));
    assert.equal(readTrace(linked).complete, false);
    const publicRoot = join(root, "public");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(publicRoot, { mode: 0o755 });
    await chmod(publicRoot, 0o755);
    assert.throws(
      () => new TraceJournal(join(publicRoot, "capture.jsonl"), options),
      /private directory/,
    );
    await chmod(root, 0o700);
  }));

test("TRACE: oversized or non-JSON records poison the owner and cannot add a completion footer", async () =>
  fixture(async (root) => {
    for (const [name, value] of [
      ["oversize", "x".repeat(1000)],
      ["non-json", { invalid: undefined }],
    ] as const) {
      const path = join(root, `${name}.jsonl`),
        journal = new TraceJournal(path, { ...options, maxEventBytes: 512 });
      assert.throws(() => journal.record("test", value), /cannot be persisted/);
      assert.equal(journal.poisoned, true);
      assert.throws(() => journal.finish(), /closed or poisoned/);
      assert.equal(readTrace(path).complete, false);
      assert.equal(
        (await readFile(path, "utf8")).includes('"trace.complete"'),
        false,
      );
    }
  }));

test("TRACE: replaced storage poisons capture and preserves both incomplete prefix and replacement", async () =>
  fixture(async (root) => {
    const path = join(root, "capture.jsonl"),
      moved = join(root, "prefix.jsonl"),
      journal = new TraceJournal(path, options);
    const operation = journal.start("http", { request: "synthetic" });
    await rename(path, moved);
    await writeFile(path, "replacement", { mode: 0o600 });
    assert.throws(
      () => journal.end(operation, "http.error", { error: "network lost" }),
      /cannot be persisted/,
    );
    assert.equal(journal.poisoned, true);
    assert.equal(await readFile(path, "utf8"), "replacement");
    assert.equal(readTrace(moved).complete, false);
    assert.deepEqual(readTrace(moved).pending, [operation]);
  }));

test("TRACE: a child can exit before the final report while its fsynced request prefix remains readable", async () =>
  fixture(async (root) => {
    const path = join(root, "interrupted.jsonl");
    await execute(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {TraceJournal} from ${JSON.stringify(new URL("../examples/parity/trace.ts", import.meta.url).href)};const j=new TraceJournal(${JSON.stringify(path)},${JSON.stringify(options)});j.start('cli',{argv:['memory','status']});j.barrier('before-report');process.exit(0);`,
      ],
      { env: { PATH: "/usr/bin:/bin" }, timeout: 10000 },
    );
    const prefix = readTrace(path);
    assert.equal(prefix.complete, false);
    assert.deepEqual(
      prefix.records.map((r) => r.kind),
      ["trace.open", "cli.start", "trace.barrier"],
    );
    const before = await readFile(path);
    await appendFile(path, '{"v":1');
    const damaged = readTrace(path);
    assert.equal(damaged.complete, false);
    assert.ok(damaged.errors.includes("truncated_tail"));
    assert.deepEqual(damaged.records, prefix.records);
    assert.deepEqual((await readFile(path)).subarray(0, before.length), before);
  }));

test("TRACE: unknown, duplicate or unfinished operations cannot claim completion", async () =>
  fixture(async (root) => {
    for (const mode of ["unknown", "duplicate", "pending"]) {
      const path = join(root, `${mode}.jsonl`),
        journal = new TraceJournal(path, options),
        id = journal.start("http", {});
      if (mode === "unknown")
        assert.throws(
          () => journal.end("op-unknown", "http.error", {}),
          /unknown/,
        );
      else if (mode === "duplicate") {
        journal.end(id, "http.response", { status: 200 });
        assert.throws(
          () => journal.end(id, "http.response", { status: 200 }),
          /unknown/,
        );
      } else assert.throws(() => journal.finish(), /unfinished/);
      assert.equal(readTrace(path).complete, false);
    }
  }));

test("TRACE: readers reject scope changes, reordered records and events after completion without modifying evidence", async () =>
  fixture(async (root) => {
    const source = join(root, "source.jsonl"),
      journal = new TraceJournal(source, options);
    journal.record("event", { duplicates: ["a", "a"] });
    journal.finish();
    const lines = (await readFile(source, "utf8")).trimEnd().split("\n");
    const variants = [
      [lines[0], lines[2], lines[1]],
      lines.map((line, index) =>
        index === 1
          ? JSON.stringify({ ...JSON.parse(line ?? "{}"), route: "foreign" })
          : line,
      ),
      [...lines, lines[1]],
    ];
    for (const [index, variant] of variants.entries()) {
      const path = join(root, `bad-${index}.jsonl`),
        bytes = Buffer.from(`${variant.join("\n")}\n`);
      await writeFile(path, bytes, { mode: 0o600 });
      const before = createHash("sha256").update(bytes).digest("hex");
      assert.equal(readTrace(path).complete, false);
      assert.equal(
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
        before,
      );
    }
  }));

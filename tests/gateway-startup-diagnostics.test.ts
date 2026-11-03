import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  describeGatewayFailure,
  formatGatewayStartupFailure,
  readGatewayLogTail,
} from "../src/gateway-startup-diagnostics.ts";

test("GATEWAY DIAGNOSTICS: fetch failure retains bounded transport causes without nested request data", () => {
  const refusal = Object.assign(
    new Error("connect http://private:credential@localhost/?token=synthetic"),
    {
      code: "ECONNREFUSED",
      syscall: "connect",
      address: "127.0.0.1",
      port: 43210,
    },
  );
  const timeout = Object.assign(new Error("private timeout detail"), {
    code: "UND_ERR_CONNECT_TIMEOUT",
  });
  const error = new TypeError("fetch failed", {
    cause: new AggregateError([refusal, timeout], "private aggregate body"),
  });
  const result = describeGatewayFailure(error);
  assert.match(result, /^fetch failed/);
  assert.match(result, /ECONNREFUSED connect 127\.0\.0\.1 port 43210/);
  assert.match(result, /UND_ERR_CONNECT_TIMEOUT/);
  assert.doesNotMatch(result, /credential|token=|private|http:/);

  const cyclic: Record<string, unknown> = {
    code: "BAD VALUE synthetic-secret",
    syscall: "http://synthetic-secret",
    address: "synthetic-secret",
    port: 99999,
  };
  cyclic.cause = cyclic;
  assert.equal(
    describeGatewayFailure(new Error("original failure", { cause: cyclic })),
    "original failure",
  );
  assert.equal(describeGatewayFailure(null), "Unknown Gateway startup error.");
});

test("GATEWAY DIAGNOSTICS: formatter preserves the primary error, runtime and log channels after redaction", () => {
  const secret = "synthetic-gateway-token";
  const proxy = "https://private:synthetic-password@proxy.invalid:8443";
  const result = formatGatewayStartupFailure({
    error: new Error(`fetch failed ${secret}`),
    elapsedMs: 60001.6,
    exitCode: 7,
    signal: null,
    consoleLog: `Proxy: ${proxy}`,
    fileLog: `Native failure with bearer ${secret}`,
    nodeVersion: "24.16.0",
    platform: "darwin arm64",
    redact: (text) =>
      text.split(secret).join("[REDACTED]").split(proxy).join("[REDACTED]"),
  });
  assert.match(result, /^fetch failed \[REDACTED\]/);
  assert.match(result, /60002 ms; Node 24\.16\.0; darwin arm64/);
  assert.match(result, /Native process: exited with code 7/);
  assert.match(result, /Gateway diagnostics:\nConsole output:\nProxy:/);
  assert.match(result, /Native log:\nNative failure/);
  assert.match(result, /may include entries from earlier starts/);
  assert.doesNotMatch(result, /synthetic|private:|proxy\.invalid/);

  const empty = formatGatewayStartupFailure({
    error: new Error("fetch failed"),
    elapsedMs: 0,
    exitCode: null,
    signal: null,
    consoleLog: "",
    fileLog: "",
    nodeVersion: "24.16.0",
    platform: "linux x64",
    redact: (text) => text,
  });
  assert.match(empty, /no exit or signal recorded/);
  assert.match(empty, /no console output captured/);
  assert.match(empty, /native log is empty/);
});

test("GATEWAY DIAGNOSTICS: reads a bounded actual log tail and omits incomplete leading lines", async () => {
  const root = await mkdtemp(join(tmpdir(), "gateway-log-tail-"));
  try {
    const path = join(root, "native.log");
    await writeFile(
      path,
      `${"private-prefix".repeat(2000)}\nactual native failure\n`,
    );
    const tail = await readGatewayLogTail(path, 64);
    assert.equal(tail, "actual native failure\n");
    assert.ok(Buffer.byteLength(tail) <= 64);
    await writeFile(path, "one complete line\n");
    assert.equal(await readGatewayLogTail(path), "one complete line\n");
    await writeFile(path, "x".repeat(200));
    assert.match(
      await readGatewayLogTail(path, 16),
      /incomplete line; omitted/,
    );
    await writeFile(path, "");
    assert.equal(await readGatewayLogTail(path), "(native log is empty)");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("GATEWAY DIAGNOSTICS: missing, linked and nonregular logs are explicit without leaking paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "gateway-log-safety-"));
  try {
    assert.equal(
      await readGatewayLogTail(join(root, "missing.log")),
      "(native log file was not created)",
    );
    const file = join(root, "real.log");
    await writeFile(file, "synthetic private content");
    const linked = join(root, "linked.log");
    await symlink(file, linked);
    assert.match(await readGatewayLogTail(linked), /symbolic link refused/);
    const directory = join(root, "directory.log");
    await mkdir(directory);
    assert.match(
      await readGatewayLogTail(directory),
      /expected a regular file with one link/,
    );
    await link(file, join(root, "hard-link.log"));
    assert.match(
      await readGatewayLogTail(file),
      /expected a regular file with one link/,
    );
    for (const limit of [0, -1, Number.NaN, 65537])
      assert.match(await readGatewayLogTail(file, limit), /invalid tail limit/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

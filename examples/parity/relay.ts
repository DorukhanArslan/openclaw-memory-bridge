// Test-only transparent JSONL recorder, strict replayer and write-ack fault.
import { spawn } from "node:child_process";
import {
  closeSync,
  constants,
  fsyncSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { isDeepStrictEqual } from "node:util";
import { TraceJournal } from "./trace.ts";

const cfg = JSON.parse(
  readFileSync(new URL("../relay.json", import.meta.url), "utf8"),
);
const trace = cfg.traceJournal
  ? new TraceJournal(cfg.traceJournal, {
      captureId: cfg.captureId,
      route: "sdk-protocol",
      secrets: [
        process.env.OPENROUTER_API_KEY,
        process.env.OPENCLAW_GATEWAY_TOKEN,
      ].filter((value): value is string => Boolean(value)),
    })
  : undefined;
trace?.beginGeneration("relay");
if (cfg.mode === "replay") {
  const tape = readFileSync(cfg.source, "utf8")
    .trim()
    .split("\n")
    .map((s: string) => JSON.parse(s));
  const ready = tape.shift().value;
  trace?.record("replay.ready", ready);
  process.stdout.write(`${JSON.stringify(ready)}\n`);
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    const request = JSON.parse(line);
    const operation = trace?.start("replay.request", request);
    const expected = tape.shift();
    if (
      expected?.kind !== "request" ||
      !isDeepStrictEqual(request, expected.value)
    ) {
      if (operation)
        trace?.end(operation, "replay.error", { code: "replay_mismatch" });
      process.stdout.write(
        `${JSON.stringify({ v: 1, id: request.id, ok: false, error: { code: "replay_mismatch", message: "Strict ordered request mismatch" } })}\n`,
      );
      process.exitCode = 2;
      rl.close();
      break;
    }
    const response = tape.shift();
    if (response?.kind !== "response")
      throw new Error("Missing recorded response");
    if (operation) trace?.end(operation, "replay.response", response.value);
    process.stdout.write(`${JSON.stringify(response.value)}\n`);
    if (request.op === "shutdown") {
      if (tape.length) throw new Error("Unconsumed replay records");
      break;
    }
  }
  rl.close();
  process.stdin.destroy();
  trace?.finish();
} else {
  // The replay tape remains exact. Private durable diagnostics use a separate file.
  const tape = openSync(
    cfg.tape,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  const log = (value: unknown) => {
    if (trace && !isDeepStrictEqual(trace.redact(value), value))
      trace.fail(
        "A sensitive payload cannot be written to an exact replay tape.",
      );
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(tape, bytes, offset, bytes.length - offset);
      if (!written) throw new Error("Replay tape write did not advance.");
      offset += written;
    }
    fsyncSync(tape);
  };
  const childOperation = trace?.start("child.process", { entry: cfg.entry });
  const stderrOperation = trace?.start("child.stderr", {});
  const child = spawn(
    process.execPath,
    ["--import", cfg.capture, cfg.entry, process.argv[2]],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PARITY_CAPTURE: cfg.httpTape,
        PARITY_JOURNAL_PATH: cfg.httpJournal ?? "",
        PARITY_CAPTURE_ID: cfg.captureId ?? "",
      },
    },
  );
  if (!child.stdout || !child.stdin || !child.stderr)
    throw new Error("Missing child pipes");
  trace?.record("child.spawned", { pid: child.pid });
  const input = createInterface({ input: process.stdin });
  const output = createInterface({ input: child.stdout });
  const requests = new Map<
    string,
    { op: string; args?: { noteId?: string }; traceOperation?: string }
  >();
  let dropped = false;
  let failed = false;
  let forceStop: ReturnType<typeof setTimeout> | undefined;
  const fail = () => {
    if (failed) return;
    failed = true;
    try {
      trace?.fail("Relay capture failed; retained prefix is incomplete.");
    } catch {}
    process.exitCode = 2;
    input.close();
    process.stdin.destroy();
    child.kill("SIGTERM");
    forceStop = setTimeout(() => child.kill("SIGKILL"), 2000);
    forceStop.unref();
  };
  const safely = (action: () => void) => {
    if (failed) return;
    try {
      action();
    } catch {
      fail();
    }
  };
  // Validate raw bytes before readline can replace invalid UTF-8 and emit a line.
  const stdoutDecoder = new TextDecoder("utf-8", { fatal: true });
  child.stdout.prependListener("data", (data: Buffer) =>
    safely(() => {
      stdoutDecoder.decode(data, { stream: true });
    }),
  );
  child.stdout.prependListener("end", () =>
    safely(() => {
      stdoutDecoder.decode();
    }),
  );
  input.on("line", (line) => {
    safely(() => {
      let r: { id: string; op: string; args?: { noteId?: string } };
      try {
        r = JSON.parse(line);
      } catch {
        trace?.record("protocol.stdin.invalid", { line });
        throw new Error("Input protocol was not JSON.");
      }
      if (
        !r ||
        typeof r.id !== "string" ||
        typeof r.op !== "string" ||
        requests.has(r.id)
      )
        throw new Error("Input protocol has no unique request identity.");
      if (["restart", "shutdown"].includes(r.op))
        trace?.barrier(`before.${r.op}`);
      const traceOperation = trace?.start("protocol.request", r);
      requests.set(r.id, { ...r, traceOperation });
      log({ kind: "request", value: r });
      child.stdin?.write(`${line}\n`);
    });
  });
  output.on("line", (line) => {
    safely(() => {
      let r: { id?: string; event?: string; ok?: boolean };
      try {
        r = JSON.parse(line);
      } catch {
        trace?.record("protocol.stdout.invalid", { line });
        throw new Error("Child protocol was not JSON.");
      }
      if (!r || (r.event !== "ready" && typeof r.id !== "string"))
        throw new Error("Child protocol has no response identity.");
      const q = r.id ? requests.get(r.id) : undefined;
      if (r.event === "ready") trace?.record("protocol.ready", r);
      else if (q?.traceOperation)
        trace?.end(q.traceOperation, "protocol.response", r);
      else if (trace)
        trace.fail("Child returned an uncorrelated protocol response.");
      log({ kind: r.event === "ready" ? "ready" : "response", value: r });
      if (r.id) requests.delete(r.id);
      if (
        cfg.dropAck &&
        !dropped &&
        q?.op === "write" &&
        q.args?.noteId === "retry-boundary" &&
        r.ok
      ) {
        dropped = true;
        writeFileSync(
          cfg.witness,
          JSON.stringify({ writeCompleted: true, response: r }),
          { flag: "wx", mode: 0o600 },
        );
        trace?.record("protocol.ack_dropped", { id: r.id, operation: q.op });
        return;
      }
      process.stdout.write(`${line}\n`);
    });
  });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let stderr = "";
  let stderrBytes = 0;
  const stderrLine = (text: string) => {
    trace?.record(
      "child.stderr.data",
      { text },
      { operationId: stderrOperation },
    );
    if (trace) process.stderr.write(trace.redact(text) as string);
  };
  child.stderr.on("data", (data: Buffer) =>
    safely(() => {
      stderrBytes += data.length;
      if (stderrBytes > 8 * 1024 * 1024)
        throw new Error("Child stderr exceeded the capture limit.");
      stderr += decoder.decode(data, { stream: true });
      let end = stderr.indexOf("\n");
      while (end >= 0) {
        stderrLine(stderr.slice(0, end + 1));
        stderr = stderr.slice(end + 1);
        end = stderr.indexOf("\n");
      }
    }),
  );
  const close = () => {
    input.close();
    child.stdin?.end();
  };
  process.on("SIGTERM", () =>
    safely(() => {
      trace?.barrier("relay.sigterm");
      close();
    }),
  );
  input.on("close", () => child.stdin?.end());
  child.on("error", () => fail());
  child.stdin.on("error", () => fail());
  child.stdout.on("error", () => fail());
  process.stdout.on("error", () => fail());
  child.on("close", (code, signal) => {
    clearTimeout(forceStop);
    const interrupted = requests.size > 0;
    try {
      if (!failed) {
        stderr += decoder.decode();
        if (stderr) stderrLine(stderr);
        if (stderrOperation)
          trace?.end(stderrOperation, "child.stderr.result", {
            bytes: stderrBytes,
          });
        for (const [id, request] of requests)
          if (request.traceOperation)
            trace?.end(request.traceOperation, "protocol.error", {
              id,
              code: "child_closed",
              outcome: "unknown",
            });
        if (childOperation)
          trace?.end(childOperation, "child.result", { code, signal });
        trace?.finish();
      }
      fsyncSync(tape);
    } catch {
      failed = true;
    }
    closeSync(tape);
    process.exitCode = failed || interrupted ? 2 : (code ?? 1);
    input.close();
    process.stdin.destroy();
  });
}

// Test-only transparent JSONL recorder, strict replayer and write-ack fault.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { isDeepStrictEqual } from "node:util";

const cfg = JSON.parse(
  readFileSync(new URL("../relay.json", import.meta.url), "utf8"),
);
function log(value: unknown) {
  appendFileSync(cfg.tape, `${JSON.stringify(value)}\n`);
}
if (cfg.mode === "replay") {
  const tape = readFileSync(cfg.source, "utf8")
    .trim()
    .split("\n")
    .map((s: string) => JSON.parse(s));
  process.stdout.write(`${JSON.stringify(tape.shift().value)}\n`);
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    const request = JSON.parse(line);
    const expected = tape.shift();
    if (
      expected?.kind !== "request" ||
      !isDeepStrictEqual(request, expected.value)
    ) {
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
    process.stdout.write(`${JSON.stringify(response.value)}\n`);
    if (request.op === "shutdown") {
      if (tape.length) throw new Error("Unconsumed replay records");
      break;
    }
  }
  rl.close();
  process.stdin.destroy();
} else {
  const child = spawn(
    process.execPath,
    ["--import", cfg.capture, cfg.entry, process.argv[2]],
    {
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, PARITY_CAPTURE: cfg.httpTape },
    },
  );
  if (!child.stdout || !child.stdin) throw new Error("Missing child pipes");
  const input = createInterface({ input: process.stdin });
  const output = createInterface({ input: child.stdout });
  const requests = new Map<
    string,
    { op: string; args?: { noteId?: string } }
  >();
  let dropped = false;
  input.on("line", (line) => {
    const r = JSON.parse(line);
    requests.set(r.id, r);
    log({ kind: "request", value: r });
    child.stdin?.write(`${line}\n`);
  });
  output.on("line", (line) => {
    const r = JSON.parse(line);
    log({ kind: r.event === "ready" ? "ready" : "response", value: r });
    const q = requests.get(r.id);
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
      );
      return;
    }
    process.stdout.write(`${line}\n`);
  });
  const close = () => {
    input.close();
    child.stdin?.end();
  };
  process.on("SIGTERM", close);
  input.on("close", () => child.stdin?.end());
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
    input.close();
  });
}

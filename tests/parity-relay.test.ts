import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { readTrace } from "../examples/parity/trace.ts";

const TOKEN = "synthetic-relay-gateway-token-7722";
const relay = new URL("../examples/parity/relay.ts", import.meta.url);
const helper = new URL("../examples/parity/trace.ts", import.meta.url);
type Packet = Record<string, unknown>;
const request = (id: string, op: string, args: Packet = {}) => ({
  v: 1,
  id,
  op,
  workspace: "synthetic-alpha",
  args,
});

async function fixture(mode = "normal") {
  const root = await mkdtemp(join(tmpdir(), "parity-relay-trace-"));
  const src = join(root, "src"),
    traces = join(root, "traces");
  await mkdir(src, { mode: 0o700 });
  await mkdir(traces, { mode: 0o700 });
  await copyFile(relay, join(src, "stdio.ts"));
  await copyFile(helper, join(src, "trace.ts"));
  const entry = join(root, "fixture-child.mjs");
  const capture = join(root, "noop-capture.mjs");
  const marker = join(root, "child-marker.json");
  const journal = join(traces, "protocol.jsonl");
  const tape = join(root, "protocol.tape.jsonl");
  await writeFile(
    capture,
    "// A synthetic fixture; no fetch/native model hooks.\n",
  );
  await writeFile(
    entry,
    `
import {createInterface} from 'node:readline';
import {readFileSync,writeFileSync} from 'node:fs';
const marker=process.env.RELAY_FIXTURE_MARKER;
const mode=process.env.RELAY_FIXTURE_MODE;
writeFileSync(marker,JSON.stringify({started:true,pid:process.pid}));
const token=process.env.OPENCLAW_GATEWAY_TOKEN;
process.stderr.write('diagnostic '+token.slice(0,13));
setTimeout(()=>process.stderr.write(token.slice(13)+'\\nunterminated '+token),8);
const rl=createInterface({input:process.stdin});
let guard;
rl.on('line',line=>{
 const q=JSON.parse(line);
 const trace=readFileSync(process.env.RELAY_FIXTURE_TRACE,'utf8').trim().split('\\n').map(JSON.parse);
 const durableStart=trace.some(e=>e.kind==='protocol.request.start'&&e.data.id===q.id);
 writeFileSync(marker,JSON.stringify({started:true,pid:process.pid,handled:q.id,durableStart}));
 if(mode==='exit-pending'){
  process.stderr.write('\\nexit-before-reply\\n');
  process.exitCode=3;rl.close();process.stdin.destroy();return;
 }
 if(mode==='hang-pending'){
  guard=setTimeout(()=>{rl.close();process.stdin.destroy();},2000);return;
 }
 if(mode==='invalid-utf8'&&q.op!=='shutdown'){
  const packet=JSON.stringify({v:1,id:q.id,ok:true,result:{text:'MARKER'}});
  const offset=packet.indexOf('MARKER');
  process.stdout.write(Buffer.concat([Buffer.from(packet.slice(0,offset)),Buffer.from([255]),Buffer.from(packet.slice(offset+6)+'\\n')]));
  return;
 }
 const hit={path:'memory/fixture.md',score:.25,provenance:{originClass:'agent',observedAt:123}};
 const result=q.op==='shutdown'?{closed:true}:mode==='valid-replacement'?{durableStart,text:'\uFFFD'}:{durableStart,hits:[hit,hit]};
 process.stdout.write(JSON.stringify({v:1,id:q.id,ok:true,result})+'\\n');
 if(q.op==='shutdown'){rl.close();process.stdin.destroy();}
});
rl.on('close',()=>{clearTimeout(guard);});
process.stdout.write(JSON.stringify({v:1,event:'ready',engine:{name:'labelled relay fixture'}})+'\\n');
`,
  );
  const config = {
    mode: "record",
    entry,
    capture,
    tape,
    httpTape: join(root, "unused-http.jsonl"),
    traceJournal: journal,
    captureId: "synthetic-relay-capture",
    dropAck: false,
    witness: join(root, "unused-witness.json"),
    source: "",
  };
  await writeFile(join(root, "relay.json"), JSON.stringify(config));
  const launch = () => {
    const child = spawn(
      process.execPath,
      [join(src, "stdio.ts"), "synthetic-alpha"],
      {
        cwd: root,
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "en_US.UTF-8",
          OPENCLAW_GATEWAY_TOKEN: TOKEN,
          RELAY_FIXTURE_MARKER: marker,
          RELAY_FIXTURE_MODE: mode,
          RELAY_FIXTURE_TRACE: journal,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const output: string[] = [];
    let stderr = "";
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => output.push(line));
    child.stderr.on("data", (data) => {
      stderr += String(data);
    });
    const closed = once(child, "close") as Promise<
      [number | null, NodeJS.Signals | null]
    >;
    const next = async () => {
      const value = await Promise.race([
        once(lines, "line").then(
          ([line]) => JSON.parse(String(line)) as Packet,
        ),
        closed.then(() => {
          throw new Error("Fixture relay closed before a protocol response.");
        }),
      ]);
      return value;
    };
    const send = async (value: Packet) => {
      const response = next();
      child.stdin.write(`${JSON.stringify(value)}\n`);
      return response;
    };
    return { child, output, next, send, closed, stderr: () => stderr };
  };
  return { root, src, traces, entry, marker, journal, tape, config, launch };
}

test("PARITY RELAY: actual record/replay preserves ordered payloads while stderr and restart barriers are durable", {
  timeout: 20000,
}, async () => {
  const f = await fixture();
  const running = f.launch();
  try {
    const ready = await running.next();
    const queries = [
      request("fixture-1", "restart"),
      request("fixture-2", "search", { query: "Synthetic orchids" }),
      request("fixture-3", "shutdown"),
    ];
    const responses: Packet[] = [];
    for (const query of queries) responses.push(await running.send(query));
    assert.equal((await running.closed)[0], 0, running.stderr());
    const tapeText = await readFile(f.tape, "utf8");
    const tape = tapeText
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(tape, [
      { kind: "ready", value: ready },
      ...queries.flatMap((query, i) => [
        { kind: "request", value: query },
        { kind: "response", value: responses[i] },
      ]),
    ]);
    for (const response of responses.slice(0, 2)) {
      const result = response.result as {
        durableStart: boolean;
        hits: unknown[];
      };
      assert.equal(result.durableStart, true);
      assert.equal(result.hits.length, 2);
      assert.deepEqual(result.hits[0], result.hits[1]);
    }
    const trace = readTrace(f.journal);
    assert.equal(trace.complete, true, trace.errors.join(","));
    assert.deepEqual(trace.pending, []);
    for (const operation of ["restart", "shutdown"]) {
      const barrier = trace.records.findIndex(
        (e) =>
          e.kind === "trace.barrier" &&
          (e.data as Packet).label === `before.${operation}`,
      );
      const start = trace.records.findIndex(
        (e) =>
          e.kind === "protocol.request.start" &&
          (e.data as Packet).op === operation,
      );
      assert.ok(barrier >= 0 && barrier < start);
    }
    const text = await readFile(f.journal, "utf8");
    assert.equal(text.includes(TOKEN), false);
    assert.equal(running.stderr().includes(TOKEN), false);
    const capturedStderr = trace.records
      .filter((e) => e.kind === "child.stderr.data")
      .map((e) => (e.data as { text: string }).text)
      .join("");
    assert.ok(
      capturedStderr.includes("diagnostic [REDACTED]\nunterminated [REDACTED]"),
    );
    assert.equal((await stat(f.journal)).mode & 0o777, 0o600);
    assert.equal((await stat(f.tape)).mode & 0o777, 0o600);

    const replayJournal = join(f.traces, "replay.jsonl");
    await writeFile(
      join(f.root, "relay.json"),
      JSON.stringify({
        ...f.config,
        mode: "replay",
        source: f.tape,
        traceJournal: replayJournal,
      }),
    );
    const replay = f.launch();
    assert.deepEqual(await replay.next(), ready);
    for (let i = 0; i < queries.length; i++)
      assert.deepEqual(await replay.send(queries[i] as Packet), responses[i]);
    assert.equal((await replay.closed)[0], 0, replay.stderr());
    assert.equal(await readFile(f.tape, "utf8"), tapeText);
    assert.equal(readTrace(replayJournal).complete, true);
  } finally {
    running.child.kill("SIGTERM");
    await rm(f.root, { recursive: true, force: true });
  }
});

test("PARITY RELAY: existing and linked journal destinations fail before the fixture child starts", {
  timeout: 20000,
}, async () => {
  for (const linked of [false, true]) {
    const f = await fixture();
    try {
      const target = join(f.root, "existing-evidence");
      await writeFile(target, "preserve-existing-evidence", { mode: 0o600 });
      if (linked) await symlink(target, f.journal);
      else
        await writeFile(f.journal, "preserve-existing-evidence", {
          mode: 0o600,
        });
      const child = f.launch();
      assert.notEqual((await child.closed)[0], 0);
      await assert.rejects(access(f.marker));
      await assert.rejects(access(f.tape));
      assert.equal(
        await readFile(target, "utf8"),
        "preserve-existing-evidence",
      );
      assert.equal(
        await readFile(f.journal, "utf8"),
        "preserve-existing-evidence",
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  }
});

test("PARITY RELAY: a child closing without a response records an unknown outcome and never invents an acknowledgement", {
  timeout: 20000,
}, async () => {
  const f = await fixture("exit-pending");
  const child = f.launch();
  try {
    await child.next();
    const value = request("pending-1", "search", {
      query: "Synthetic pending",
    });
    child.child.stdin.write(`${JSON.stringify(value)}\n`);
    const [code] = await child.closed;
    assert.equal(code, 2);
    assert.equal(
      child.output.length,
      1,
      "Only the initial ready packet can reach the client.",
    );
    const trace = readTrace(f.journal);
    assert.equal(
      trace.complete,
      true,
      "The observed failure is complete evidence, not a successful operation.",
    );
    const outcome = trace.records.find((e) => e.kind === "protocol.error");
    assert.deepEqual(outcome?.data, {
      id: "pending-1",
      code: "child_closed",
      outcome: "unknown",
    });
    assert.equal(
      trace.records.some((e) => e.kind === "protocol.response"),
      false,
    );
    assert.equal((await readFile(f.journal, "utf8")).includes(TOKEN), false);
  } finally {
    child.child.kill("SIGTERM");
    await rm(f.root, { recursive: true, force: true });
  }
});

test("PARITY RELAY: an interrupted recorder retains its persisted request prefix without a completion claim", {
  timeout: 20000,
}, async () => {
  const f = await fixture("hang-pending");
  const child = f.launch();
  try {
    await child.next();
    child.child.stdin.write(
      `${JSON.stringify(request("interrupted-1", "search", { query: "Synthetic interruption" }))}\n`,
    );
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      try {
        const marker = JSON.parse(await readFile(f.marker, "utf8"));
        if (marker.handled === "interrupted-1") break;
      } catch {
        /* The synthetic child may be replacing its marker. */
      }
      await delay(10);
    }
    const before = readTrace(f.journal);
    assert.ok(
      before.records.some(
        (e) =>
          e.kind === "protocol.request.start" &&
          (e.data as Packet).id === "interrupted-1",
      ),
    );
    child.child.kill("SIGKILL");
    await child.closed;
    const after = readTrace(f.journal);
    assert.equal(after.complete, false);
    assert.ok(after.errors.includes("missing_completion"));
    assert.ok(
      after.records.some(
        (e) =>
          e.kind === "protocol.request.start" &&
          (e.data as Packet).id === "interrupted-1",
      ),
    );
    assert.equal((await readFile(f.journal, "utf8")).includes(TOKEN), false);
  } finally {
    child.child.kill("SIGKILL");
    // The synthetic child exits on its closed input; this wait is shorter than
    // its two-second self-closing guard and never touches another process.
    await delay(30);
    await rm(f.root, { recursive: true, force: true });
  }
});

test("PARITY RELAY: malformed UTF-8 stdout cannot become a transformed acknowledgement or a complete capture", {
  timeout: 20000,
}, async () => {
  const f = await fixture("invalid-utf8");
  const child = f.launch();
  try {
    await child.next();
    child.child.stdin.write(
      `${JSON.stringify(request("invalid-utf8-1", "search"))}\n`,
    );
    assert.equal((await child.closed)[0], 2);
    assert.equal(
      child.output.length,
      1,
      "The invalid response must not reach the client with replacement characters.",
    );
    const tape = (await readFile(f.tape, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      tape.map((event) => event.kind),
      ["ready", "request"],
    );
    assert.equal(
      tape.some((event) => event.kind === "response"),
      false,
    );
    const trace = readTrace(f.journal);
    assert.equal(trace.complete, false);
    assert.ok(trace.errors.includes("missing_completion"));
    assert.ok(
      trace.records.some(
        (event) =>
          event.kind === "protocol.request.start" &&
          (event.data as Packet).id === "invalid-utf8-1",
      ),
    );
    assert.equal(
      trace.records.some((event) => event.kind === "protocol.response"),
      false,
    );
    assert.equal((await readFile(f.journal, "utf8")).includes(TOKEN), false);
  } finally {
    child.child.kill("SIGTERM");
    await rm(f.root, { recursive: true, force: true });
  }
});

test("PARITY RELAY: a genuine UTF-8 replacement character survives exact recording and replay", {
  timeout: 20000,
}, async () => {
  const f = await fixture("valid-replacement");
  const child = f.launch();
  try {
    const ready = await child.next();
    const search = request("replacement-1", "search");
    const shutdown = request("replacement-2", "shutdown");
    const response = await child.send(search);
    assert.deepEqual(response.result, { durableStart: true, text: "\uFFFD" });
    const closed = await child.send(shutdown);
    assert.equal((await child.closed)[0], 0, child.stderr());
    const tapeText = await readFile(f.tape, "utf8");
    assert.ok(tapeText.includes("\uFFFD"));
    assert.equal(readTrace(f.journal).complete, true);
    const replayJournal = join(f.traces, "unicode-replay.jsonl");
    await writeFile(
      join(f.root, "relay.json"),
      JSON.stringify({
        ...f.config,
        mode: "replay",
        source: f.tape,
        traceJournal: replayJournal,
      }),
    );
    const replay = f.launch();
    assert.deepEqual(await replay.next(), ready);
    assert.deepEqual(await replay.send(search), response);
    assert.deepEqual(await replay.send(shutdown), closed);
    assert.equal((await replay.closed)[0], 0, replay.stderr());
    assert.equal(readTrace(replayJournal).complete, true);
    assert.equal(await readFile(f.tape, "utf8"), tapeText);
  } finally {
    child.child.kill("SIGTERM");
    await rm(f.root, { recursive: true, force: true });
  }
});

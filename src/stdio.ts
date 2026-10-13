import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Lab, PROJECT, VERSION, validId } from "./lab.ts";

const root = resolve(process.argv[2] ?? join(PROJECT, ".lab"));
const labs = new Map<string, Lab>();
const operations = new Set([
  "write",
  "write_daily",
  "configure_maintenance",
  "run_maintenance",
  "explain_promotion",
  "delete",
  "index",
  "search",
  "get",
  "status",
  "restart",
  "shutdown",
  "configure",
  "fixture",
  "session_history",
  "session_state",
  "session_reset",
  "dream_status",
  "dream_diary",
]);
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

function emit(value: unknown) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
function string(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Supply ${name} as a nonempty string.`);
  return value;
}
async function dispatch(
  op: string,
  workspace: string,
  args: Record<string, unknown>,
) {
  // Requests are sequential: keep only one workspace Gateway active, matching
  // the interactive shell and bounding the sidecar resource cost.
  for (const [name, other] of labs) if (name !== workspace) await other.stop();
  let lab = labs.get(workspace);
  if (!lab) {
    lab = await new Lab(workspace, root).init();
    labs.set(workspace, lab);
  }
  switch (op) {
    case "configure":
      if (typeof args.ingestion !== "boolean")
        throw new Error("Supply ingestion as a boolean.");
      return lab.configureIngestion(args.ingestion);
    case "fixture":
      return lab.injectFixture(
        string(args.session, "session"),
        string(args.text, "text"),
      );
    case "session_history":
      return lab.sessionHistory(string(args.session, "session"));
    case "session_state":
      return lab.sessionState(string(args.session, "session"));
    case "session_reset":
      return lab.resetSession(string(args.session, "session"));
    case "dream_status":
      return lab.dreamStatus();
    case "dream_diary":
      return lab.dreamDiary();
    case "configure_maintenance":
      return lab.configureMaintenance(
        Number(args.cumulativeLimitUsd),
        Number(args.hostReserveUsd),
      );
    case "run_maintenance":
      return lab.runMaintenance();
    case "explain_promotion":
      return lab.explain(string(args.selector, "selector"));
    case "write_daily":
      return lab.writeDaily(string(args.day, "day"), string(args.text, "text"));
    case "write":
      return lab.writeNote(
        string(args.noteId, "noteId"),
        string(args.text, "text"),
      );
    case "delete":
      return lab.deleteNote(string(args.noteId, "noteId"));
    case "index":
      return lab.index();
    case "search":
      return lab.search(
        string(args.query, "query"),
        args.session === undefined ? "main" : string(args.session, "session"),
      );
    case "get":
      return lab.get(
        string(args.path, "path"),
        args.from === undefined ? 1 : Number(args.from),
        args.lines === undefined ? 40 : Number(args.lines),
      );
    case "status":
      return lab.status();
    case "restart":
      return lab.restart();
    default:
      throw new Error("Unsupported operation.");
  }
}

async function main() {
  emit({
    v: 1,
    event: "ready",
    engine: { name: "openclaw", version: VERSION },
    pid: process.pid,
  });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let id: string | null = null;
      let request: {
        op: string;
        workspace: string;
        args: Record<string, unknown>;
      };
      try {
        if (Buffer.byteLength(line) > 128000)
          throw new Error("Request exceeds 128 KB.");
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("Supply a JSON object.");
        const value = parsed as Record<string, unknown>;
        if (typeof value.id === "string" && value.id.length <= 128)
          id = value.id;
        if (value.v !== 1 || !id)
          throw new Error(
            "Supply protocol v: 1 and a nonempty string id, at most 128 characters.",
          );
        const op = string(value.op, "op");
        if (!operations.has(op)) throw new Error("Unsupported operation.");
        const workspace = validId(
          value.workspace === undefined
            ? "alpha"
            : string(value.workspace, "workspace"),
        );
        const args = value.args === undefined ? {} : value.args;
        if (!args || typeof args !== "object" || Array.isArray(args))
          throw new Error("args must be an object.");
        request = { op, workspace, args: args as Record<string, unknown> };
      } catch (error) {
        emit({
          v: 1,
          id,
          ok: false,
          error: { code: "invalid_request", message: (error as Error).message },
        });
        continue;
      }
      try {
        if (request.op === "shutdown") {
          await Lab.closeAll();
          emit({ v: 1, id, ok: true, result: { closed: true } });
          break;
        }
        const result = await dispatch(
          request.op,
          request.workspace,
          request.args,
        );
        emit({ v: 1, id, ok: true, result });
      } catch (error) {
        emit({
          v: 1,
          id,
          ok: false,
          error: { code: "engine_error", message: (error as Error).message },
        });
      }
    }
  } finally {
    rl.close();
    await Lab.closeAll();
  }
}

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  rl.close();
  await Lab.closeAll();
  process.exit(130);
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
main().catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

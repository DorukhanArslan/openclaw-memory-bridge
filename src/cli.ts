import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { Lab, validId } from "./lab.ts";

const help = `OpenClaw memory foundation — synthetic data only
  npm start                          interactive lab (workspace alpha)
  npm run demo                       real write/index/search/get/restart example
  npm run lab -- note WS ID TEXT      add or replace a synthetic Markdown note
  npm run lab -- daily WS DATE TEXT   write a synthetic YYYY-MM-DD daily note
  npm run lab -- delete WS ID         delete note (then index)
  npm run lab -- list WS              list lab note files
  npm run lab -- index WS             native forced index
  npm run lab -- search WS QUERY      native memory_search via private Gateway
  npm run lab -- get WS PATH [FROM] [LINES]  native memory_get
  npm run lab -- status WS            native memory status JSON
  npm run lab -- keyword WS           select no-key keyword mode and rebuild
  npm run lab -- vector WS URL MODEL  select a local embeddings server and rebuild
  npm run lab -- restart WS           restart and verify native memory tool readiness
  npm run lab -- dream-demo           repeatable native REM/deep demonstration
  npm run lab -- rem-preview WS       native grounded REM harness (preview)
  npm run lab -- rem-stage WS         native grounded backfill and short-term staging
  npm run lab -- promote WS [apply]   native deep promotion, default thresholds
  npm run lab -- promote-test WS [apply] native promotion with explicit zero test thresholds
  npm run lab -- explain WS SELECTOR  native promotion score/provenance explanation
  npm run lab -- dream-run WS         run and wait for native light→REM→deep sweep
  npm run lab -- dream-status WS      native phase, evidence and cron status
  npm run lab -- diary WS             native Dream Diary read
  npm run lab -- dream-off WS         disable lab dreaming
  npm run lab -- model WS URL MODEL   select an explicit local text completion model
  npm run lab -- native-model WS PROVIDER/MODEL KEY_ENV  native provider + env SecretRef; config only
  npm run lab -- native-vector WS URL MODEL KEY_ENV     native compatible embeddings; config only
  npm run lab -- validate-config WS   native schema validation; no model request
  npm run lab -- ingestion WS on|off  native reset-to-memory hook (no model needed)
  npm run lab -- session-fixture WS SESSION TEXT  native synthetic transcript injection
  npm run lab -- session-history WS SESSION  native chat history in this lab only
  npm run lab -- session-state WS SESSION    native stored session metadata
  npm run lab -- session-reset WS SESSION [new] capture via hook, await artifact, index
  npm run lab -- chat WS SESSION TEXT  real selected-model agent turn; wait for completion
  npm run lab -- flush-config WS normal|test|off  native automatic flush configuration
  npm run lab -- compact WS SESSION [test] native model summarization (does not force flush)
  npm run lab -- lifecycle-demo       no-key native session hook/recall/restart example
  npm run lab -- help
Shell: use NAME, note ID TEXT, delete ID, index, search QUERY, get PATH,
       status, list, restart, keyword, vector URL MODEL, help, exit.
Lifecycle shell: ingestion on, session-fixture SESSION TEXT,
       session-reset SESSION [new], session-history SESSION, session-state SESSION,
       model URL ID, native-model PROVIDER/MODEL KEY_ENV, native-vector URL MODEL KEY_ENV,
       validate-config, chat SESSION TEXT, flush-config normal|test|off, compact SESSION.
This is a terminal interface: there is no browser UI or public/local UI URL.
Paid operations require explicit finite approval; see README.md#limits-and-checks.
The shell starts OpenClaw on demand; index/status stop it before running its CLI.
Notebooks are persisted in .lab/WS/workspace/memory. Notes are application writes;
search, source reads, indexing and SQLite persistence are native OpenClaw.`;

function print(value: unknown) {
  console.log(
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );
}

async function action(lab: Lab, command: string, args: string[]) {
  switch (command) {
    case "note":
      return lab.writeNote(args[0] ?? "", args.slice(1).join(" "));
    case "daily":
      return lab.writeDaily(args[0] ?? "", args.slice(1).join(" "));
    case "delete":
      return lab.deleteNote(args[0] ?? "");
    case "list":
      return lab.listNotes();
    case "index":
      return lab.index();
    case "search":
      return lab.search(args.join(" "));
    case "get":
      return lab.get(
        args[0] ?? "",
        Number(args[1] ?? 1),
        Number(args[2] ?? 40),
      );
    case "status":
      return lab.status();
    case "keyword":
      return lab.configureKeyword();
    case "vector":
      return lab.configureVector(args[0] ?? "", args[1] ?? "");
    case "restart":
      return lab.restart();
    case "rem-preview":
      return lab.remPreview();
    case "rem-stage":
      return lab.remStage();
    case "promote":
      return lab.promote(args[0] === "apply");
    case "promote-test":
      return lab.promote(args[0] === "apply", true);
    case "explain":
      return lab.explain(args.join(" "));
    case "dream-run":
      return lab.dreamRun();
    case "dream-status":
      return lab.dreamStatus();
    case "diary":
      return lab.dreamDiary();
    case "dream-off":
      return lab.dreamOff();
    case "model":
      return lab.configureTextModel(args[0] ?? "", args[1] ?? "");
    case "native-model":
      return lab.configureNativeModel(args[0] ?? "", args[1] ?? "");
    case "native-vector":
      return lab.configureNativeVector(
        args[0] ?? "",
        args[1] ?? "",
        args[2] ?? "",
      );
    case "validate-config":
      return lab.validateConfig();
    case "ingestion":
      if (!["on", "off"].includes(args[0] ?? ""))
        throw new Error("Use ingestion on|off.");
      return lab.configureIngestion(args[0] === "on");
    case "session-fixture":
      return lab.injectFixture(args[0] ?? "", args.slice(1).join(" "));
    case "session-history":
      return lab.sessionHistory(args[0] ?? "");
    case "session-state":
      return lab.sessionState(args[0] ?? "");
    case "session-reset":
      return lab.resetSession(
        args[0] ?? "",
        args[1] === "new" ? "new" : "reset",
      );
    case "chat":
      return lab.chat(args[0] ?? "", args.slice(1).join(" "));
    case "flush-config": {
      const mode = args[0];
      if (mode !== "normal" && mode !== "test" && mode !== "off")
        throw new Error("Use flush-config normal|test|off.");
      return lab.configureFlush(mode);
    }
    case "compact":
      return lab.compactSession(args[0] ?? "", args[1] === "test");
    default:
      throw new Error(`Unknown command: ${command}. Run help.`);
  }
}

async function demo() {
  const lab = await new Lab("demo").init();
  try {
    print(
      await lab.writeNote(
        "observatory",
        "# Synthetic observatory\nProject Aurora uses cobalt telescopes. Its rehearsal is Tuesday at 14:00 UTC.",
      ),
    );
    print(await lab.index());
    print(await lab.search("cobalt", "session-one"));
    print(await lab.get("memory/observatory.md"));
    print(await lab.restart());
    print(await lab.search("cobalt", "session-two"));
  } finally {
    await lab.close();
  }
}

async function shell() {
  const rl = createInterface({ input: stdin, output: stdout });
  let lab = await new Lab("alpha").init();
  print(help);
  try {
    for (;;) {
      let line: string;
      try {
        line = await rl.question(`${lab.name}> `);
      } catch {
        break;
      }
      const [command, ...args] = line.trim().split(/\s+/);
      if (!command) continue;
      if (["exit", "quit"].includes(command)) break;
      try {
        if (command === "help") print(help);
        else if (command === "use") {
          const name = validId(args[0] ?? "");
          if (name === lab.name) continue;
          const next = await new Lab(name).init();
          await lab.close();
          lab = next;
          print(`Workspace: ${lab.name}`);
        } else print(await action(lab, command, args));
      } catch (error) {
        console.error((error as Error).message);
      }
    }
  } finally {
    rl.close();
    await lab.close();
  }
}

async function main() {
  const [command = "shell", workspace = "alpha", ...args] =
    process.argv.slice(2);
  if (command === "help" || command === "--help") return print(help);
  if (command === "demo") return demo();
  if (command === "dream-demo") {
    const { dreamDemo } = await import("./dream-demo.ts");
    return print(await dreamDemo());
  }
  if (command === "lifecycle-demo") {
    const { lifecycleDemo } = await import("./lifecycle-demo.ts");
    return print(await lifecycleDemo());
  }
  if (command === "shell") return shell();
  const lab = await new Lab(workspace).init();
  try {
    print(await action(lab, command, args));
  } finally {
    await lab.close();
  }
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await Lab.closeAll();
  process.exit(130);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
main().catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});

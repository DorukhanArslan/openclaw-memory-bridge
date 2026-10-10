import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  appendFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const PROJECT = fileURLToPath(new URL("../", import.meta.url));
const ENTRY = resolve(
  dirname(fileURLToPath(import.meta.resolve("openclaw"))),
  "../openclaw.mjs",
);
export const VERSION = "2026.9.9";

export function validId(value: string): string {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(value)) {
    throw new Error(
      "Use an ID of 1–48 lowercase letters, digits or hyphens, starting with a letter.",
    );
  }
  return value;
}

export function localEndpoint(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Models must use an http://127.0.0.1 or http://[::1] endpoint without credentials, query or fragment.",
    );
  }
  return url.href;
}

export type SearchResult = {
  results: Array<{
    path: string;
    startLine: number;
    endLine: number;
    score: number;
    snippet: string;
    source: string;
  }>;
  provider?: string;
  model?: string;
  mode?: string;
  disabled?: boolean;
  unavailable?: boolean;
  error?: string;
  warning?: string;
  [key: string]: unknown;
};
type Settings = (
  | { provider: "none" }
  | { provider: "openai-compatible"; model: string; baseUrl: string }
) & {
  dreaming?: boolean;
  textModel?: { baseUrl: string; model: string };
  sessionMemory?: boolean;
  flush?: "normal" | "test";
};

async function safeDir(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`Refusing non-directory/symlink: ${path}`);
}
async function noSymlink(path: string) {
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new Error(`Refusing symlink: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
async function freePort(): Promise<number> {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  if (!address || typeof address === "string")
    throw new Error("No loopback port available");
  const port = address.port;
  await new Promise<void>((done, reject) =>
    listener.close((error) => (error ? reject(error) : done())),
  );
  return port;
}

/** App adapter: supervises native OpenClaw; never opens or edits its SQLite state. */
export class Lab {
  private static active = new Set<Lab>();
  static async closeAll() {
    await Promise.all([...Lab.active].map((lab) => lab.close()));
  }
  readonly root: string;
  readonly name: string;
  readonly directory: string;
  readonly notes: string;
  readonly state: string;
  readonly home: string;
  readonly config: string;
  private child?: ChildProcess;
  private childDone?: Promise<void>;
  private token = "";
  private port = 0;
  private locked = false;
  private settings: Settings = { provider: "none" };
  private logTail = "";
  private closing?: Promise<void>;
  private commands = new Map<ChildProcess, Promise<void>>();
  private compactionTest = false;

  constructor(name = "alpha", root = join(PROJECT, ".lab")) {
    this.root = resolve(root);
    this.name = validId(name);
    this.directory = join(this.root, name);
    this.notes = join(this.directory, "workspace", "memory");
    this.state = join(this.directory, "state");
    this.home = join(this.directory, "home");
    this.config = join(this.directory, "openclaw.json");
  }

  async init() {
    await safeDir(this.root);
    await safeDir(this.directory);
    const lockPath = join(this.directory, "lab.lock");
    await noSymlink(lockPath);
    // A lock prevents two lab hosts from writing the same workspace at once.
    const lock = await open(lockPath, "wx", 0o600).catch(() => {
      throw new Error(
        `Workspace ${this.name} is locked. Close its other lab process. If it crashed, remove ${lockPath} after verifying no lab is running.`,
      );
    });
    this.locked = true;
    Lab.active.add(this);
    await lock.writeFile(String(process.pid));
    await lock.close();
    try {
      for (const path of [
        join(this.directory, "workspace"),
        this.notes,
        this.state,
        this.home,
        join(this.directory, "tmp"),
      ])
        await safeDir(path);
      const settingsPath = join(this.directory, "settings.json");
      await noSymlink(settingsPath);
      try {
        const settings = JSON.parse(
          await readFile(settingsPath, "utf8"),
        ) as Settings;
        if (settings.textModel) localEndpoint(settings.textModel.baseUrl);
        if (
          settings.provider === "openai-compatible" &&
          typeof settings.model === "string" &&
          settings.model.trim()
        ) {
          this.settings = {
            ...settings,
            baseUrl: localEndpoint(settings.baseUrl),
          };
        } else if (settings.provider === "none") this.settings = settings;
        else
          throw new Error(
            "Invalid lab settings; only keyword or explicitly configured local embeddings are supported.",
          );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await this.provision();
      return this;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private env(): NodeJS.ProcessEnv {
    // Deliberately do not inherit process.env, API keys, proxies, .env or personal HOME.
    return {
      PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: this.home,
      TMPDIR: join(this.directory, "tmp"),
      LANG: "en_US.UTF-8",
      OPENCLAW_HOME: this.home,
      OPENCLAW_STATE_DIR: this.state,
      OPENCLAW_CONFIG_PATH: this.config,
      OPENCLAW_GATEWAY_TOKEN: this.token,
      OPENCLAW_DISABLE_BONJOUR: "1",
      OPENCLAW_EXEC_SHELL_SNAPSHOT: "0",
      OPENCLAW_NO_RESPAWN: "1",
      OPENCLAW_SKIP_CHANNELS: "1",
      OPENCLAW_NO_AUTO_UPDATE: "1",
    };
  }

  private async provision() {
    await noSymlink(this.config);
    const search =
      this.settings.provider === "none"
        ? { provider: "none", sources: ["memory"], fallback: "none" }
        : {
            provider: "openai-compatible",
            model: this.settings.model,
            remote: {
              baseUrl: this.settings.baseUrl,
              apiKey: "local-lab-placeholder",
            },
            sources: ["memory"],
            fallback: "none",
          };
    await writeFile(
      this.config,
      JSON.stringify(
        {
          gateway: {
            mode: "local",
            port: this.port || 18789,
            bind: "loopback",
            auth: { mode: "token" },
            controlUi: { enabled: false },
            tailscale: { mode: "off" },
            tools: { deny: ["read", "write", "edit"] },
          },
          agents: {
            defaults: {
              skipBootstrap: true,
              userTimezone: "UTC",
              heartbeat: { every: "0m" },
              compaction: {
                postIndexSync: "await",
                ...(this.compactionTest
                  ? { keepRecentTokens: 512, recentTurnsPreserve: 1 }
                  : {}),
                ...(this.settings.textModel
                  ? { model: `lab/${this.settings.textModel.model}` }
                  : {}),
                memoryFlush: {
                  enabled: Boolean(
                    this.settings.flush && this.settings.textModel,
                  ),
                  ...(this.settings.textModel
                    ? { model: `lab/${this.settings.textModel.model}` }
                    : {}),
                  softThresholdTokens: 4000,
                  forceFlushTranscriptBytes:
                    this.settings.flush === "test" ? 1024 : "2mb",
                },
              },
              ...(this.settings.textModel
                ? {
                    model: {
                      primary: `lab/${this.settings.textModel.model}`,
                      fallbacks: [],
                    },
                  }
                : {}),
            },
            entries: {
              main: {
                workspace: join(this.directory, "workspace"),
                skills: [],
              },
            },
          },
          ...(this.settings.textModel
            ? {
                models: {
                  providers: {
                    lab: {
                      api: "openai-completions",
                      baseUrl: this.settings.textModel.baseUrl,
                      apiKey: "local-lab-placeholder",
                      models: [
                        {
                          id: this.settings.textModel.model,
                          name: this.settings.textModel.model,
                        },
                      ],
                    },
                  },
                },
              }
            : {}),
          plugins: {
            entries: {
              "memory-core": {
                config: {
                  dreaming: {
                    enabled: this.settings.dreaming ?? false,
                    frequency: "0 0 1 1 *",
                    timezone: "UTC",
                  },
                },
              },
            },
          },
          hooks: {
            internal: {
              enabled: this.settings.sessionMemory ?? false,
              entries: {
                "session-memory": {
                  enabled: this.settings.sessionMemory ?? false,
                  messages: 25,
                  llmSlug: false,
                },
              },
            },
          },
          memory: {
            search: {
              ...search,
              rememberAcrossConversations: false,
              query: { minScore: 0 },
            },
          },
          tools: {
            fs: { workspaceOnly: true },
            allow: [
              "memory_search",
              "memory_get",
              ...(this.settings.flush ? ["read", "write", "edit"] : []),
            ],
          },
          browser: { enabled: false },
          update: { checkOnStart: false, auto: { enabled: false } },
          telemetry: { enabled: false },
          logging: {
            file: join(this.directory, "openclaw.log"),
            consoleLevel: "error",
          },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }

  async writeNote(id: string, text: string) {
    validId(id);
    return this.writeSource(id, text);
  }
  async writeDaily(day: string, text: string) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day
    )
      throw new Error("Supply a valid YYYY-MM-DD date.");
    return this.writeSource(day, text);
  }
  private async writeSource(id: string, text: string) {
    if (!text.trim() || Buffer.byteLength(text) > 64000)
      throw new Error("Supply a nonempty synthetic note, at most 64 KB.");
    await safeDir(this.notes);
    const target = join(this.notes, `${id}.md`);
    await noSymlink(target);
    const temporary = join(
      this.notes,
      `.${id}-${randomBytes(6).toString("hex")}.tmp`,
    );
    await writeFile(temporary, text.endsWith("\n") ? text : `${text}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, target);
    return {
      adapter: "Markdown write",
      path: `memory/${id}.md`,
      needsIndex: true,
    };
  }

  async deleteNote(id: string) {
    const target = join(this.notes, `${validId(id)}.md`);
    await safeDir(this.notes);
    await noSymlink(target);
    await rm(target); // No force: missing notes are reported, never presented as deleted.
    return {
      adapter: "Markdown deletion",
      path: `memory/${id}.md`,
      needsIndex: true,
    };
  }

  async listNotes() {
    await safeDir(this.notes);
    return (await readdir(this.notes))
      .filter((path) => path.endsWith(".md"))
      .sort();
  }

  private async native(args: string[], timeout = 120000): Promise<string> {
    const child = spawn(process.execPath, [ENTRY, ...args], {
      env: this.env(),
      cwd: this.directory,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const done = new Promise<void>((finish) =>
      child.once("close", () => finish()),
    );
    this.commands.set(child, done);
    let output = "";
    child.stdout.on("data", (data: Buffer) => {
      output = (output + data.toString()).slice(-100000);
    });
    child.stderr.on("data", (data: Buffer) => {
      output = (output + data.toString()).slice(-100000);
    });
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 10000);
    }, timeout);
    try {
      const [code, signal] = await once(child, "exit");
      if (code !== 0)
        throw new Error(
          `OpenClaw ${args.join(" ")} failed (${code ?? signal}):\n${output}`,
        );
      return output.trim();
    } finally {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      this.commands.delete(child);
    }
  }

  async index() {
    await this.stop(); // Let the official CLI own state exclusively while indexing.
    return this.native(["memory", "index", "--force", "--agent", "main"]);
  }

  async status() {
    await this.stop();
    const raw = await this.native([
      "memory",
      "status",
      "--agent",
      "main",
      "--json",
    ]);
    return JSON.parse(raw) as unknown;
  }

  async configureVector(url: string, model: string) {
    if (!model.trim() || model.length > 200)
      throw new Error("Supply the installed local embedding model name.");
    await this.stop();
    this.settings = {
      ...this.settings,
      provider: "openai-compatible",
      baseUrl: localEndpoint(url),
      model,
    };
    await this.saveSettings();
    return this.index();
  }
  async configureKeyword() {
    await this.stop();
    this.settings = {
      provider: "none",
      dreaming: this.settings.dreaming,
      textModel: this.settings.textModel,
      sessionMemory: this.settings.sessionMemory,
      flush: this.settings.flush,
    };
    await this.saveSettings();
    return this.index();
  }
  private async saveSettings() {
    const path = join(this.directory, "settings.json");
    await noSymlink(path);
    await writeFile(path, JSON.stringify(this.settings, null, 2), {
      mode: 0o600,
    });
    await this.provision();
  }

  async configureTextModel(url: string, model: string) {
    if (!model.trim() || model.length > 200)
      throw new Error("Supply the local text model name.");
    await this.stop();
    this.settings.textModel = { baseUrl: localEndpoint(url), model };
    await this.saveSettings();
    return {
      configured: `lab/${model}`,
      baseUrl: localEndpoint(url),
      requires:
        "A running local OpenAI-compatible chat completion server; no credentials are inherited.",
    };
  }

  async configureIngestion(enabled: boolean) {
    await this.stop();
    this.settings.sessionMemory = enabled;
    await this.saveSettings();
    return {
      sessionMemory: enabled,
      native:
        "Bundled session-memory hook; filtered excerpts on new/reset/automatic rollover",
      llmSlug: false,
      transcriptSearch: false,
    };
  }

  async configureFlush(mode: "normal" | "test" | "off") {
    if (mode !== "off" && !this.settings.textModel)
      throw new Error(
        "First select a running local tool-capable text model with model URL ID. No provider is inferred.",
      );
    await this.stop();
    this.settings.flush = mode === "off" ? undefined : mode;
    await this.saveSettings();
    return {
      memoryFlush: mode,
      model: this.settings.textModel
        ? `lab/${this.settings.textModel.model}`
        : null,
      forceFlushTranscriptBytes: mode === "test" ? 1024 : "2mb",
      trigger:
        "Native embedded-agent turn admission/post-reply; once per compaction cycle",
      requirement:
        "Native successful memoryFlush state AND actual durable note content; configuration alone is not acceptance.",
    };
  }

  private sessionKey(session: string) {
    return `agent:main:${validId(session)}`;
  }

  async createSession(session: string) {
    return this.rpc("sessions.create", {
      key: this.sessionKey(session),
      agentId: "main",
      ...(this.settings.textModel
        ? { model: `lab/${this.settings.textModel.model}` }
        : {}),
    });
  }

  /** Explicit transcript fixture through a native RPC; never claims a model reply. */
  async injectFixture(session: string, text: string) {
    if (!text.trim() || Buffer.byteLength(text) > 64000)
      throw new Error("Supply nonempty synthetic fixture text, at most 64 KB.");
    const created = await this.createSession(session);
    const injected = await this.rpc("chat.inject", {
      sessionKey: this.sessionKey(session),
      agentId: "main",
      message: text,
      label: "Synthetic operator fixture (not a model response)",
    });
    return {
      adapter: "Native transcript fixture",
      created,
      injected,
      modelExecuted: false,
    };
  }

  async sessionHistory(session: string) {
    return this.rpc("chat.history", {
      sessionKey: this.sessionKey(session),
      agentId: "main",
      limit: 50,
    });
  }

  async sessionState(session: string) {
    const description = (await this.rpc("sessions.describe", {
      key: this.sessionKey(session),
      agentId: "main",
    })) as { session: { sessionId?: string } | null };
    if (!description.session?.sessionId)
      throw new Error(
        "Create a fixture or chat session before inspecting native state.",
      );
    // This version exposes persisted maintenance metadata in the public create/adopt
    // response, but not the display-only describe projection. Adopt only an existing
    // explicit key, with no model, task, parent, reset or command-hook options.
    const adopted = (await this.rpc("sessions.create", {
      key: this.sessionKey(session),
      agentId: "main",
    })) as {
      sessionId?: string;
      entry?: { compactionCount?: number; memoryFlush?: unknown };
    };
    if (adopted.sessionId !== description.session.sessionId)
      throw new Error(
        "Native session identity changed during metadata inspection.",
      );
    return {
      ...description,
      nativeMaintenance: {
        source: "Public sessions.create adoption response; no transcript reset",
        compactionCount: adopted.entry?.compactionCount ?? 0,
        memoryFlush: adopted.entry?.memoryFlush ?? null,
      },
    };
  }

  async resetSession(session: string, reason: "new" | "reset" = "reset") {
    if (!this.settings.sessionMemory)
      throw new Error(
        "Enable ingestion on before testing native reset-to-memory capture.",
      );
    const beforeFiles = new Set(await this.listNotes());
    const before = (await this.rpc("sessions.describe", {
      key: this.sessionKey(session),
      agentId: "main",
    })) as { sessionId?: string; session?: { sessionId?: string } };
    const sessionId = before.sessionId ?? before.session?.sessionId;
    if (!sessionId)
      throw new Error(
        "Native session description has no session ID; create a fixture or chat session first.",
      );
    const reset = await this.rpc("sessions.reset", {
      key: this.sessionKey(session),
      agentId: "main",
      reason,
      expectedSessionId: sessionId,
    });
    // The native hook is asynchronous. Observe its canonical Markdown artifact, never manufacture one.
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      for (const file of await this.listNotes()) {
        if (
          beforeFiles.has(file) ||
          !/^\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?\.md$/.test(file)
        )
          continue;
        const path = join(this.notes, file);
        await noSymlink(path);
        const content = await readFile(path, "utf8");
        if (
          content.includes(`- **Session ID**: ${sessionId}`) &&
          content.includes(`- **Session Key**: ${this.sessionKey(session)}`)
        ) {
          const index = await this.index();
          return {
            reset,
            captured: `memory/${file}`,
            content,
            index,
            native: "session-memory hook",
            modelSummary: false,
          };
        }
      }
      await delay(250);
    }
    throw new Error(
      "Reset completed, but the native session-memory artifact was not observed within 20 seconds. Capture is not accepted.",
    );
  }

  async chat(session: string, text: string) {
    if (!this.settings.textModel)
      throw new Error(
        "Select a local text model with model URL ID before real chat execution.",
      );
    if (!text.trim() || Buffer.byteLength(text) > 64000)
      throw new Error("Supply a synthetic chat turn, at most 64 KB.");
    await this.createSession(session);
    const accepted = (await this.rpc("chat.send", {
      sessionKey: this.sessionKey(session),
      agentId: "main",
      message: text,
      idempotencyKey: randomBytes(16).toString("hex"),
      deliver: false,
      thinking: "off",
      timeoutMs: 180000,
    })) as { runId?: string };
    if (!accepted.runId)
      throw new Error(`Native chat had no run ID: ${JSON.stringify(accepted)}`);
    const deadline = Date.now() + 200000;
    while (Date.now() < deadline) {
      const completion = (await this.rpc("agent.wait", {
        runId: accepted.runId,
        timeoutMs: 10000,
      })) as { status?: string };
      if (completion.status === "timeout" || completion.status === "pending")
        continue;
      if (completion.status !== "ok")
        throw new Error(
          `Native agent did not succeed: ${JSON.stringify(completion)}`,
        );
      return {
        accepted,
        completion,
        history: await this.sessionHistory(session),
        state: await this.sessionState(session),
      };
    }
    await this.rpc("chat.abort", {
      sessionKey: this.sessionKey(session),
      agentId: "main",
      runId: accepted.runId,
    });
    throw new Error(
      "Native agent completion timed out; the exact run was aborted.",
    );
  }

  async compactSession(session: string, testRetention = false) {
    if (!this.settings.textModel)
      throw new Error(
        "Native summarizing compaction requires a selected local text model.",
      );
    if (testRetention) {
      await this.stop();
      this.compactionTest = true;
    }
    try {
      return {
        testRetention: testRetention
          ? { keepRecentTokens: 512, recentTurnsPreserve: 1 }
          : null,
        native: await this.rpc(
          "sessions.compact",
          { key: this.sessionKey(session), agentId: "main" },
          200000,
        ),
        memoryFlush:
          "Manual compaction RPC does not execute the automatic memory-flush path in this release; use flush-config + real chat turns.",
        state: await this.sessionState(session),
      };
    } finally {
      if (testRetention) {
        await this.stop();
        this.compactionTest = false;
        await this.provision();
      }
    }
  }

  async remPreview() {
    await this.stop();
    return JSON.parse(
      await this.native([
        "memory",
        "rem-harness",
        "--agent",
        "main",
        "--path",
        this.notes,
        "--grounded",
        "--json",
      ]),
    ) as unknown;
  }
  async remStage() {
    await this.stop();
    return JSON.parse(
      await this.native([
        "memory",
        "rem-backfill",
        "--agent",
        "main",
        "--path",
        this.notes,
        "--stage-short-term",
        "--json",
      ]),
    ) as unknown;
  }
  async promote(apply = false, testThresholds = false) {
    await this.stop();
    return JSON.parse(
      await this.native([
        "memory",
        "promote",
        "--agent",
        "main",
        "--json",
        ...(apply ? ["--apply"] : []),
        ...(testThresholds
          ? [
              "--min-score",
              "0",
              "--min-recall-count",
              "0",
              "--min-unique-queries",
              "0",
            ]
          : []),
      ]),
    ) as unknown;
  }
  async explain(selector: string) {
    if (!selector.trim())
      throw new Error("Supply a candidate text or source selector.");
    await this.stop();
    return JSON.parse(
      await this.native([
        "memory",
        "promote-explain",
        selector,
        "--agent",
        "main",
        "--include-promoted",
        "--json",
      ]),
    ) as unknown;
  }

  private async rpc(
    method: string,
    params: Record<string, unknown> = {},
    timeout = 30000,
  ) {
    await this.start();
    return JSON.parse(
      await this.native(
        [
          "gateway",
          "call",
          method,
          "--params",
          JSON.stringify(params),
          "--json",
          "--timeout",
          String(timeout),
        ],
        timeout + 20000,
      ),
    ) as unknown;
  }
  async dreamStatus() {
    return this.rpc("doctor.memory.status", { agentId: "main" });
  }
  async dreamDiary() {
    return this.rpc("doctor.memory.dreamDiary", { agentId: "main" });
  }
  async dreamOff() {
    await this.stop();
    this.settings.dreaming = false;
    await this.saveSettings();
    return { dreaming: false };
  }
  async dreamRun() {
    await this.stop();
    this.settings.dreaming = true;
    await this.saveSettings();
    await this.start();
    let job: { id: string; declarationKey?: string } | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
      const list = JSON.parse(
        await this.native(["cron", "list", "--json"]),
      ) as { jobs: Array<{ id: string; declarationKey?: string }> };
      job = list.jobs.find(
        (candidate) =>
          candidate.declarationKey === "memory-core:memory-dreaming-promotion",
      );
      if (job) break;
      await delay(300);
    }
    if (!job)
      throw new Error(
        "Native memory-core did not register its managed dreaming sweep.",
      );
    // Native cron --wait polls the runId: enqueueing alone is never treated as completion.
    return JSON.parse(
      await this.native(
        ["cron", "run", job.id, "--wait", "--wait-timeout", "180000", "--json"],
        210000,
      ),
    ) as unknown;
  }

  private async invoke(
    tool: "memory_search" | "memory_get",
    args: Record<string, unknown>,
    session = "main",
  ) {
    validId(session);
    const response = await fetch(`http://127.0.0.1:${this.port}/tools/invoke`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        tool,
        args,
        agentId: "main",
        sessionKey: `agent:main:${session}`,
      }),
      signal: AbortSignal.timeout(40000),
    });
    const body = (await response.json()) as {
      ok: boolean;
      result?: {
        details?: unknown;
        content?: Array<{ type: string; text?: string }>;
      };
      error?: { message: string };
    };
    if (!response.ok || !body.ok || !body.result)
      throw new Error(
        `Gateway tool ${tool} failed (${response.status}): ${body.error?.message ?? JSON.stringify(body)}`,
      );
    if (body.result.details !== undefined) return body.result.details;
    const text = body.result.content?.find(
      (part) => part.type === "text",
    )?.text;
    if (!text)
      throw new Error("OpenClaw returned no structured/text tool result");
    return JSON.parse(text) as unknown;
  }

  async start() {
    if (this.child) return;
    this.port = await freePort();
    this.token = randomBytes(32).toString("hex");
    await this.provision();
    this.logTail = "";
    const child = spawn(
      process.execPath,
      [ENTRY, "gateway", "--port", String(this.port), "--bind", "loopback"],
      {
        env: this.env(),
        cwd: this.directory,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.child = child;
    this.childDone = new Promise<void>((done) =>
      child.once("close", () => done()),
    );
    let spawnError: Error | undefined;
    child.once("error", (error) => {
      spawnError = error;
    });
    const consume = (data: Buffer) => {
      this.logTail = (this.logTail + data.toString()).slice(-12000);
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    // Readiness is a successful authenticated native memory tool call, not a log match.
    const deadline = Date.now() + 60000;
    try {
      while (Date.now() < deadline) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error(
            `Gateway exited (${child.exitCode ?? child.signalCode}): ${this.logTail}`,
          );
        try {
          const result = (await this.invoke("memory_search", {
            query: "foundationreadinessprobe",
            maxResults: 1,
          })) as SearchResult;
          if (
            result.disabled ||
            result.unavailable ||
            result.error ||
            !Array.isArray(result.results)
          )
            throw new Error(`Memory not ready: ${JSON.stringify(result)}`);
          return;
        } catch (error) {
          if (Date.now() + 300 >= deadline) throw error;
          await delay(300);
        }
      }
      throw new Error("Gateway readiness timed out");
    } catch (error) {
      await this.stop();
      throw new Error(
        `${(error as Error).message}\nGateway diagnostics: ${this.logTail}`,
      );
    }
  }

  async search(query: string, session = "main"): Promise<SearchResult> {
    if (!query.trim()) throw new Error("Supply a search query.");
    await this.start();
    const result = (await this.invoke(
      "memory_search",
      { query, maxResults: 8, minScore: 0 },
      session,
    )) as SearchResult;
    if (
      result.disabled ||
      result.unavailable ||
      result.error ||
      !Array.isArray(result.results)
    )
      throw new Error(`Memory search unavailable: ${JSON.stringify(result)}`);
    return result;
  }

  async get(path: string, from = 1, lines = 40) {
    if (
      !/^(MEMORY\.md|DREAMS\.md|memory\/(?:[a-z][a-z0-9-]{0,47}|\d{4}-\d{2}-\d{2}(?:-\d{4}(?:-\d+)?)?|dreaming\/(?:light|rem|deep)\/\d{4}-\d{2}-\d{2})\.md)$/.test(
        path,
      )
    )
      throw new Error(
        "Read a lab note, daily note, native dreaming phase report, MEMORY.md or DREAMS.md path.",
      );
    if (
      !Number.isInteger(from) ||
      from < 1 ||
      !Number.isInteger(lines) ||
      lines < 1 ||
      lines > 200
    )
      throw new Error("Use positive line numbers and 1–200 lines.");
    await this.start();
    return this.invoke("memory_get", { path, from, lines });
  }

  async restart() {
    await this.stop();
    await this.start();
    return { restarted: true, runtime: `OpenClaw ${VERSION}` };
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
      try {
        await this.childDone;
      } finally {
        clearTimeout(timer);
      }
    }
    this.child = undefined;
    this.childDone = undefined;
    this.token = "";
    this.port = 0;
  }

  close(): Promise<void> {
    this.closing ??= this.closeOwned();
    return this.closing;
  }

  private async closeOwned() {
    Lab.active.delete(this);
    await Promise.all(
      [...this.commands].map(async ([child, done]) => {
        child.kill("SIGTERM");
        const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
        try {
          await done;
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    await this.stop();
    if (this.locked) {
      await appendFile(
        join(this.directory, "host.log"),
        `${new Date().toISOString()} lab host closed\n`,
      );
      await rm(join(this.directory, "lab.lock"));
      this.locked = false;
    }
  }
}

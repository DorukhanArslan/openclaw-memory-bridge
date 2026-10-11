import "./load-env.ts";
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
import {
  assertGatewayAllowed,
  assertNativeOperationAllowed,
  PAID_SELECTION,
} from "./budget-preflight.ts";
import { consolidationCheckpoint } from "./consolidation-checkpoint.ts";
import { ReadyGateway } from "./gateway.ts";
import {
  CONSOLIDATION_LIMITS,
  LIFECYCLE_LIMITS,
  readLifecycleLedger,
} from "./lifecycle-request-budget.ts";
import {
  confirmSmoke,
  fixtureEndpoint,
  SMOKE,
  type SmokeConfirmations,
  type SmokeFixture,
  smokeBudget,
  verifySmokeRuntime,
} from "./paid-smoke.ts";
import { requireEnvironment } from "./project-env.ts";
import {
  credentialEnv,
  forwardCredentials,
  nativeModel,
  providerEndpoint,
  redactCredentials,
  secretRef,
  type TextModel,
  textModelConfig,
  textModelRef,
} from "./provider-handoff.ts";

export const PROJECT = fileURLToPath(new URL("../", import.meta.url));
const NATIVE_PRELOAD = fileURLToPath(
  new URL("./native-bootstrap.ts", import.meta.url),
);
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
  | {
      provider: "openai-compatible";
      model: string;
      baseUrl: string;
      keyEnv?: string;
    }
) & {
  dreaming?: boolean;
  textModel?: TextModel;
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
  private smoke?: { fixtureUrl?: string };
  private lifecycleLedger?: string;

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
        if (settings.textModel) {
          if ("ref" in settings.textModel)
            nativeModel(settings.textModel.ref, settings.textModel.keyEnv);
          else localEndpoint(settings.textModel.baseUrl);
        }
        if (
          settings.provider === "openai-compatible" &&
          typeof settings.model === "string" &&
          settings.model.trim()
        ) {
          this.settings = {
            ...settings,
            baseUrl: settings.keyEnv
              ? providerEndpoint(settings.baseUrl)
              : localEndpoint(settings.baseUrl),
            ...(settings.keyEnv
              ? { keyEnv: credentialEnv(settings.keyEnv) }
              : {}),
          };
        } else if (settings.provider === "none") this.settings = settings;
        else
          throw new Error(
            "Invalid lab settings; select keyword or explicitly configured native embeddings.",
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

  private credentialNames(): string[] {
    return [
      ...(this.settings.provider === "openai-compatible" && this.settings.keyEnv
        ? [this.settings.keyEnv]
        : []),
      ...(this.settings.textModel && "ref" in this.settings.textModel
        ? [this.settings.textModel.keyEnv]
        : []),
    ];
  }

  private redact(text: string): string {
    return redactCredentials(
      text,
      forwardCredentials(this.credentialNames(), process.env),
    );
  }

  private env(): NodeJS.ProcessEnv {
    // The operator opts in to exact provider names. All other environment stays isolated.
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
      ...(this.lifecycleLedger
        ? { OPENCLAW_LAB_LIFECYCLE_LEDGER: this.lifecycleLedger }
        : {}),
      ...forwardCredentials(this.credentialNames(), process.env),
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
              apiKey: this.settings.keyEnv
                ? secretRef(this.settings.keyEnv)
                : "local-lab-placeholder",
            },
            sources: ["memory"],
            fallback: "none",
          };
    await writeFile(
      this.config,
      JSON.stringify(
        {
          ...(this.credentialNames().length
            ? {
                secrets: {
                  providers: {
                    "bridge-env": {
                      source: "env",
                      allowlist: this.credentialNames(),
                    },
                  },
                },
              }
            : {}),
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
              ...(this.lifecycleLedger
                ? {
                    params: { maxTokens: 1024 },
                    thinkingDefault: "off",
                    timeoutSeconds: 60,
                    embeddedAgent: { cyberFailover: { mode: "off" } },
                  }
                : {}),
              compaction: {
                postIndexSync: "await",
                ...(this.compactionTest
                  ? { keepRecentTokens: 512, recentTurnsPreserve: 1 }
                  : {}),
                ...(this.settings.textModel
                  ? { model: textModelRef(this.settings.textModel) }
                  : {}),
                memoryFlush: {
                  enabled: Boolean(
                    this.settings.flush && this.settings.textModel,
                  ),
                  ...(this.settings.textModel
                    ? { model: textModelRef(this.settings.textModel) }
                    : {}),
                  softThresholdTokens: 4000,
                  forceFlushTranscriptBytes:
                    this.settings.flush === "test" ? 1024 : "2mb",
                },
              },
              ...(this.settings.textModel
                ? {
                    model: {
                      primary: textModelRef(this.settings.textModel),
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
                models:
                  this.smoke || this.lifecycleLedger
                    ? {
                        catalogRefresh: { enabled: false },
                        providers: {
                          openrouter: {
                            apiKey: secretRef(
                              this.credentialNames()[0] as string,
                            ),
                            ...(this.smoke?.fixtureUrl
                              ? { baseUrl: this.smoke.fixtureUrl }
                              : {}),
                            // Public native catalog overlay for this one approved reference.
                            models: [
                              {
                                id: "openai/gpt-6-sol",
                                name: "GPT-6 Sol bounded smoke",
                                reasoning: true,
                                maxTokens: this.lifecycleLedger
                                  ? 1024
                                  : SMOKE.maxOutputTokens,
                                compat: {
                                  maxTokensField: "max_completion_tokens",
                                  thinkingFormat: "openrouter",
                                },
                              },
                            ],
                          },
                        },
                      }
                    : textModelConfig(this.settings.textModel),
              }
            : {}),
          plugins: {
            entries: {
              ...(this.smoke
                ? {
                    "llm-task": {
                      enabled: true,
                      llm: {
                        allowedCompletionModels: [PAID_SELECTION.chat],
                        allowModelOverride: false,
                        allowAuthProfileOverride: false,
                      },
                      config: {
                        maxTokens: SMOKE.maxOutputTokens,
                        timeoutMs: SMOKE.timeoutMs,
                      },
                    },
                  }
                : {}),
              "memory-core": {
                config: {
                  dreaming: {
                    enabled: this.settings.dreaming ?? false,
                    frequency: "0 0 1 1 *",
                    timezone: "UTC",
                    ...(this.lifecycleLedger
                      ? {
                          execution: {
                            defaults: { model: PAID_SELECTION.chat },
                          },
                          phases: {
                            light: {
                              limit: 4,
                              execution: { model: PAID_SELECTION.chat },
                            },
                            rem: {
                              limit: 4,
                              execution: { model: PAID_SELECTION.chat },
                            },
                            deep: {
                              limit: 2,
                              minScore: 0,
                              minRecallCount: 1,
                              minUniqueQueries: 1,
                              execution: { model: PAID_SELECTION.chat },
                            },
                          },
                        }
                      : {}),
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
              rememberAcrossConversations: Boolean(this.lifecycleLedger),
              query: { minScore: 0 },
            },
          },
          tools: {
            fs: { workspaceOnly: true },
            allow: [
              "memory_search",
              "memory_get",
              ...(this.smoke ? ["llm-task"] : []),
              ...(this.settings.flush ? ["read", "write", "edit"] : []),
            ],
          },
          browser: { enabled: false },
          ...(this.smoke ? { cron: { enabled: false } } : {}),
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

  private async native(
    args: string[],
    timeout = 120000,
    boundedIndex = false,
    stdoutOnly = false,
  ): Promise<string> {
    if (boundedIndex) {
      if (!this.smoke || args.join(" ") !== "memory index --force --agent main")
        throw new Error("Invalid bounded smoke index operation.");
    } else if (!this.lifecycleLedger)
      assertNativeOperationAllowed(this.credentialNames().length > 0, args);
    const child = spawn(
      process.execPath,
      ["--import", NATIVE_PRELOAD, ENTRY, ...args],
      {
        env: this.env(),
        cwd: this.directory,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const done = new Promise<void>((finish) =>
      child.once("close", () => finish()),
    );
    this.commands.set(child, done);
    let output = "";
    let stdout = "";
    child.stdout.on("data", (data: Buffer) => {
      output = this.redact(output + data.toString()).slice(-100000);
      stdout = this.redact(stdout + data.toString()).slice(-100000);
    });
    child.stderr.on("data", (data: Buffer) => {
      output = this.redact(output + data.toString()).slice(-100000);
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
      return (stdoutOnly ? stdout : output).trim();
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
    delete this.settings.keyEnv;
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

  /** Configure references only. Native config validation makes no provider request. */
  async configureNativeModel(ref: string, keyEnv: string) {
    const selected = nativeModel(ref, keyEnv);
    await this.applyNativeSettings({ ...this.settings, textModel: selected });
    return { configured: ref, credentialEnv: keyEnv, configurationOnly: true };
  }

  /** OpenClaw owns the generic embedding transport and SecretRef resolution. */
  async configureNativeVector(url: string, model: string, keyEnv: string) {
    if (!model.trim() || model.length > 200)
      throw new Error("Supply the chosen native embedding model name.");
    await this.applyNativeSettings({
      ...this.settings,
      provider: "openai-compatible",
      baseUrl: providerEndpoint(url),
      model,
      keyEnv: credentialEnv(keyEnv),
    });
    return {
      configured: "openai-compatible",
      model,
      credentialEnv: keyEnv,
      configurationOnly: true,
      needsIndex: true,
    };
  }

  private async applyNativeSettings(next: Settings) {
    await this.stop();
    const previous = this.settings;
    this.settings = next;
    try {
      await this.saveSettings();
      await this.validateConfig();
    } catch (error) {
      this.settings = previous;
      await this.saveSettings();
      throw error;
    }
  }

  async validateConfig() {
    await this.stop();
    return JSON.parse(
      await this.native(["config", "validate", "--json"]),
    ) as unknown;
  }

  /** Native metadata only, with no Gateway start or inference command. */
  async providerUsage() {
    await this.stop();
    return JSON.parse(
      await this.native(
        [
          "status",
          "--usage",
          "--json",
          "--agent",
          "main",
          "--timeout",
          "10000",
        ],
        25000,
        false,
        true,
      ),
    ) as unknown;
  }

  /** Dedicated, one-shot adapter. It does not authorize any general lab operation. */
  async boundedSmoke(
    confirmations: SmokeConfirmations,
    fixture?: SmokeFixture,
  ) {
    confirmSmoke(confirmations); // Before selected env access or native spawn.
    const contract = await verifySmokeRuntime();
    if (
      !this.locked ||
      this.smoke ||
      this.settings.provider !== "none" ||
      this.settings.textModel ||
      (await this.listNotes()).length
    )
      throw new Error("Bounded smoke requires a fresh, empty, isolated lab.");
    const fixtureUrl = fixture ? fixtureEndpoint(fixture) : undefined;
    const keyEnv = fixture ? "SYNTHETIC_SMOKE_KEY" : PAID_SELECTION.keyEnv;
    requireEnvironment([keyEnv]);
    this.smoke = { fixtureUrl };
    this.settings = {
      provider: "openai-compatible",
      model: PAID_SELECTION.embedding,
      baseUrl: fixtureUrl ?? PAID_SELECTION.embeddingUrl,
      keyEnv,
      textModel: nativeModel(PAID_SELECTION.chat, keyEnv),
      dreaming: false,
      sessionMemory: false,
    };
    try {
      await this.provision(); // No persisted smoke permission/settings.
      await this.validateConfig();
      const budget = smokeBudget(
        fixture?.status ?? (await this.providerUsage()),
        confirmations,
      );
      await this.writeNote("resident", SMOKE.note);
      const assertCorpus = async () => {
        if (
          (await this.listNotes()).join() !== "resident.md" ||
          (await readFile(join(this.notes, "resident.md"), "utf8")) !==
            SMOKE.note
        )
          throw new Error("Bounded smoke corpus changed; stopping.");
      };
      await assertCorpus();
      await this.native(
        ["memory", "index", "--force", "--agent", "main"],
        30000,
        true,
      );
      await this.startGateway(true);
      await assertCorpus();
      const completion = (await this.invoke("llm-task", {
        prompt: SMOKE.prompt,
        thinking: "off",
        maxTokens: SMOKE.maxOutputTokens,
        timeoutMs: SMOKE.timeoutMs,
        schema: {
          type: "object",
          properties: { ok: { const: true } },
          required: ["ok"],
          additionalProperties: false,
        },
      })) as { json?: { ok?: boolean }; provider?: string; model?: string };
      if (
        !completion.json?.ok ||
        completion.provider !== "openrouter" ||
        completion.model !== "openai/gpt-6-sol"
      )
        throw new Error(
          "Native completion did not return the approved model and JSON result.",
        );
      await assertCorpus();
      const recall = (await this.invoke("memory_search", {
        query: SMOKE.query,
        maxResults: 1,
        minScore: 0,
      })) as SearchResult;
      if (
        recall.disabled ||
        recall.unavailable ||
        recall.error ||
        recall.provider !== "openai-compatible" ||
        !recall.results?.some((hit) => hit.path === SMOKE.path)
      )
        throw new Error(
          "Native semantic smoke did not retrieve the synthetic source.",
        );
      const source = (await this.invoke("memory_get", {
        path: SMOKE.path,
        from: 1,
        lines: 10,
      })) as { text?: string };
      if (!source.text?.includes("Zephyr travels to the office by bicycle."))
        throw new Error("Native source read failed.");
      return {
        mode: fixture ? "native-runtime/mock-provider" : "real-provider",
        budget,
        completion: completion.json,
        recall: { path: SMOKE.path, hits: recall.results.length },
        inputUpperBound: contract.inputUpperBound,
        outputLimit: SMOKE.maxOutputTokens,
        wrapperRetries: 0,
        nativePriceRoutingVerified: false,
        lifecycleExtraction: "pending",
        estimatedUsd: SMOKE.estimatedUsd,
        testCeilingUsd: SMOKE.testCeilingUsd,
        estimateIsHardCap: false,
      };
    } finally {
      await this.stop();
      this.smoke = undefined;
      this.settings = { provider: "none" };
      await this.provision();
    }
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

  /** Fixed synthetic acceptance; temporary permission never leaves this operation. */
  async boundedLifecycle(ledgerPath: string) {
    await verifySmokeRuntime();
    requireEnvironment([PAID_SELECTION.keyEnv]);
    if (
      this.lifecycleLedger ||
      this.smoke ||
      this.settings.provider !== "none" ||
      this.settings.textModel ||
      (await this.listNotes()).length
    )
      throw new Error("Lifecycle acceptance needs a fresh keyword workspace.");
    this.lifecycleLedger = resolve(ledgerPath);
    this.settings = {
      provider: "none",
      textModel: nativeModel(PAID_SELECTION.chat, PAID_SELECTION.keyEnv),
      sessionMemory: true,
    };
    const result: Record<string, unknown> = {
      mode: "real-provider/native-lifecycle",
      limits: LIFECYCLE_LIMITS,
      stages: {},
      testThresholds: { minScore: 0, minRecallCount: 1, minUniqueQueries: 1 },
      automaticEveryConversationExtraction:
        "unsupported: this builtin path uses triggered flush and lifecycle hooks",
    };
    const stages = result.stages as Record<string, unknown>;
    const snapshot = async () => {
      const files: Record<string, string> = {};
      for (const name of await this.listNotes())
        files[`memory/${name}`] = await readFile(
          join(this.notes, name),
          "utf8",
        );
      for (const name of ["MEMORY.md", "DREAMS.md"]) {
        try {
          files[name] = await readFile(
            join(this.directory, "workspace", name),
            "utf8",
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      return files;
    };
    try {
      await this.provision();
      await this.validateConfig();
      const beforeBudget = smokeBudget(await this.providerUsage(), {
        keyLimit: true,
        prices: SMOKE.prices,
        providerLimitUsd: 50,
      });
      result.beforeBudget = beforeBudget;
      if (beforeBudget.usedUsd + LIFECYCLE_LIMITS.estimatedUsd > 5)
        throw new Error(
          "Finite lifecycle estimate exceeds remaining approved total budget.",
        );
      result.beforeConversation = await snapshot();
      const context = Array.from(
        { length: 18 },
        (_, i) =>
          `Synthetic context ${i + 1}: Project Borealis is an imaginary observatory rehearsal used only in this lab.`,
      ).join("\n");
      result.firstConversation = await this.chat(
        "conversation",
        `My durable standing preference for synthetic Project Borealis is to use indigo filters every Thursday. Acknowledge briefly.\n${context}`,
      );
      result.afterFirstConversation = await snapshot();
      stages.chat = "pass";
      await this.configureFlush("test");
      result.secondConversation = await this.chat(
        "conversation",
        "Confirm the standing filter preference we discussed in one short sentence.",
      );
      const observedFlush = await this.waitForFlush("conversation");
      (result.secondConversation as { state: unknown }).state = observedFlush;
      result.afterFlush = await snapshot();
      const second = result.secondConversation as {
        state: unknown;
        history: unknown;
      };
      stages.flush =
        /"memoryFlush"/.test(JSON.stringify(second.state)) &&
        /"kind":"succeeded"/.test(JSON.stringify(second.state))
          ? "pass"
          : "fail: native successful flush marker absent";
      const day = new Date().toISOString().slice(0, 10);
      const daily =
        (result.afterFlush as Record<string, string>)[`memory/${day}.md`] ?? "";
      stages.extraction = /indigo/i.test(daily)
        ? "pass"
        : "fail: daily Markdown does not contain the conversational preference";
      result.dailySource = await this.get(`memory/${day}.md`, 1, 200);
      result.compaction = await this.compactSession("conversation", true);
      stages.compaction = /"compacted":true/.test(
        JSON.stringify(result.compaction),
      )
        ? "pass"
        : "fail: native compaction did not commit";
      result.resetCapture = await this.resetSession("conversation");
      await this.index();
      result.recallBeforeDreaming = [];
      for (const query of ["indigo", "indigo filters", "Borealis Thursday"])
        (result.recallBeforeDreaming as unknown[]).push(
          await this.search(query),
        );
      result.nativeRemStage = await this.remStage();
      result.beforeConsolidation = await snapshot();
      result.sweep = await this.dreamRun();
      result.dreamStatus = await this.dreamStatus();
      result.diary = await this.dreamDiary();
      result.afterConsolidation = await snapshot();
      const after = result.afterConsolidation as Record<string, string>;
      const prior = result.beforeConsolidation as Record<string, string>;
      stages.durablePromotion =
        after["MEMORY.md"] !== prior["MEMORY.md"] &&
        /indigo/i.test(after["MEMORY.md"] ?? "") &&
        /source=memory\//.test(after["MEMORY.md"] ?? "")
          ? "pass"
          : "fail: no sourced durable preference change";
      stages.modelConsolidation =
        /- Added: \d+\n- Merged: \d+\n- Superseded: \d+/.test(
          after["DREAMS.md"] ?? "",
        )
          ? "pass"
          : "unverified: native accepted rewrite summary absent";
      await this.index();
      await this.restart();
      result.recallAfterRestart = await this.search("indigo", "later-session");
      stages.persistenceRecall = (
        result.recallAfterRestart as SearchResult
      ).results.some((hit) => /indigo/i.test(hit.snippet))
        ? "pass"
        : "fail: preference not recalled after restart";
      if (stages.durablePromotion === "pass")
        result.promotionExplanation = await this.explain("indigo");
    } catch (error) {
      result.error = this.redact((error as Error).message);
    } finally {
      await this.stop();
      try {
        result.afterBudget = smokeBudget(await this.providerUsage(), {
          keyLimit: true,
          prices: SMOKE.prices,
          providerLimitUsd: 50,
        });
      } catch {
        result.costMeasurement = "unavailable";
      }
      try {
        const log = this.redact(
          await readFile(join(this.directory, "openclaw.log"), "utf8"),
        );
        result.nativeConsolidationLog = log
          .split("\n")
          .filter((line) =>
            /consolidat|promotion|rewrite|fallback|degraded|Finite lifecycle|memory.flush/i.test(
              line,
            ),
          )
          .slice(-50);
      } catch {
        result.nativeConsolidationLog = [];
      }
      result.finalMarkdown = await snapshot();
      result.requestLedger = readLifecycleLedger(this.lifecycleLedger);
      this.lifecycleLedger = undefined;
      this.settings = { provider: "none" };
      await this.provision();
    }
    return result;
  }

  async configureFlush(mode: "normal" | "test" | "off") {
    if (mode !== "off" && !this.settings.textModel)
      throw new Error(
        "First select a tool-capable model with model or native-model. No provider is inferred.",
      );
    await this.stop();
    this.settings.flush = mode === "off" ? undefined : mode;
    await this.saveSettings();
    return {
      memoryFlush: mode,
      model: this.settings.textModel
        ? textModelRef(this.settings.textModel)
        : null,
      forceFlushTranscriptBytes: mode === "test" ? 1024 : "2mb",
      trigger:
        "Native embedded-agent turn admission/post-reply; once per compaction cycle",
      requirement:
        "Native successful memoryFlush state AND actual durable note content; configuration alone is not acceptance.",
    };
  }

  /** Continue only consolidation from a previously verified model-produced note. */
  async boundedConsolidation(ledgerPath: string) {
    await verifySmokeRuntime();
    requireEnvironment([PAID_SELECTION.keyEnv]);
    if (
      this.lifecycleLedger ||
      this.smoke ||
      this.settings.textModel ||
      (await this.listNotes()).length
    )
      throw new Error("Consolidation acceptance needs a fresh workspace.");
    const checkpoint = JSON.parse(
      await readFile(
        join(PROJECT, "evidence/lifecycle-acceptance/acceptance.json"),
        "utf8",
      ),
    );
    const { day, note } = consolidationCheckpoint(checkpoint);
    this.lifecycleLedger = resolve(ledgerPath);
    this.settings = {
      provider: "none",
      textModel: nativeModel(PAID_SELECTION.chat, PAID_SELECTION.keyEnv),
    };
    const result: Record<string, unknown> = {
      mode: "real-provider/native-consolidation",
      importedVerifiedModelNote: true,
      adapter:
        "Copy the verified model-produced daily note into a separate synthetic workspace; this is not automatic ingestion or preserved source-session provenance.",
      stages: {},
      limits: LIFECYCLE_LIMITS,
      testThresholds: { minScore: 0, minRecallCount: 1, minUniqueQueries: 1 },
    };
    const stages = result.stages as Record<string, unknown>;
    try {
      await this.provision();
      await this.validateConfig();
      const budget = smokeBudget(await this.providerUsage(), {
        keyLimit: true,
        prices: SMOKE.prices,
        providerLimitUsd: 50,
      });
      result.beforeBudget = budget;
      if (budget.usedUsd + LIFECYCLE_LIMITS.estimatedUsd > 5)
        throw new Error(
          "Consolidation estimate exceeds remaining approved total budget.",
        );
      result.before = {
        memory: await this.get("MEMORY.md"),
        diary: await this.dreamDiary(),
      };
      await this.writeDaily(day, note);
      await this.index();
      result.staged = await this.remStage();
      result.nativeRecallTurn = await this.chat(
        "recall",
        "Use memory_search to recall the standing filter preference for synthetic Project Borealis from this workspace, then answer in one short sentence.",
      );
      for (const query of ["indigo", "indigo filters", "Borealis Thursday"])
        await this.search(query);
      result.sweep = await this.dreamRun();
      result.dreamStatus = await this.dreamStatus();
      result.diary = await this.dreamDiary();
      result.memory = await this.get("MEMORY.md", 1, 200);
      const memory = result.memory as { text?: string };
      const diary = result.diary as { content?: string };
      stages.durablePromotion =
        /indigo/i.test(memory.text ?? "") &&
        /source=memory\//.test(memory.text ?? "")
          ? "pass"
          : "fail: no sourced durable preference";
      stages.modelConsolidation =
        /- Added: \d+\s+- Merged: \d+\s+- Superseded: \d+/.test(
          diary.content ?? "",
        )
          ? "pass"
          : "unverified: accepted native rewrite summary absent";
      await this.index();
      await this.restart();
      result.recallAfterRestart = await this.search("indigo", "later-session");
      stages.persistenceRecall = (
        result.recallAfterRestart as SearchResult
      ).results.some((hit) => hit.path === "MEMORY.md")
        ? "pass"
        : "fail: durable source not recalled after restart";
    } catch (error) {
      result.error = this.redact((error as Error).message);
    } finally {
      await this.stop();
      try {
        result.afterBudget = smokeBudget(await this.providerUsage(), {
          keyLimit: true,
          prices: SMOKE.prices,
          providerLimitUsd: 50,
        });
      } catch {
        result.costMeasurement = "unavailable";
      }
      result.requestLedger = readLifecycleLedger(this.lifecycleLedger);
      try {
        result.nativeDiagnostics = this.redact(
          await readFile(join(this.directory, "openclaw.log"), "utf8"),
        )
          .split("\n")
          .filter((line) =>
            /consolidat|promotion|rewrite|fallback|degraded|Finite lifecycle/i.test(
              line,
            ),
          )
          .slice(-40);
      } catch {
        result.nativeDiagnostics = [];
      }
      this.lifecycleLedger = undefined;
      this.settings = { provider: "none" };
      await this.provision();
    }
    return result;
  }

  /** One fixed real-model scenario. The source session stays in this workspace. */
  async boundedProvenanceAcceptance(ledgerPath: string) {
    await verifySmokeRuntime();
    requireEnvironment([PAID_SELECTION.keyEnv]);
    if (
      this.lifecycleLedger ||
      this.settings.textModel ||
      (await this.listNotes()).length
    )
      throw new Error("Provenance acceptance needs a fresh workspace.");
    this.lifecycleLedger = resolve(ledgerPath);
    this.settings = {
      provider: "none",
      dreaming: true,
      flush: "normal",
      sessionMemory: true,
      textModel: nativeModel(PAID_SELECTION.chat, PAID_SELECTION.keyEnv),
    };
    const result: Record<string, unknown> = {
      mode: "real-provider/native-provenance-consolidation",
      outputAdapter:
        "For native utility calls that omit an output-token limit, the test transport adds max_completion_tokens=2048. It preserves model, prompt, tools, and memory semantics. This is an application budget adapter, not a native dreaming capability.",
      stages: {},
      limits: CONSOLIDATION_LIMITS,
      testThresholds: { minScore: 0, minRecallCount: 1, minUniqueQueries: 1 },
      baselineAdapter:
        "A synthetic prior duplicate is an explicit application fixture with matching project scope. The daily duplicate must be written by the native agent. No session or database is imported. This tests native duplicate merging, not unverified lineage-based supersession.",
    };
    const stages = result.stages as Record<string, string>;
    const snapshot = async () => {
      const files: Record<string, string> = {};
      for (const name of await this.listNotes())
        files[`memory/${name}`] = await readFile(
          join(this.notes, name),
          "utf8",
        );
      for (const name of ["MEMORY.md", "DREAMS.md"]) {
        try {
          files[name] = await readFile(
            join(this.directory, "workspace", name),
            "utf8",
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      return files;
    };
    try {
      await this.provision();
      await this.validateConfig();
      const before = smokeBudget(await this.providerUsage(), {
        keyLimit: true,
        prices: SMOKE.prices,
        providerLimitUsd: 50,
      });
      result.beforeBudget = before;
      if (before.usedUsd + CONSOLIDATION_LIMITS.estimatedUsd > 5)
        throw new Error(
          "Consolidation envelope exceeds the cumulative 5 USD test ceiling.",
        );
      const prior =
        "# Long-Term Memory\n\n- Synthetic Project Vega uses amber filters every Friday. <!-- project: github.com/DorukhanArslan/openclaw-memory-bridge -->\n- Unrelated synthetic project Lyra uses silver notebooks.\n- Fictional Atlas uses paper charts.\n- Fictional Cygnus uses brass clocks.\n- Fictional Draco uses white folders.\n";
      await writeFile(join(this.directory, "workspace", "MEMORY.md"), prior, {
        mode: 0o600,
        flag: "wx",
      });
      result.before = await snapshot();
      const day = new Date().toISOString().slice(0, 10);
      // The official embedded CLI is local operator input. Generic gateway
      // call requests only method-minimal scopes and cannot attest owner input.
      // No scope, security policy, or stored provenance is changed here.
      await this.stop();
      result.conversation = JSON.parse(
        await this.native(
          [
            "agent",
            "--local",
            "--agent",
            "main",
            "--session-key",
            "agent:main:main",
            "--message",
            `Use the native write tool to save exactly this one line to memory/${day}.md, with no heading: Synthetic Project Vega uses amber filters every Friday. <!-- project: github.com/DorukhanArslan/openclaw-memory-bridge -->. This is synthetic test data. Do not edit MEMORY.md. Reply briefly after the write.`,
            "--thinking",
            "off",
            "--timeout",
            "120",
            "--json",
          ],
          150000,
          false,
          true,
        ),
      );
      result.inputOrigin =
        "Official agent --local operator CLI; native ownership classification, no manual provenance edits";
      result.sourceHistory = await this.sessionHistory("main");
      result.sourceSession = await this.sessionState("main");
      result.afterConversation = await snapshot();
      const daily =
        (result.afterConversation as Record<string, string>)[
          `memory/${day}.md`
        ] ?? "";
      stages.nativeDailyWrite =
        /amber/i.test(daily) && /Friday/i.test(daily) ? "pass" : "fail";
      if (stages.nativeDailyWrite !== "pass")
        throw new Error(
          "Native agent did not produce the expected daily source.",
        );
      await this.index();
      result.recalls = [];
      for (const query of ["amber", "Vega amber", "Friday"])
        (result.recalls as unknown[]).push(await this.search(query, "main"));
      result.beforeSweepStatus = await this.dreamStatus();
      result.beforeSweepExplanation = await this.explain("amber");
      result.sweep = await this.dreamRun();
      // Cron completion can precede detached native diary calls. Observe the
      // native publication log; do not manufacture text or accept a fallback.
      const deadline = Date.now() + 150000;
      while (Date.now() < deadline) {
        const log = this.redact(
          await readFile(join(this.directory, "openclaw.log"), "utf8"),
        );
        const completed = (log.match(/dream diary entry written for/g) ?? [])
          .length;
        const degraded = /narrative generation (?:failed|used fallback)/.test(
          log,
        );
        if (
          completed >= 3 ||
          degraded ||
          /candidates=0, applied=0.*narrativesPending=0/.test(log)
        )
          break;
        await delay(1000);
      }
      result.after = await snapshot();
      result.diary = await this.dreamDiary();
      result.afterSweepStatus = await this.dreamStatus();
      const files = result.after as Record<string, string>;
      const memory = files["MEMORY.md"] ?? "";
      const dreams = files["DREAMS.md"] ?? "";
      const log = this.redact(
        await readFile(join(this.directory, "openclaw.log"), "utf8"),
      );
      result.nativeDiagnostics = log
        .split("\n")
        .filter((line) =>
          /consolidat|promotion|rewrite|fallback|degraded|dream diary|Finite lifecycle/i.test(
            line,
          ),
        )
        .slice(-60);
      stages.modelConsolidation =
        /(?:Merged|Superseded): [1-9]/.test(dreams) &&
        !/consolidation .*fallback/i.test(log)
          ? "pass"
          : "fail";
      stages.durableMerge =
        /amber/i.test(memory) &&
        /Friday/i.test(memory) &&
        !/indigo/i.test(memory) &&
        /silver notebooks/i.test(memory) &&
        (
          memory.match(
            /Synthetic Project Vega uses amber filters every Friday/g,
          ) ?? []
        ).length === 1 &&
        /Consolidated Memory/.test(memory)
          ? "pass"
          : "fail";
      stages.sourceReference = new RegExp(
        `(?:source=|Source: )memory/${day}`,
      ).test(memory)
        ? "pass"
        : "fail";
      stages.modelDiary =
        (log.match(/dream diary entry written for/g) ?? []).length >= 3 &&
        !/narrative generation (?:failed|used fallback)/.test(log) &&
        dreams.length > 100
          ? "pass"
          : "fail";
      await this.index();
      await this.restart();
      result.recallAfterRestart = await this.search("amber", "later-session");
      stages.persistenceRecall = (
        result.recallAfterRestart as SearchResult
      ).results.some((hit) => hit.path === "MEMORY.md")
        ? "pass"
        : "fail";
      result.sessionAfterRestart = await this.sessionState("main");
    } catch (error) {
      result.error = this.redact((error as Error).message);
    } finally {
      await this.stop();
      try {
        result.afterBudget = smokeBudget(await this.providerUsage(), {
          keyLimit: true,
          prices: SMOKE.prices,
          providerLimitUsd: 50,
        });
      } catch {
        result.costMeasurement = "unavailable";
      }
      result.requestLedger = readLifecycleLedger(this.lifecycleLedger);
      this.lifecycleLedger = undefined;
      this.settings = { provider: "none" };
      await this.provision();
    }
    return result;
  }

  private sessionKey(session: string) {
    return `agent:main:${validId(session)}`;
  }

  async createSession(session: string) {
    return this.rpc("sessions.create", {
      key: this.sessionKey(session),
      agentId: "main",
      ...(this.settings.textModel
        ? { model: textModelRef(this.settings.textModel) }
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
        "Select a native tool-capable text model before real chat execution.",
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
        "Native summarizing compaction requires a selected tool-capable text model.",
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

  /** Observe asynchronous native maintenance; never starts a flush itself. */
  async waitForFlush(session: string, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    let state = await this.sessionState(session);
    while (Date.now() < deadline) {
      const flush = state.nativeMaintenance.memoryFlush as {
        kind?: string;
      } | null;
      if (
        flush?.kind &&
        ["succeeded", "failed", "exhausted"].includes(flush.kind)
      )
        return state;
      await delay(1000);
      state = await this.sessionState(session);
    }
    return state; // Missing metadata is a failed acceptance, not inferred success.
  }

  async remPreview() {
    await this.stop();
    return JSON.parse(
      await this.native(
        [
          "memory",
          "rem-harness",
          "--agent",
          "main",
          "--path",
          this.notes,
          "--grounded",
          "--json",
        ],
        120000,
        false,
        true,
      ),
    ) as unknown;
  }
  async remStage() {
    await this.stop();
    return JSON.parse(
      await this.native(
        [
          "memory",
          "rem-backfill",
          "--agent",
          "main",
          "--path",
          this.notes,
          "--stage-short-term",
          "--json",
        ],
        120000,
        false,
        true,
      ),
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
      await this.native(
        [
          "memory",
          "promote-explain",
          selector,
          "--agent",
          "main",
          "--include-promoted",
          "--json",
        ],
        120000,
        false,
        true,
      ),
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
    tool: "memory_search" | "memory_get" | "llm-task",
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
    const body = JSON.parse(this.redact(await response.text())) as {
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
    return this.startGateway();
  }

  private async startGateway(boundedSmoke = false) {
    if (boundedSmoke) {
      if (!this.smoke) throw new Error("Invalid bounded Gateway startup.");
    } else if (!this.lifecycleLedger)
      assertGatewayAllowed(this.credentialNames().length > 0);
    if (this.child) return;
    this.port = await freePort();
    this.token = randomBytes(32).toString("hex");
    await this.provision();
    this.logTail = "";
    const child = spawn(
      process.execPath,
      [
        "--import",
        NATIVE_PRELOAD,
        ENTRY,
        "gateway",
        "--port",
        String(this.port),
        "--bind",
        "loopback",
      ],
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
      this.logTail = this.redact(this.logTail + data.toString()).slice(-12000);
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
          if (boundedSmoke) {
            const source = (await this.invoke("memory_get", {
              path: SMOKE.path,
              from: 1,
              lines: 10,
            })) as { text?: string };
            if (!source.text?.includes("Zephyr travels"))
              throw new Error("Source not ready.");
            return;
          }
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

  /** Lab owner only: borrow its already-running Gateway without lifecycle control. */
  attachMemoryClient() {
    if (
      !this.child ||
      this.child.exitCode !== null ||
      !this.port ||
      !this.token
    )
      throw new Error(
        "The lab owner must start its Gateway before attaching a client.",
      );
    return new ReadyGateway({
      url: `http://127.0.0.1:${this.port}`,
      token: this.token,
      agentId: "main",
    });
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

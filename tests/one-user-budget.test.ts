import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { inspectBudget } from "../src/budget-preflight.ts";
import {
  admitOneUserRequest,
  assertFreshOneUserContext,
  boundOneUserUtilityRequest,
  claimOneUserActivation,
  createOneUserAdmission,
  inspectOneUserQuota,
  ONE_USER_LIMITS,
  readOneUserLedger,
  validateOneUserContext,
} from "../src/one-user-budget.ts";
import { SMOKE, smokeBudget } from "../src/paid-smoke.ts";

const execute = promisify(execFile);
const chatUrl = "https://openrouter.ai/api/v1/chat/completions";
const embeddingUrl = "https://openrouter.ai/api/v1/embeddings";
type Snapshot = {
  usage: {
    updatedAt: number;
    providers: [
      {
        provider: string;
        billing: [
          {
            type: string;
            label: string;
            unit: string;
            limit: number;
            used: number;
            period: string;
          },
        ];
      },
    ];
  };
};
const snapshot = (): Snapshot => ({
  usage: {
    updatedAt: Date.now(),
    providers: [
      {
        provider: "openrouter",
        billing: [
          {
            type: "budget",
            label: "API key budget",
            unit: "USD",
            limit: 50,
            used: 0,
            period: "weekly",
          },
        ],
      },
    ],
  },
});
function chat(output = 512, content = "Synthetic preference") {
  return {
    method: "POST",
    body: JSON.stringify({
      model: "openai/gpt-6-sol",
      max_completion_tokens: output,
      messages: [{ role: "user", content }],
    }),
  };
}
function embedding(input: unknown = "Synthetic cobalt label") {
  return {
    method: "POST",
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input }),
  };
}
async function setup(active = true) {
  const root = await mkdtemp(join(tmpdir(), "one-user-budget-"));
  const dir = join(root, "scenario"),
    ledger = join(dir, "ledger.json");
  createOneUserAdmission(dir, inspectOneUserQuota(snapshot()));
  if (active) claimOneUserActivation(ledger);
  return {
    root,
    dir,
    ledger,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("ONE USER BUDGET: finite current scope preserves period and strict generic gates", () => {
  const data = snapshot(),
    quota = inspectOneUserQuota(data);
  assert.equal(quota.observedPeriod, "weekly");
  assert.equal(quota.usageScope, "reset-window");
  assert.equal(quota.cumulativeHistoryVerified, false);
  assert.ok(Math.abs(ONE_USER_LIMITS.estimatedUsd - 4.88523968) < 1e-9);
  assert.ok(
    Math.abs(ONE_USER_LIMITS.currentWorkEstimateUsd - 4.90756672) < 1e-9,
  );
  assert.ok(ONE_USER_LIMITS.currentWorkEstimateUsd < 5);
  assert.equal(
    inspectBudget(data, Date.now(), 50).code,
    "periodic_or_unknown_reset",
  );
  assert.throws(
    () =>
      smokeBudget(data, {
        keyLimit: true,
        providerLimitUsd: 50,
        prices: SMOKE.prices,
      }),
    /periodic_or_unknown_reset/,
  );
});

test("ONE USER BUDGET: quota freshness, exact cap, headroom and metadata ambiguity fail closed", () => {
  const now = Date.now();
  const candidates: unknown[] = [null, {}, { usage: {} }];
  for (const alter of [
    (d: ReturnType<typeof snapshot>) => {
      d.usage.updatedAt -= 30001;
    },
    (d: ReturnType<typeof snapshot>) => {
      d.usage.updatedAt += 1001;
    },
    (d: ReturnType<typeof snapshot>) => {
      d.usage.providers.push(d.usage.providers[0]);
    },
    (d: ReturnType<typeof snapshot>) => {
      d.usage.providers[0].billing.push(d.usage.providers[0].billing[0]);
    },
    (d: ReturnType<typeof snapshot>) => {
      d.usage.providers[0].billing[0].limit = 5;
    },
    (d: ReturnType<typeof snapshot>) => {
      d.usage.providers[0].billing[0].used = 49;
    },
    (d: ReturnType<typeof snapshot>) => {
      d.usage.providers[0].billing[0].used = -1;
    },
    (d: ReturnType<typeof snapshot>) => {
      d.usage.providers[0].billing[0].used = Infinity;
    },
    (d: ReturnType<typeof snapshot>) => {
      d.usage.providers[0].billing[0].period = "yearly";
    },
  ]) {
    const d = snapshot();
    d.usage.updatedAt = now;
    alter(d);
    candidates.push(d);
  }
  for (const d of candidates)
    assert.throws(() => inspectOneUserQuota(d, now), /One-user quota denied/);
  const bad = snapshot() as unknown as {
    usage: { providers: Array<{ billing: Array<Record<string, unknown>> }> };
  };
  const provider = bad.usage.providers[0];
  assert.ok(provider);
  const budget = provider.billing[0];
  assert.ok(budget);
  budget.period = null;
  assert.throws(() => inspectOneUserQuota(bad), /One-user quota denied/);
});

test("ONE USER BUDGET: admission and zero-dispatch activation are durable and cannot resume", async () => {
  const f = await setup(false);
  try {
    assert.equal(statSync(f.dir).mode & 0o777, 0o700);
    assert.equal(statSync(f.ledger).mode & 0o777, 0o600);
    assertFreshOneUserContext(f.ledger);
    assert.throws(
      () => validateOneUserContext(f.ledger),
      /invalid or uncertain/,
    );
    const before = await readFile(join(f.dir, "admission.json"), "utf8");
    claimOneUserActivation(f.ledger);
    validateOneUserContext(f.ledger);
    assert.throws(() => claimOneUserActivation(f.ledger), /already activated/);
    assert.throws(
      () => createOneUserAdmission(f.dir, inspectOneUserQuota(snapshot())),
      /existing or uncertain/,
    );
    assert.equal(await readFile(join(f.dir, "admission.json"), "utf8"), before);
    const moved = join(f.root, "renamed-scenario");
    await rename(f.dir, moved);
    assert.throws(
      () => readOneUserLedger(join(moved, "ledger.json")),
      /invalid or uncertain/,
    );
  } finally {
    await f.cleanup();
  }
});

test("ONE USER BUDGET: historically valid admission cannot activate with stale quota", async () => {
  const f = await setup(false);
  try {
    const admissionPath = join(f.dir, "admission.json"),
      admission = JSON.parse(await readFile(admissionPath, "utf8")),
      ledger = JSON.parse(await readFile(f.ledger, "utf8")),
      past = Date.now() - 31001;
    admission.claimedAt = new Date(past).toISOString();
    admission.quota.snapshotUpdatedAt = past;
    const admissionText = `${JSON.stringify(admission)}\n`;
    ledger.admissionSha256 = createHash("sha256")
      .update(admissionText)
      .digest("hex");
    ledger.updatedAt = admission.claimedAt;
    const ledgerText = `${JSON.stringify(ledger)}\n`;
    await writeFile(admissionPath, admissionText);
    await writeFile(f.ledger, ledgerText);

    assert.equal(readOneUserLedger(f.ledger).requests, 0);
    assertFreshOneUserContext(f.ledger);
    assert.throws(() => claimOneUserActivation(f.ledger), /stale.*quota/);
    assert.equal(existsSync(join(f.dir, "activation.json")), false);
    assert.equal(await readFile(admissionPath, "utf8"), admissionText);
    assert.equal(await readFile(f.ledger, "utf8"), ledgerText);
  } finally {
    await f.cleanup();
  }
});

test("ONE USER BUDGET: native attempts reserve bytes/output, metadata is exempt and failure is not refunded", async () => {
  const f = await setup();
  try {
    const c = chat(),
      e = embedding(["Synthetic bicycle commute", "Synthetic rooibos"]);
    admitOneUserRequest(f.ledger, chatUrl, c);
    admitOneUserRequest(f.ledger, embeddingUrl, e);
    const before = await readFile(f.ledger, "utf8");
    admitOneUserRequest(f.ledger, "https://openrouter.ai/api/v1/key");
    admitOneUserRequest(f.ledger, "https://openrouter.ai/api/v1/credits");
    assert.equal(await readFile(f.ledger, "utf8"), before);
    const ledger = readOneUserLedger(f.ledger);
    assert.equal(ledger.requests, 2);
    assert.equal(ledger.chatRequests, 1);
    assert.equal(ledger.embeddingRequests, 1);
    assert.equal(ledger.chatInputBytes, Buffer.byteLength(c.body));
    assert.equal(ledger.embeddingInputBytes, Buffer.byteLength(e.body));
    assert.equal(ledger.outputTokens, 512);
    // The next call represents a retry after an uncertain transport result.
    admitOneUserRequest(f.ledger, chatUrl, c);
    assert.equal(readOneUserLedger(f.ledger).requests, 3);
    assert.equal(readOneUserLedger(f.ledger).outputTokens, 1024);
  } finally {
    await f.cleanup();
  }
});

test("ONE USER BUDGET: unsupported destinations, models, hosted capabilities and unbounded bodies stop before reservation", async () => {
  const f = await setup();
  try {
    const initial = await readFile(f.ledger, "utf8");
    for (const url of [
      "https://other.invalid/api/v1/chat/completions",
      `${chatUrl}?x=1`,
      "http://127.0.0.1:1/api/v1/chat/completions",
    ])
      assert.throws(
        () => admitOneUserRequest(f.ledger, url, chat()),
        /One-user request denied/,
      );
    const invalid: RequestInit[] = [
      { method: "POST", body: "private-synthetic-malformed" },
      {
        method: "POST",
        body: JSON.stringify({ model: "other", max_tokens: 1 }),
      },
      { method: "POST", body: JSON.stringify({ model: "openai/gpt-6-sol" }) },
      {
        method: "POST",
        body: JSON.stringify({
          model: "openai/gpt-6-sol",
          max_tokens: 1,
          max_completion_tokens: 1,
        }),
      },
      {
        method: "POST",
        body: JSON.stringify({ model: "openai/gpt-6-sol", max_tokens: 2049 }),
      },
      {
        method: "POST",
        body: JSON.stringify({
          model: "openai/gpt-6-sol",
          max_tokens: 1,
          plugins: [{ id: "web" }],
        }),
      },
      {
        method: "POST",
        body: JSON.stringify({
          model: "openai/gpt-6-sol",
          max_tokens: 1,
          tools: [{ type: "web_search" }],
        }),
      },
      chat(1, "x".repeat(100000)),
    ];
    for (const init of invalid)
      assert.throws(
        () => admitOneUserRequest(f.ledger, chatUrl, init),
        /One-user request denied/,
      );
    for (const input of [
      [],
      [""],
      [[1, 2]],
      [null],
      Array.from({ length: 129 }, () => "x"),
      "x".repeat(32768),
    ])
      assert.throws(
        () => admitOneUserRequest(f.ledger, embeddingUrl, embedding(input)),
        /One-user request denied/,
      );
    assert.equal(await readFile(f.ledger, "utf8"), initial);
  } finally {
    await f.cleanup();
  }
});

test("ONE USER BUDGET: native utility cap preserves explicit bounds, model, messages and tools", async () => {
  const f = await setup();
  try {
    const body = {
      model: "openai/gpt-6-sol",
      messages: [{ role: "user", content: "Synthetic summary" }],
      tools: [{ type: "function", function: { name: "synthetic" } }],
    };
    const init = {
      method: "POST",
      headers: { "content-length": "999" },
      body: JSON.stringify(body),
    };
    const bounded = boundOneUserUtilityRequest(f.ledger, chatUrl, init);
    assert.ok(bounded);
    const actual = JSON.parse(String(bounded.body));
    assert.deepEqual(actual, { ...body, max_completion_tokens: 1024 });
    assert.equal(new Headers(bounded.headers).get("content-length"), null);
    assert.deepEqual(JSON.parse(init.body), body);
    const explicit = chat(2048);
    assert.equal(
      boundOneUserUtilityRequest(f.ledger, chatUrl, explicit),
      explicit,
    );
    admitOneUserRequest(f.ledger, chatUrl, bounded);
    assert.equal(readOneUserLedger(f.ledger).outputTokens, 1024);
  } finally {
    await f.cleanup();
  }
});

test("ONE USER BUDGET: every aggregate limit denies before overshoot", async () => {
  for (const kind of [
    "chat_requests",
    "chat_input_bytes",
    "chat_output_tokens",
    "embedding_requests",
    "embedding_input_bytes",
  ]) {
    const f = await setup();
    try {
      const init =
        kind === "chat_input_bytes"
          ? chat(1, "x".repeat(85000))
          : kind === "chat_output_tokens"
            ? chat(2048)
            : kind === "embedding_input_bytes"
              ? embedding("x".repeat(32700))
              : kind === "embedding_requests"
                ? embedding()
                : chat(1);
      const url = kind.startsWith("embedding") ? embeddingUrl : chatUrl;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          admitOneUserRequest(f.ledger, url, init);
        } catch (error) {
          assert.match(String(error), new RegExp(kind));
          break;
        }
      }
      const actual = readOneUserLedger(f.ledger);
      assert.equal(actual.lastDenial?.code, kind);
      assert.ok(
        actual.chatRequests <= 32 &&
          actual.chatInputBytes <= 450000 &&
          actual.outputTokens <= 26000,
      );
      assert.ok(
        actual.embeddingRequests <= 64 && actual.embeddingInputBytes <= 1000000,
      );
    } finally {
      await f.cleanup();
    }
  }
});

test("ONE USER BUDGET: malformed, linked and locked ledgers are never repaired", async () => {
  const f = await setup();
  try {
    const before = await readFile(f.ledger, "utf8");
    await writeFile(join(f.dir, "ledger.lock"), "", { mode: 0o600 });
    assert.throws(
      () => admitOneUserRequest(f.ledger, chatUrl, chat()),
      /locked or uncertain/,
    );
    assert.ok(existsSync(join(f.dir, "ledger.lock")));
    assert.equal(await readFile(f.ledger, "utf8"), before);
    await rm(join(f.dir, "ledger.lock"));
    await writeFile(f.ledger, "private-synthetic-invalid");
    assert.throws(() => readOneUserLedger(f.ledger), /invalid or uncertain/);
    assert.equal(await readFile(f.ledger, "utf8"), "private-synthetic-invalid");
    const saved = join(f.dir, "saved.json");
    await rename(f.ledger, saved);
    await symlink(saved, f.ledger);
    assert.throws(() => readOneUserLedger(f.ledger), /invalid or uncertain/);
    assert.equal(await readFile(saved, "utf8"), "private-synthetic-invalid");
  } finally {
    await f.cleanup();
  }
});

test("ONE USER BUDGET: four native callers serialize counters without enlarging the scope", async () => {
  const f = await setup();
  try {
    const module = pathToFileURL(
      join(process.cwd(), "src/one-user-budget.ts"),
    ).href;
    const program =
      "import {admitOneUserRequest} from " +
      JSON.stringify(module) +
      ";" +
      "for(let n=0;n<8;n++)admitOneUserRequest(" +
      JSON.stringify(f.ledger) +
      "," +
      JSON.stringify(chatUrl) +
      "," +
      JSON.stringify(chat(1)) +
      ");";
    const outcomes = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        execute(process.execPath, ["--input-type=module", "-e", program], {
          env: {},
          timeout: 10000,
        }),
      ),
    );
    assert.ok(
      outcomes.every((outcome) => outcome.status === "fulfilled"),
      JSON.stringify(
        outcomes.map((x) =>
          x.status === "rejected" ? String(x.reason) : "ok",
        ),
      ),
    );
    const ledger = readOneUserLedger(f.ledger);
    assert.equal(ledger.chatRequests, 32);
    assert.equal(ledger.requests, 32);
    assert.equal(ledger.outputTokens, 32);
    assert.throws(
      () => admitOneUserRequest(f.ledger, chatUrl, chat(1)),
      /chat_requests/,
    );
    assert.equal(readOneUserLedger(f.ledger).requests, 32);
  } finally {
    await f.cleanup();
  }
});

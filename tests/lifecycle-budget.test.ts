import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  admitLifecycleRequest,
  createLifecycleLedger,
  LIFECYCLE_LIMITS,
} from "../src/lifecycle-request-budget.ts";

test("Finite lifecycle supervision: reject unknown requests and preserve an aggregate bound across callers", async () => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-budget-"));
  const path = join(root, "ledger.json");
  createLifecycleLedger(path);
  const request = (
    model = "openai/gpt-6-sol",
    max = 512,
    text = "synthetic",
  ) => ({
    method: "POST",
    body: JSON.stringify({
      model,
      max_completion_tokens: max,
      messages: [{ role: "user", content: text }],
    }),
  });
  const endpoint = "https://openrouter.ai/api/v1/chat/completions";
  try {
    assert.throws(() => createLifecycleLedger(path), /EEXIST/);
    assert.throws(
      () => admitLifecycleRequest(path, endpoint, request("other")),
      /model\/output/,
    );
    assert.throws(
      () => admitLifecycleRequest(path, endpoint, request(undefined, 4097)),
      /model\/output/,
    );
    assert.throws(
      () =>
        admitLifecycleRequest(
          path,
          "https://other.example/api/v1/chat/completions",
          request(),
        ),
      /destination/,
    );
    assert.throws(
      () =>
        admitLifecycleRequest(
          path,
          "https://openrouter.ai/api/v1/embeddings",
          request(),
        ),
      /shape/,
    );
    admitLifecycleRequest(path, "https://openrouter.ai/api/v1/key");
    assert.equal(JSON.parse(await readFile(path, "utf8")).requests, 0);
    for (let i = 0; i < LIFECYCLE_LIMITS.requests; i++) {
      const r = request();
      admitLifecycleRequest(
        path,
        endpoint,
        i % 2 ? { method: "post", body: new TextEncoder().encode(r.body) } : r,
      );
    }
    assert.throws(
      () => admitLifecycleRequest(path, endpoint, request()),
      /exhausted/,
    );
    const ledger = JSON.parse(await readFile(path, "utf8"));
    assert.equal(ledger.requests, 16);
    assert.equal(ledger.outputTokens, 8192);
    assert.ok(LIFECYCLE_LIMITS.estimatedUsd + 0.00021036 < 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Finite lifecycle supervision: input and aggregate output exhaustion reject before dispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-budget-"));
  const endpoint = "https://openrouter.ai/api/v1/chat/completions";
  try {
    for (const kind of ["input", "output"]) {
      const path = join(root, `${kind}.json`);
      createLifecycleLedger(path);
      const body = JSON.stringify({
        model: "openai/gpt-6-sol",
        max_completion_tokens: kind === "output" ? 4096 : 1024,
        messages: [
          {
            role: "user",
            content: kind === "input" ? "x".repeat(90000) : "synthetic",
          },
        ],
      });
      const allowed = kind === "input" ? 2 : 3;
      for (let i = 0; i < allowed; i++)
        admitLifecycleRequest(path, endpoint, { method: "POST", body });
      assert.throws(
        () => admitLifecycleRequest(path, endpoint, { method: "POST", body }),
        /exhausted/,
      );
      assert.equal(JSON.parse(await readFile(path, "utf8")).requests, allowed);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Consolidation profile accepts native bounded max_tokens and rejects ambiguous bounds", async () => {
  const root = await mkdtemp(join(tmpdir(), "consolidation-budget-"));
  const path = join(root, "ledger.json");
  createLifecycleLedger(path, "consolidation");
  const endpoint = "https://openrouter.ai/api/v1/chat/completions";
  const invoke = (extra: object) =>
    admitLifecycleRequest(path, endpoint, {
      method: "POST",
      body: JSON.stringify({ model: "openai/gpt-6-sol", ...extra }),
    });
  try {
    invoke({ max_tokens: 8192 });
    assert.throws(() => invoke({ max_tokens: 8193 }), /bound denied/);
    assert.throws(
      () => invoke({ max_tokens: 1024, max_completion_tokens: 1024 }),
      /Ambiguous/,
    );
    const ledger = JSON.parse(await readFile(path, "utf8"));
    assert.equal(ledger.profile, "consolidation");
    assert.equal(ledger.requests, 1);
    assert.equal(ledger.outputTokens, 8192);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Consolidation utility adapter adds only the finite output bound; ordinary calls stay unchanged", async () => {
  const { boundConsolidationUtilityRequest } = await import(
    "../src/lifecycle-request-budget.ts"
  );
  const root = await mkdtemp(join(tmpdir(), "utility-bound-"));
  const path = join(root, "ledger.json");
  createLifecycleLedger(path, "consolidation");
  const endpoint = "https://openrouter.ai/api/v1/chat/completions";
  const body = {
    model: "openai/gpt-6-sol",
    messages: [{ role: "user", content: "Synthetic memory fragments" }],
    temperature: 0.3,
  };
  const init = { method: "POST", body: JSON.stringify(body) };
  try {
    const bounded = boundConsolidationUtilityRequest(path, endpoint, init);
    assert.deepEqual(JSON.parse(bounded?.body as string), {
      ...body,
      max_completion_tokens: 2048,
    });
    admitLifecycleRequest(path, endpoint, bounded);
    assert.equal(JSON.parse(await readFile(path, "utf8")).outputTokens, 2048);
    const explicit = {
      method: "POST",
      body: JSON.stringify({ ...body, max_tokens: 1024 }),
    };
    assert.equal(
      boundConsolidationUtilityRequest(path, endpoint, explicit),
      explicit,
    );
    assert.equal(
      boundConsolidationUtilityRequest(path, "https://other.example/api", init),
      init,
    );
    const other = {
      method: "POST",
      body: JSON.stringify({ ...body, model: "other" }),
    };
    assert.equal(
      boundConsolidationUtilityRequest(path, endpoint, other),
      other,
    );
    const ordinary = join(root, "ordinary.json");
    createLifecycleLedger(ordinary);
    assert.equal(
      boundConsolidationUtilityRequest(ordinary, endpoint, init),
      init,
    );
    assert.throws(
      () => admitLifecycleRequest(ordinary, endpoint, init),
      /model\/output/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { Lab, PROJECT } from "../src/lab.ts";
import {
  credentialEnv,
  forwardCredentials,
  nativeModel,
  providerEndpoint,
  redactCredentials,
  secretRef,
  textModelConfig,
  textModelRef,
} from "../src/provider-handoff.ts";
import { modelGate } from "./model-selection.ts";

test("CONFIG: exact env handoff reads only selected credentials, omits missing values", () => {
  const reads: string[] = [];
  const source = new Proxy(
    { SYNTHETIC_PROVIDER_KEY: "dummy-config-value" },
    {
      get(target, key) {
        reads.push(String(key));
        return Reflect.get(target, key);
      },
    },
  );
  assert.deepEqual(forwardCredentials(["SYNTHETIC_PROVIDER_KEY"], source), {
    SYNTHETIC_PROVIDER_KEY: "dummy-config-value",
  });
  assert.deepEqual(reads, ["SYNTHETIC_PROVIDER_KEY"]);
  assert.deepEqual(forwardCredentials(["MISSING_PROVIDER_KEY"], {}), {});
  for (const name of [
    "HOME",
    "PATH",
    "NODE_OPTIONS",
    "OPENCLAW_CONFIG_PATH",
    "HTTPS_PROXY",
    "BASH_ENV",
    "DYLD_INSERT_LIBRARIES",
    "SSL_CERT_FILE",
    "OPENROUTER_BASE_URL",
    "bad-key",
    "",
  ])
    assert.throws(() => credentialEnv(name), /credential env/);
  assert.throws(
    () =>
      forwardCredentials(["SYNTHETIC_PROVIDER_KEY"], {
        SYNTHETIC_PROVIDER_KEY: "invalid\ncredential",
      }),
    /control character/,
  );
});

test("CONFIG: native provider references preserve upstream ownership and mask selected values", () => {
  const model = nativeModel("openrouter/auto", "SYNTHETIC_PROVIDER_KEY");
  assert.equal(textModelRef(model), "openrouter/auto");
  assert.deepEqual(textModelConfig(model), {
    catalogRefresh: { enabled: false },
    providers: { openrouter: { apiKey: secretRef("SYNTHETIC_PROVIDER_KEY") } },
  });
  assert.deepEqual(
    textModelConfig(
      nativeModel("anthropic/synthetic-model", "SYNTHETIC_PROVIDER_KEY"),
    ),
    {
      catalogRefresh: { enabled: false },
      providers: { anthropic: { apiKey: secretRef("SYNTHETIC_PROVIDER_KEY") } },
    },
  );
  assert.equal(
    textModelRef({ baseUrl: "http://127.0.0.1:9999/v1", model: "local" }),
    "lab/local",
  );
  assert.throws(
    () => nativeModel("missing-provider-prefix", "SYNTHETIC_PROVIDER_KEY"),
    /provider\/model/,
  );
  assert.equal(
    providerEndpoint("https://openrouter.ai/api/v1"),
    "https://openrouter.ai/api/v1",
  );
  for (const url of [
    "http://example.com/v1",
    "https://user:secret@example.com/v1",
    "https://example.com/v1?key=x",
    "https://example.com/#x",
  ])
    assert.throws(() => providerEndpoint(url));
  assert.equal(
    redactCredentials("before dummy-config-value after dummy-config-value", {
      SYNTHETIC_PROVIDER_KEY: "dummy-config-value",
    }),
    "before [REDACTED] after [REDACTED]",
  );
});

test("CONFIG: native acceptance remains skipped without an explicit request/budget gate", () => {
  const env = {
    LAB_NATIVE_MODEL_REF: "openrouter/auto",
    LAB_NATIVE_KEY_ENV: "SYNTHETIC_PROVIDER_KEY",
  };
  assert.match(String(modelGate("text", env)), /budget approval/);
  assert.match(
    String(modelGate("text", { ...env, LAB_ALLOW_MODEL_REQUESTS: "1" })),
    /strict spending reservation/,
  );
  assert.match(
    String(
      modelGate("vector", {
        LAB_NATIVE_VECTOR_URL: "https://openrouter.ai/api/v1",
        LAB_NATIVE_VECTOR_MODEL: "synthetic",
        LAB_NATIVE_VECTOR_KEY_ENV: "SYNTHETIC_PROVIDER_KEY",
      }),
    ),
    /budget approval/,
  );
  assert.equal(
    modelGate("text", {
      LAB_MODEL_URL: "http://127.0.0.1:9999/v1",
      LAB_MODEL_NAME: "local",
    }),
    false,
  );
});

test("NATIVE CONFIG: pinned CLI validates env SecretRefs; setup sends zero embedding requests and rollback preserves config", {
  timeout: 120000,
}, async () => {
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.writeHead(500).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const root = await mkdtemp(join(PROJECT, ".lab-test-"));
  const lab = new Lab("config", root);
  try {
    await lab.init();
    assert.deepEqual(
      await lab.configureNativeModel(
        "openrouter/auto",
        "SYNTHETIC_PROVIDER_KEY",
      ),
      {
        configured: "openrouter/auto",
        credentialEnv: "SYNTHETIC_PROVIDER_KEY",
        configurationOnly: true,
      },
    );
    const selected = await lab.configureNativeVector(
      `http://127.0.0.1:${address.port}/v1`,
      "synthetic-embedding",
      "SYNTHETIC_EMBEDDING_KEY",
    );
    assert.equal(selected.needsIndex, true);
    await assert.rejects(lab.index(), /Paid native operations are blocked/);
    await assert.rejects(lab.start(), /Paid Gateway startup is blocked/);
    assert.equal(
      requests,
      0,
      "Configuration and denied operations must not call an embedding model.",
    );
    const path = join(root, "config", "openclaw.json");
    const config = JSON.parse(await readFile(path, "utf8"));
    assert.equal(config.agents.defaults.model.primary, "openrouter/auto");
    assert.equal(config.memory.search.provider, "openai-compatible");
    assert.deepEqual(
      config.models.providers.openrouter.apiKey,
      secretRef("SYNTHETIC_PROVIDER_KEY"),
    );
    assert.deepEqual(
      config.memory.search.remote.apiKey,
      secretRef("SYNTHETIC_EMBEDDING_KEY"),
    );
    assert.deepEqual(config.secrets.providers["bridge-env"].allowlist.sort(), [
      "SYNTHETIC_EMBEDDING_KEY",
      "SYNTHETIC_PROVIDER_KEY",
    ]);
    assert.equal(config.gateway.bind, "loopback");
    await assert.rejects(
      lab.configureNativeModel(
        "unregistered-provider/model",
        "SYNTHETIC_PROVIDER_KEY",
      ),
      /custom model providers/,
    );
    const restored = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(restored, config);
    const settings = await readFile(
      join(root, "config", "settings.json"),
      "utf8",
    );
    assert.doesNotMatch(settings, /dummy-config-value|apiKey/);
    assert.equal(requests, 0);
  } finally {
    await lab.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

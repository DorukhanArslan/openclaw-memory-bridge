import assert from "node:assert/strict";
import { test } from "node:test";
import { Lab } from "../src/lab.ts";
import { forwardNetworkEnvironment } from "../src/network-env.ts";

test("NETWORK: only proxy and CA settings cross the environment boundary", () => {
  const expected = {
    HTTP_PROXY: "http://proxy.invalid:8080",
    HTTPS_PROXY: "http://proxy.invalid:8081",
    ALL_PROXY: "http://fallback.invalid:8080",
    NO_PROXY: "localhost,127.0.0.1,[::1]",
    http_proxy: "",
    https_proxy: "http://lowercase.invalid:8080",
    all_proxy: "",
    no_proxy: "",
    NODE_EXTRA_CA_CERTS: "/synthetic/additional-ca.pem",
    SSL_CERT_FILE: "/synthetic/ca.pem",
    SSL_CERT_DIR: "/synthetic/certs",
  };
  const source = {
    ...expected,
    HOME: "/synthetic/operator-home",
    PATH: "/synthetic/operator-bin",
    UNSELECTED_API_KEY: "synthetic-key-never-forwarded",
    NODE_OPTIONS: "--inspect",
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
    NODE_USE_ENV_PROXY: "1",
    OPENCLAW_CONFIG_PATH: "/synthetic/operator-config",
  };
  const reads: string[] = [];
  const guarded = new Proxy(source, {
    ownKeys() {
      throw new Error("The shell environment must not be enumerated.");
    },
    get(target, name) {
      reads.push(String(name));
      assert.ok(Object.hasOwn(expected, name));
      return Reflect.get(target, name);
    },
  });
  assert.deepEqual(forwardNetworkEnvironment(guarded), expected);
  assert.deepEqual(reads, Object.keys(expected));
  assert.deepEqual(forwardNetworkEnvironment({}), {});
});

test("NETWORK: invalid settings fail without exposing their values", () => {
  for (const value of [
    "synthetic-private-value\n",
    "synthetic-private-value\r",
    "synthetic-private-value\0",
    `synthetic-private-value${"x".repeat(16384)}`,
    42,
  ]) {
    assert.throws(
      () =>
        forwardNetworkEnvironment({
          HTTPS_PROXY: value,
        } as NodeJS.ProcessEnv),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message,
          "Invalid runtime network setting: HTTPS_PROXY.",
        );
        assert.ok(!error.message.includes("synthetic-private-value"));
        return true;
      },
    );
  }
});

test("NETWORK: native log redaction masks authenticated proxy URLs", () => {
  const proxy = "http://synthetic-user:synthetic-password@proxy.invalid:8080";
  const original = {
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    NO_PROXY: process.env.NO_PROXY,
  };
  try {
    process.env.HTTPS_PROXY = proxy;
    process.env.NO_PROXY = "*";
    const lab = new Lab("network-redaction") as unknown as {
      redact(text: string): string;
    };
    assert.equal(
      lab.redact(`Proxy ${proxy} failed; source *.md stays visible; ${proxy}`),
      "Proxy [REDACTED] failed; source *.md stays visible; [REDACTED]",
    );
  } finally {
    for (const name of ["HTTPS_PROXY", "NO_PROXY"] as const) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
});

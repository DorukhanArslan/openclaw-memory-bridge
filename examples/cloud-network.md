# Cloud Networking for Native Memory Processes

The Python SDK starts a bridge process, which starts private OpenClaw CLI and Gateway processes. Each boundary copies only its required runtime settings. Proxy and CA settings must survive both boundaries for remote providers to work in a proxy-only environment.

## Runtime environment contract

These eleven variables are inherited when present:

| Purpose | Variables |
| --- | --- |
| HTTP/S proxy and bypass selection | `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, and their lowercase variants |
| Native CA configuration | `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SSL_CERT_DIR` |

Case and explicit empty values are preserved. For example, an empty lowercase `no_proxy` can override uppercase `NO_PROXY` in the native runtime. Values containing CR, LF, or NUL, non-string values, and values longer than 16,384 characters are rejected before process startup; errors identify the setting without printing its value.

OpenClaw 2026.9.9 owns proxy selection, bypass matching, and its Undici dispatcher. No `NODE_USE_ENV_PROXY` or `NODE_OPTIONS` flag is needed. For the pinned Node runtime, `NODE_EXTRA_CA_CERTS` is the verified mechanism for adding a startup CA. `SSL_CERT_FILE` and `SSL_CERT_DIR` follow Node's existing CA-mode rules; forwarding them does not enable another CA mode.

Keep `127.0.0.1`, `localhost`, and `::1` in the effective native `NO_PROXY`/`no_proxy` value when a proxy is configured, so local providers and Gateway services remain reachable. The bridge preserves the operator's value rather than rewriting it. It never disables TLS verification, copies the full shell environment, or changes explicit provider-credential selection. Proxy URLs are redacted from native child logs because they can contain authentication.

Configure these variables in the cloud runtime or parent process environment. The project's `.env` loader accepts application settings and credentials and rejects network/runtime controls.

## Offline regression checks

From the repository root, with installed dependencies and OpenSSL:

```sh
node_modules/node/bin/node --import ./src/load-env.ts --test tests/network-env.test.ts tests/network-env-native.test.ts
FOUNDATION_ROOT="$PWD" .bootstrap/python/bin/python -m unittest discover -s python/tests -p test_client_network_environment.py -v
```

The Python checks start a real child and verify the exact environment received, including preserved empty values and exclusion of unrelated credentials and runtime controls.

The native test starts a local CONNECT proxy and an ephemeral HTTPS embedding fixture for `synthetic-embedding.invalid`. Only the isolated test configuration points at that fixture; production endpoint guards and spending gates are unchanged. The actual OpenClaw indexing CLI must reach CONNECT, reject untrusted TLS before sending an embedding body, then index successfully after receiving the additional CA. No external provider or model inference is used.

## Cloud verification scope

A no-key metadata probe can additionally verify the real platform route from a private native process. The November 1 local validation used an isolated Gateway, enabled only the diagnostic `web_fetch` tool with native `tools.web.fetch.useTrustedEnvProxy: true`, disabled its cache, and fetched `https://registry.npmjs.org/-/ping` with a `200` response. The production memory tool policy was unchanged. This explicit web-fetch opt-in is separate from model-provider transport's native environment-proxy handling.

The local HTTPS embedding control and cloud metadata request establish transport and trust behavior. They do not establish live inference, provider authorization, semantic quality, or an available spending reservation. Those remain separate model-acceptance prerequisites.

## Native provider quota requests

The pinned native `status --usage` command bypasses OpenClaw's usual managed-proxy startup. Its OpenRouter quota helper also pins destination DNS before selecting its transport. In a proxy-only environment this can report `Usage unavailable` even when the same credential succeeds through the platform proxy.

The private bootstrap handles this specific compatibility gap by starting OpenClaw's own managed proxy owner before the exact read-only quota command. It uses the effective runtime HTTP/S proxy in memory, respects native proxy bypass selection, and pins the native helper sources before importing them. It does not forge the managed-proxy state flag, store a proxy URL or credential in configuration, modify the installed native sources, or activate this workaround for Gateway, indexing, or other CLI commands. Native TLS and destination policy remain in effect.

With the existing approved 50 USD key cap, inspect fresh quota metadata without inference:

```sh
npm run budget:preflight -- --key-limit-confirmed --provider-limit=50
```

This command intentionally exits with code 3 even when the snapshot is eligible, because a quota snapshot does not open general paid acceptance. Inspect its structured result. The general/cumulative profile rejects periodic key limits. Preserve consumed ledgers and historical evidence when selecting a new run.

## One-run fixed smoke

The existing finite smoke has its own approved request/token envelope and an estimated cost of 0.02232704 USD. A periodic provider quota does not change that one-run estimate. Use the separate one-run entry only for the explicitly approved current connectivity/semantic check:

```sh
npm run smoke:bounded
```

The real-provider path preserves the observed quota period and labels its usage as the current reset window when applicable. It checks fresh native metadata, the exact confirmed cap, USD usage, and minimum headroom. It does not infer lifetime spending from a weekly or monthly counter, and its cost estimate is not a hard cap.

Before the first possible inference request, it exclusively creates `.lab/one-run-smoke-admission.json` with private permissions and durable writes. Existing, malformed, or uncertain admissions deny another run. The path is fixed across temporary lab roots; it is never deleted or renamed for automatic replay. A successful result is retained in `.lab/one-run-smoke-result.json`; failures keep the diagnostic lab root and the consumed admission. The fixture-only dummy provider path does not consume this live approval.

Generic `inspectBudget`, the shared `smokeBudget`, larger lifecycle/maintenance profiles, and the original MODEL-01 cumulative-budget wrapper retain their existing rules. In particular, this one-run result does not replace MODEL-01's stronger cumulative-spend claim or open general paid acceptance. Disabling a provider reset is unnecessary for this separate finite check and cannot reconstruct missing historical test spending.

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

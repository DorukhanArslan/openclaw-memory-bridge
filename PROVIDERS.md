Current fixed acceptances used native GPT-6 Sol and embeddings under the separate 5 USD test budget and reported 50 USD key cap. The chat/embedding smoke passed; genuine lifecycle extraction/flush passed separately, while model consolidation remains unverified. Paid acceptance is now closed for this checkpoint; the broader paid suites below remain blocked. See [SMOKE.md](SMOKE.md) and [LIFECYCLE.md](LIFECYCLE.md).

# Use OpenClaw providers

OpenClaw owns providers, model transport, authentication and SecretRef resolution. The bridge passes native model references and selected environment names. It contains no OpenRouter SDK, provider HTTP client or parallel model registry. This path is checked against OpenClaw **2026.9.9** and Node **24.16.0**.

For an existing Gateway, its operator uses native [provider setup](https://docs.openclaw.ai/providers/openrouter), [authentication](https://docs.openclaw.ai/gateway/authentication) and [secrets tools](https://docs.openclaw.ai/gateway/secrets). The ready client receives only the Gateway token. It receives no provider key and changes no provider settings. Native OAuth, file/exec/store secret readers and providers requiring extra endpoint/account configuration remain with the Gateway operator.

## Configure the project environment locally

Use the full installation. A keyless `.env` was prepared locally with owner-only permissions. It is ignored by Git. Edit it locally and place your key after `OPENROUTER_API_KEY=`. Never paste a credential into chat or a command argument. For a fresh clone with no `.env`, create the private file once without replacing an existing file:

```bash
(umask 077; set -C; cat .env.example > .env)
nano .env
```

The bridge's application adapter loads only the repository-root `.env`; it never discovers `.env.local`, your home credentials or a file in the current working directory. It uses the pinned Node runtime's dotenv parser without shell evaluation or variable expansion. Existing environment settings, including empty ones, are preserved. Supported settings are the existing `LAB_MODEL_*`, `LAB_VECTOR_*`, native model/vector selectors, `LAB_ALLOW_MODEL_REQUESTS`, and `BRIDGE_GATEWAY_URL`, `BRIDGE_GATEWAY_TOKEN`, `BRIDGE_AGENT_ID`, plus explicit provider credential names ending in `_KEY`, `_TOKEN` or `_SECRET`. Runtime controls such as `NODE_OPTIONS`, `HOME`, proxies and `OPENCLAW_*` are rejected with a sanitized error. The file must be regular, at most 64 KiB, and cannot be a symlink. This `.env` loading is an application adapter, not a native OpenClaw memory feature.

`npm start`, `npm run lab`, `npm run serve`, all `npm test`/`test:*` commands, the TypeScript examples and the bounded-smoke script use the same project file. The ready-Gateway example also loads its URL/token from it. Keyword mode and dummy-provider tests need no key. A selected real operation checks required setting names before native execution; missing or empty settings report names only. Configuration-only native model/vector handoff may still store references without a credential value.

To prepare a native model reference without a provider request:

```bash
npm run lab -- native-model alpha openrouter/auto OPENROUTER_API_KEY
```

The command stores a model reference and env SecretRef, then runs native `config validate`. It does not start a Gateway, index notes or send a provider request. `openrouter/auto` is the native setup selector in this example; select an explicit tool-capable model and approve a budget before genuine model acceptance. Configuration does not prove successful authentication, tool support, extraction or consolidation.

The native provider overlay has this shape:

```json
{
  "secrets": {
    "providers": {
      "bridge-env": { "source": "env", "allowlist": ["OPENROUTER_API_KEY"] }
    }
  },
  "models": {
    "catalogRefresh": { "enabled": false },
    "providers": {
      "openrouter": {
        "apiKey": { "source": "env", "provider": "bridge-env", "id": "OPENROUTER_API_KEY" }
      }
    }
  },
  "agents": { "defaults": { "model": { "primary": "openrouter/auto", "fallbacks": [] } } }
}
```

The bundled provider supplies its endpoint and catalog. Other bundled API-key providers use `native-model WORKSPACE PROVIDER/MODEL KEY_ENV` and are validated by OpenClaw. Unsupported overlays are rejected by the native schema and the previous lab configuration is restored. Providers needing additional configuration use an independently configured Gateway rather than a bridge registry.

The bridge forwards only selected credential names to its isolated children. Its HOME, state, config, PATH and loopback binding remain under lab ownership; proxies and runtime controls are not forwarded. Settings/config persist references, not key values. Command/tool/log output masks exact selected credential values as an additional safeguard. This is not a secret vault or tenant security boundary.

Project `.env` and `.env.*` files are ignored by Git; only the keyless `.env.example` is tracked. OpenClaw blocks provider credentials from its own workspace dotenv files. The bridge loads the trusted project file into its process, then forwards only the explicitly selected credential name into the private native child process. OpenClaw still owns provider transport and SecretRef resolution. Existing Gateway credentials remain under its operator's native secret management. Loading `.env` does not grant paid-run admission or change provider/account settings. Remove an empty exported key if you intend to use the file value; the loader deliberately does not override it.

## Embeddings are separate

Selecting a chat model does not select an embedding model. The pinned engine supports native `memory.search.provider: openai-compatible` with a separate model, base URL and env SecretRef:

```text
npm run lab -- native-vector WORKSPACE HTTPS_OR_LOOPBACK_URL EMBEDDING_MODEL KEY_ENV
npm run lab -- validate-config WORKSPACE
```

These commands validate configuration only and return `needsIndex: true`. Indexing is a separate explicit action that can incur charges. HTTPS remote embedding endpoints are accepted only in this selected path. Existing `model URL MODEL` and `vector URL MODEL` commands remain for local unauthenticated servers.

OpenRouter chat configuration alone does not prove that a chosen embedding model/endpoint works. The fixed approved `openai/text-embedding-3-small` smoke passed genuine semantic recall; other embedding selections and the broader optional vector tests remain unaccepted. The ready Gateway client uses its owner's native embedding providers without a bridge provider filter.

## Acceptance gates

The four genuine model checks remain skipped without explicit selection:

| Path | Selection variables |
| --- | --- |
| Local chat | `LAB_MODEL_URL`, `LAB_MODEL_NAME` |
| Native provider chat | `LAB_NATIVE_MODEL_REF`, `LAB_NATIVE_KEY_ENV` |
| Local embeddings | `LAB_VECTOR_URL`, `LAB_VECTOR_MODEL` |
| Native compatible embeddings | `LAB_NATIVE_VECTOR_URL`, `LAB_NATIVE_VECTOR_MODEL`, `LAB_NATIVE_VECTOR_KEY_ENV` |

Native paid acceptance is now blocked even with `LAB_ALLOW_MODEL_REQUESTS=1`: the pinned usage interface cannot establish a strict total spending boundary. Credential-backed native indexing and managed Gateway startup are also denied before dispatch. The approved model pair and smallest configuration/quota diagnostic are in [BUDGET.md](BUDGET.md). Configuration tests use dummy values and a loopback HTTP counter; they do not prove semantic retrieval or consolidation. Chat/flush/dreaming requires a genuine tool-capable model; embedding tests require a genuine embedding model.

See [VERIFICATION.md](VERIFICATION.md) for results. Live documentation can change; the pinned native schema and CLI determine support for this project.

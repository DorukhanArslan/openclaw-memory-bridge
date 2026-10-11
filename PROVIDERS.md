# Use OpenClaw providers

OpenClaw owns providers, model transport, authentication and SecretRef resolution. The bridge passes native model references and selected environment names. It contains no OpenRouter SDK, provider HTTP client or parallel model registry. This path is checked against OpenClaw **2026.9.9** and Node **24.16.0**.

For an existing Gateway, its operator uses native [provider setup](https://docs.openclaw.ai/providers/openrouter), [authentication](https://docs.openclaw.ai/gateway/authentication) and [secrets tools](https://docs.openclaw.ai/gateway/secrets). The ready client receives only the Gateway token. It receives no provider key and changes no provider settings. Native OAuth, file/exec/store secret readers and providers requiring extra endpoint/account configuration remain with the Gateway operator.

## Enter a key locally

Use the full installation. From this repository, open a private Bash session and enter the key at the hidden prompt:

```bash
bash --noprofile --norc
set +x
IFS= read -r -s -p 'OpenRouter API key: ' OPENROUTER_API_KEY
printf '\n'
export OPENROUTER_API_KEY
npm run lab -- native-model alpha openrouter/auto OPENROUTER_API_KEY
unset OPENROUTER_API_KEY
exit
```

Paste the key only at the prompt, never into chat, a command argument or a committed file. The prompt suppresses terminal echo; the value is not a shell-history command. This temporary process environment is the native secret source. No provider credential file is written. Close the private shell if input is cancelled. Avoid screen sharing, shell tracing and terminal recording during input.

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

Project `.env` and `.env.*` files are ignored by Git but are not loaded by the bridge. OpenClaw also blocks provider credentials from workspace dotenv files. Use the trusted process environment or the existing Gateway owner's authorized native secret management. The bridge does not discover other user credential files. After `unset`, later model operations need the selected value supplied again in their authorized process environment.

## Embeddings are separate

Selecting a chat model does not select an embedding model. The pinned engine supports native `memory.search.provider: openai-compatible` with a separate model, base URL and env SecretRef:

```text
npm run lab -- native-vector WORKSPACE HTTPS_OR_LOOPBACK_URL EMBEDDING_MODEL KEY_ENV
npm run lab -- validate-config WORKSPACE
```

These commands validate configuration only and return `needsIndex: true`. Indexing is a separate explicit action that can incur charges. HTTPS remote embedding endpoints are accepted only in this selected path. Existing `model URL MODEL` and `vector URL MODEL` commands remain for local unauthenticated servers.

OpenRouter chat configuration alone does not prove that a chosen embedding model/endpoint works. Genuine embedding acceptance remains pending endpoint/model selection and budget approval. The ready Gateway client uses its owner's native embedding providers without a bridge provider filter.

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

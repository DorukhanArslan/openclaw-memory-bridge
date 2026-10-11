# OpenClaw memory bridge Python client

This package is a client. The existing TypeScript bridge and OpenClaw 2026.9.9 do the memory work. Install the foundation runtime first with `bash scripts/install.sh` at the repository root. Python 3.10 or newer is required.

Build and install locally:

```sh
python -m pip install build
python -m build python
python -m pip install python/dist/openclaw_memory_bridge-0.1.0-py3-none-any.whl
```

Installing this wheel creates no memory Markdown files. Your app must connect to the bridge and supply data:

```python
from openclaw_memory_bridge import BridgeConfig, MemoryClient, MemoryScope

scope = MemoryScope(workspace="lab", user="alex", session="chat-one")
with MemoryClient(BridgeConfig(foundation="/path/to/foundation", root="/path/to/app-data")) as memory:
    memory.write(scope, "preference", "Synthetic Vega uses amber filters on Friday.")
    memory.index(scope)
    hits = memory.search(scope, "amber")["results"]
    context = "\n".join(f'{hit["path"]}:{hit["startLine"]} {hit["snippet"]}' for hit in hits)
    prompt = f"Use these recalled sources:\n{context}\nQuestion: Which filter does Vega use?"
    # Pass prompt to your selected model in your app. The SDK does not send it.
```

`MemoryScope` uses workspace and user IDs to derive a stable native workspace route. Session selects the native session key. This is an application routing adapter. It is not user authentication or an enterprise security boundary. Use one trusted local operator. All IDs use lowercase letters, digits, and hyphens, with a letter first.

`write` and `delete` change application-owned Markdown notes. Call `index` after each change. Native `memory_search` and `memory_get` return the engine results and file references. `restart` replaces the private Gateway. Reconnect with the same root to retain notes and indexes.

`configure(scope, ingestion=True)` enables the native session-memory reset hook. `inject_fixture` adds an explicit synthetic transcript fixture. It does not create a model response. `session_history`, `session_state`, and `reset_session` call native Gateway methods. `dream_status` and `dream_diary` inspect native lifecycle data. They do not trigger a paid model. These operations use the existing bridge.

Automatic extraction, flush, and consolidation require the configured native agent lifecycle. The installed SDK does not promise these actions after every message. The finite paid acceptance example is a separate operator test. This SDK does not add a generic paid-chat or consolidation endpoint.

Errors have a `code` and a readable message. A timeout does not prove completion. Close the client after a transport timeout, then inspect the stored state before retry. The request stream is serialized. Close the client or use a `with` block to stop its owned processes. Credentials and Gateway tokens are not arguments to this SDK.

Run the separate app test after installing the wheel:

```sh
python examples/sdk_app.py --foundation /path/to/foundation --root /path/to/test-data
```

The repository includes this example. Use synthetic data only.

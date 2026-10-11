# Foundation process contract v1

This is a local JSON-lines adapter around the pinned OpenClaw runtime. It does not implement memory algorithms, expose a public HTTP server or accept provider credentials. Use synthetic data. Model chat/flush/dreaming controls remain in the developer CLI; this small external contract covers file-memory CRUD/recall only.

```bash
node_modules/node/bin/node src/stdio.ts /absolute/path/to/synthetic-state
# Equivalent interactive entry (npm adds its own banner, so consumers invoke Node directly):
npm run serve -- /absolute/path/to/synthetic-state
```

The first stdout line is `{ "v": 1, "event": "ready", "engine": { "name": "openclaw", "version": "2026.9.9" }, "pid": 123 }`. It means the adapter is ready; it does not mean a Gateway or corpus has been initialized. Every subsequent stdin/stdout line is one JSON object. Requests execute sequentially. The caller supplies a unique nonempty string `id` (≤128 characters); responses echo it. Maximum request size is 128 KB; notes are limited to 64 KB by the existing adapter.

```json
{"v":1,"id":"1","op":"write","workspace":"alpha","args":{"noteId":"observatory","text":"Synthetic Aurora uses cobalt telescopes."}}
{"v":1,"id":"2","op":"index","workspace":"alpha"}
{"v":1,"id":"3","op":"search","workspace":"alpha","args":{"query":"cobalt"}}
{"v":1,"id":"4","op":"shutdown"}
```

Success: `{ "v": 1, "id": "3", "ok": true, "result": ... }`. Errors: `{ "v": 1, "id": "3", "ok": false, "error": { "code": "invalid_request|engine_error", "message": "..." } }`. Malformed JSON cannot provide a request identity, so its error has `id: null`. Errors are never converted to empty search hits. Native result fields are retained; the adapter does not invent scores or citations.

| Operation | Arguments | Behavior |
| --- | --- | --- |
| `write` | `noteId`, `text` | App-owned canonical Markdown write/update. Requires subsequent `index`. |
| `delete` | `noteId` | App-owned Markdown deletion; missing source is an error. Requires subsequent `index`. |
| `index` | none | Official `memory index --force --agent main`; stops that workspace's Gateway first. |
| `search` | `query`, optional `session` | Native `memory_search` via authenticated private Gateway. `result.results` contains native paths, line ranges, scores and snippets. |
| `get` | `path`, optional `from`/`lines` | Native `memory_get`; relative lab source paths only. |
| `status` | none | Official native memory status. |
| `restart` | none | Replaces the workspace's actual Gateway and verifies native memory readiness. |
| `shutdown` | none | Closes tracked native processes and workspace locks, then exits. EOF/signals also close the host. |

Workspace IDs use 1–48 lowercase letters/digits/hyphens, starting with a letter; default is `alpha`. Each uses independent native state/workspace/home under the caller-selected root. Corpus routing is not enterprise tenant security. The caller owns exclusive use of this root; a second host for the same workspace is rejected by its lock. The host remains alive across requests, and a Gateway starts on demand even for no-key search. At most one workspace Gateway is active in this sequential host; switching workspace stops the previous Gateway, so the next search includes startup cost. Native state remains persistent. Child environments retain isolated HOME/state/runtime controls. Only credential names explicitly selected through the managed lab’s native configuration are forwarded; the contract does not discover personal provider credentials. The external contract does not configure models; use a fresh root for repeatable keyword comparisons.

The Python standard-library consumer in `examples/python_consumer.py` uses direct process spawning, request correlation, bounded response waits and explicit shutdown. It is an adapter only:

```python
from pathlib import Path
from python_consumer import FoundationClient

with FoundationClient(Path("/path/to/foundation"), Path("/path/to/synthetic-state")) as client:
    client.call("write", noteId="observatory", text="Synthetic cobalt telescopes.")
    client.call("index")
    result = client.call("search", query="cobalt")
```

Run `python3 examples/python_consumer.py` for its real-engine smoke scenario or `npm run test:protocol` for automated acceptance. A host restart means closing/recreating the client with the same root; `restart` alone replaces only its Gateway. Deletion removes current source hits after native reindex, not previously promoted copies, diaries/backups or secure erasure. The supported boundary is OpenClaw CLI/Gateway, with explicit version coupling to `2026.9.9`; there are no private memory module imports.

## Python SDK lifecycle inspection additions

Protocol v1 also supports `configure` with boolean `args.ingestion`; `fixture` with explicit synthetic `args.session` and `args.text`; `session_history`, `session_state`, and `session_reset` with `args.session`; and read-only `dream_status` / `dream_diary`. Fixture injection returns `modelExecuted: false`. Native reset capture requires ingestion enabled. These operations call existing native methods and hooks; they do not synthesize extraction.

The installed Python SDK maps the caller's workspace/user pair to a stable local route and passes the session key for recall and lifecycle inspection. This is routing only. It provides no user authorization boundary. Each client owns its sequential JSONL stream and private process. Close it after a transport timeout before deciding whether to retry an uncertain operation. The SDK supplies no general paid-chat or dream-write endpoint.

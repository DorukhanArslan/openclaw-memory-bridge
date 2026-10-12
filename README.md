# OpenClaw memory foundation

This project lets you test OpenClaw's existing memory engine through a local TypeScript bridge and Python client. An agent can recall saved facts with source lines, keep them across sessions, and inspect how native memory maintenance changes them.

**OpenClaw 2026.9.9**, **Node 24.16.0**. Synthetic data; trusted local operator.

## Features

- Native keyword search, optional semantic search, exact source reads, and persistent SQLite indexes.
- Application note write, update, and delete. Separate workspace/user routes.
- Native agent profile and daily notes, reset capture, flush, compaction, and light → REM → deep dreaming. The lab exposes operator controls; the Python SDK exposes memory access and lifecycle inspection.
- A managed private Gateway, a sequential JSONL bridge, and a read-only client for an existing loopback Gateway.

## One memory story

Maya is a fictional gardener. She plans at 08:00, waters orchids on Monday, and changes her drink from mint tea to rooibos tea.

> User: “Please finish the preference update I just requested: my current morning drink is rooibos tea, not mint tea. Keep the existing gardener details and orchid schedule.”
>
> Real bot: “Updated: your current morning drink is rooibos tea, not mint tea. I kept your gardener details and Monday orchid-watering schedule.”

The native agent edits `USER.md`. In a new session it answers “rooibos tea” and “Monday”, citing `USER.md#L6-L7`. Native dreaming then promotes the orchid event from the daily note into `MEMORY.md`.

Follow the [conversation and file changes](reports/chatbot-memory-demo.html). The [case payload](reports/memory-story.json) includes real inputs/outputs, triggers, changes, gains, and gaps from labelled runs. Cases are a learning path, **not one continuous run**.

| Case and gain | Actual evidence and boundary |
| --- | --- |
| 1. Load context before reply | Maya: `USER.md` injects 262 characters. `BOOTSTRAP.md` is absent; other missing templates have placeholders. |
| 2. Keep profile and daily event | Maya: native tools change `USER.md` and a dated note. No harness prewrite. |
| 3. Keyword recall + source | Maya: native search/get pass. Python search passes; `get("USER.md")` rejects that path. |
| 4. Semantic recall + source | Separate Zephyr run: “pedal-powered commuting” finds a bicycle note with real embeddings. No search-time bot reply. |
| 5. Change preference | Maya: mint → rooibos; new-session recall passes. Native lineage supersession remains unverified. |
| 6. Flush and compact context | Separate Borealis run: flush writes a daily note; compaction commits a summary. Maya's flush was not observed. |
| 7. Capture/reset session | Separate Borealis run: native hook writes a dated capture. SDK fixtures are not generated chat. |
| 8. Maintain durable memory | Maya: light/REM/deep adds one sourced event. Separate Vega run verifies duplicate merge and three model diary phases. |
| 9. Recall after maintenance/restart | Maya: SDK context → real native `llm-task` answer; post-dream agent turn blocked. Separate Vega restart recall passes. |
| 10. Update/delete and scopes | Fresh SDK checks pass after reindex. Copies/backups remain outside note deletion. Routes are not authentication. |

## Start without a key

From the repository root:

```sh
bash scripts/install.sh
npm start
```

At the prompt: `note sample Synthetic Maya uses cobalt labels.`, `index`, `search cobalt`, `get memory/sample.md`, `restart`. `use beta` selects another corpus. `help` lists controls. `npm run demo` runs the short example.

## Minimal Python app

Python 3.10 or newer is required. Install the local client:

```sh
python3 -m venv .bootstrap/python
.bootstrap/python/bin/python -m pip install ./python
```

Run this code from the repository root with that Python:

```python
from pathlib import Path
from openclaw_memory_bridge import BridgeConfig, MemoryClient, MemoryScope

scope = MemoryScope("greenhouse", "maya", "morning")
with MemoryClient(BridgeConfig(Path.cwd(), Path.cwd() / ".lab" / "sdk")) as memory:
    memory.write(scope, "tea", "Synthetic Maya prefers rooibos tea.")
    memory.index(scope)
    hits = memory.search(scope, "rooibos")["results"]
    context = "\n".join(
        f"[{h['path']}:L{h['startLine']}-L{h['endLine']}]\n{h['snippet']}"
        for h in hits
    )
    print(context)
    # Your app supplies this context to its model. The SDK does not send chat.
```

Call `index` after `write` or `delete`. Reuse the root for persistence. Close the client after a transport timeout before retry decisions.

## Native, SDK, and operator scope

OpenClaw owns retrieval, storage, provenance, and agent maintenance. Adapters own note writes, routing, processes, and prompt insertion. The SDK adds status/restart and session/dreaming inspection. It has no chat, flush, compaction, or consolidation trigger.

The [ready Gateway client](src/gateway.ts) only searches and reads an existing loopback Gateway. Use `bash scripts/install.sh --client-only` and [the example](examples/ready_gateway.ts). Supply `BRIDGE_GATEWAY_URL` and `BRIDGE_GATEWAY_TOKEN` through the authorized server environment. JSONL operations are defined in [src/stdio.ts](src/stdio.ts).

“All features” means the pinned builtin Memory Core and this bridge's access paths. The [inventory](reports/memory-capabilities.json) also identifies untested ranking, provenance, backfill, policy/forget, extra-path, CJK, and multimodal options. Active-memory, Honcho, LanceDB, and wiki integrations are outside this lab.

## Limits and checks

Embeddings and maintenance can need a model. `vector` selects a local embedding endpoint; approved provider selection uses native configuration and an environment SecretRef. Keep keys in ignored `.env` and tokens on the server. Services stay on loopback. There is no invented memory-write endpoint.

A diary can retain an old preference; it is not current truth. A complete Maya chat → flush → compaction → post-dream agent run remains unverified. Consumed ledgers stay intact. The cumulative 5 USD test limit permits no new full flush run. A 50 USD key cap is not test approval.

```sh
npm run typecheck
npm run lint
npm test
```

Tests distinguish real engine checks, transport fixtures, recorded model evidence, and live-model skips. See [coverage](reports/memory-case-coverage.json) and [test rounds](reports/test-report.html). [Runtime licenses and notices](THIRD_PARTY.md) remain intact.

Upstream: [builtin memory](https://docs.openclaw.ai/concepts/memory-builtin), [embedding](https://docs.openclaw.ai/gateway/embedding), [Gateway tools](https://docs.openclaw.ai/gateway/tools-invoke-http-api). The inventory checks the pinned release.

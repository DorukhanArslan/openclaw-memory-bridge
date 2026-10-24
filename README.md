# OpenClaw memory bridge

This project lets you test OpenClaw's existing memory engine through a local TypeScript bridge and Python client. An agent can recall saved facts with source lines, keep them across sessions, and inspect how native memory maintenance changes them.

**OpenClaw 2026.9.9**, **Node 24.16.0**. Synthetic data; trusted local operator.

## Features

- Native keyword search, optional semantic search, exact source reads, and persistent SQLite indexes.
- Application note write, update, and delete. Separate workspace/user routes.
- Native agent profile and daily notes, reset capture, flush, compaction, and light → REM → deep dreaming. The lab exposes native agent lifecycle controls; the Python SDK exposes memory access, daily notes, manual dreaming and maintenance inspection.
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
| 5. Change preference | Maya: mint → rooibos; new-session recall passes. Native supersession is unavailable through this version’s SDK Markdown path: indexing supplies no `supersedesKey` lineage. |
| 6. Flush and compact context | Maya continuation: native flush succeeds; compaction commits (9,447 → 1,182 tokens). Daily note writes are attributed to agent tools; summary can describe older state. |
| 7. Capture/reset session | Separate Borealis run: native hook writes a dated capture. SDK fixtures are not generated chat. |
| 8. Maintain durable memory | Maya: light/REM/deep adds one sourced event. Retained Vega corpus: installed SDK continuation verifies native duplicate merge (Added 0 / Merged 1 / Superseded 0), new source and restart recall; diary publication is checked separately. |
| 9. Recall after maintenance/restart | Maya continuation: new native agent session after dreaming/restart recalls rooibos, Monday, and the thermometer event with sources. Earlier blocked turn stays recorded. |
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

Call `index` after `write` or `delete`. Reuse the root for persistence. Close the client after a transport timeout before retry decisions. `run_maintenance` reserves a 40-minute response window for native polling and publication bounds; ordinary operations keep `BridgeConfig.timeout`. Reports redact workstation paths before JSON/HTML output.

## Independent host-agent example

[The example](examples/host_agent.py) runs a real Python model/tool loop using only the installed public SDK for memory. It writes and updates synthetic Maya’s notes, starts fresh host sessions, runs native dreaming, restarts the Gateway, and checks separate user/workspace corpora. [The latest report](reports/host-agent-memory.html) shows actual calls, source results, native receipts and the earlier diary interruption alongside its correction.

From an independent directory, with Python 3.10+:

```sh
FOUNDATION=/absolute/path/to/openclaw-memory-foundation
python3 -m venv .venv
.venv/bin/python -m pip install "$FOUNDATION/python" python-dotenv==1.2.1
cp "$FOUNDATION/examples/host_agent.py" agent.py
.venv/bin/python agent.py --foundation "$FOUNDATION" --root data --report report.json
```

This paid example uses the explicitly approved foundation `.env` through a local loader, never browser code. Its host and native ledgers retain attempted requests across restarts; do not reset them to replay tests. The fixed maintenance profile checks cumulative provider usage and both finite request envelopes before dispatch. It is a developer trial, not an account-wide atomic spending reservation.

The [SDK consolidation record](reports/sdk-consolidation.json) continues the retained synthetic Vega corpus through the installed client’s public `call` API. Native consolidation replaces the old duplicate’s source, retains unrelated entries and survives restart. It does not count append-only promotion or diary text as a merge. [The acceptance script](examples/sdk_consolidation_acceptance.py) requires that retained fixture and refuses replay of a consumed continuation ledger.

OpenClaw 2026.9.9 requires a candidate `supersedesKey` and matching durable lineage to accept old-fact supersession. Its Markdown indexing branch emits no such key, and the SDK has no trusted lineage setter. Preference-note replacement is supported; native lineage supersession through this SDK path is **unsupported**. No provenance or database edits are used to bypass that boundary.

The native session reader also produces only origin, session kind and observation time; session ingestion forwards those values without producing a supersession key. Running an additional native agent therefore does not establish the missing lineage contract. The [native supersession audit](reports/native-supersession-audit.json) records the inspected paths and remaining acceptance cases. Completing automatic Ankara → Istanbul retirement requires an upstream-supported producer of trusted supersession metadata (or a verified release that supplies one). The documented `USER.md` preference-editing convention is a separate agent file-edit path; it does not prove automatic fact retirement by dreaming or current-versus-history filtering in search.

Read-only comparison on October 17 also found no supported producer in the official `extended-stable` 2026.9.33, `latest` 2026.10.4 or `beta` 2026.10.10-beta.1 archives. Focused upstream source inspection at `51aa1b76d5d3dde7b4972e09f28f6495b081a7d6` retains the same ingestion gap. The audit includes verified archive integrities, source hashes and the required upstream integration contract. No dependency upgrade was performed; upgrading alone is not an established fix.

## Native, SDK, and operator scope

OpenClaw owns retrieval, storage, provenance, and agent maintenance. Adapters own note writes, routing, processes, and prompt insertion. The SDK adds daily-note writes, status/restart, session/dreaming inspection, and explicit `configure_maintenance` / `run_maintenance` / `explain_promotion`. The native run stages canonical daily notes, triggers OpenClaw’s managed dreaming job, and observes its real diary publishers before shutting down. Scheduling stays manual; one retained finite request ledger is shared by the SDK root. Model configuration is currently the approved OpenRouter GPT-6 Sol lab profile.

The primary agent and tool loop stay in your Python app. The SDK has no chat wrapper. Native flush and compaction manage OpenClaw-owned sessions; external Python message history remains the host’s responsibility. A daily-note write is an application checkpoint, not a native flush. Supplied scope IDs are trusted routing inputs; your host supplies authentication and deployment isolation.

Ready host adapters are included: `MemoryTools(client, scope, day)` provides tool definitions and dispatch; `MaintenanceJob(client, scope)` calls native maintenance from your scheduler. The existing host agent uses these adapters. Run the real residence test or a finite maintenance schedule from this repository with the installed Python client and `python-dotenv`:

```sh
python examples/residence_acceptance.py --foundation "$PWD" --root "$PWD/.lab-test-residence" --report reports/residence-memory.json
python examples/host_maintenance.py --foundation "$PWD" --root "$PWD/.lab-test-residence/memory" --workspace residence-lab --user synthetic-maya --runs 1 --host-reserve-usd 11.611008
```

The residence test asks the model to update Ankara to Istanbul in the canonical profile, retain dated history, run native maintenance and recall facts after a bridge process restart. It refuses replay of a consumed host ledger. This tests explicit agent writes; it is not formal supersession. The scheduler has no daemon or automatic retries. The [English HTML report](reports/residence-memory.html) includes actual source, conversation and maintenance receipts; the JSON receipt is next to it.

The deeper [native/SDK comparison](reports/native-sdk-parity.html) separates request and source fidelity from product behavior. Both real chats recalled Istanbul and jasmine tea; one native deep diary in the SDK run degraded. The report retains that failure, exact replay evidence, the lost-write-ack test, and clean-consumer reproduction commands. No production SDK change or exactly-once guarantee is claimed.

The October 23 SDK closeout keeps the original 19/20 failure. A later matched run published light, REM and deep diaries without a production SDK fix. The original failure did not reproduce under healthy admission; its cause remains unresolved. The report separates this result from the budget-denied diagnostic and records fresh wheel and regression checks. Your host still owns scheduling, conversation context, flush policy and recovery; formal old-fact supersession remains unsupported through this path.

The [Diary closeout audit](reports/sdk-diary-closeout-audit.json) separates new offline experiments from prior model evidence. Thirty-six controls used the real native Diary/scope/resource code, with a fixture completion; half also used the native background queue. Closing an inherited owner before resource registration produced the native error and fallback without a budget denial. This is a possible mechanism, not proof of the original cause or an SDK defect.

The [ready Gateway client](src/gateway.ts) only searches and reads an existing loopback Gateway. Use `bash scripts/install.sh --client-only` and [the example](examples/ready_gateway.ts). Supply `BRIDGE_GATEWAY_URL` and `BRIDGE_GATEWAY_TOKEN` through the authorized server environment. JSONL operations are defined in [src/stdio.ts](src/stdio.ts).

“All features” means the pinned builtin Memory Core and this bridge's access paths. The [inventory](reports/memory-capabilities.json) also identifies untested ranking, provenance, backfill, policy/forget, extra-path, CJK, and multimodal options. Active-memory, Honcho, LanceDB, and wiki integrations are outside this lab.

## Limits and checks

Embeddings and maintenance can need a model. `vector` selects a local embedding endpoint; approved provider selection uses native configuration and an environment SecretRef. Keep keys in ignored `.env` and tokens on the server. Services stay on loopback. There is no invented memory-write endpoint.

A diary or compacted summary can describe an old preference; check the current saved source. The linked Maya continuation now verifies native flush, compaction, and agent recall after dreaming/restart. Earlier failures remain visible. Live model tests require explicit configuration and a spending limit.

```sh
npm run typecheck
npm run lint
npm test
```

Tests distinguish real engine checks, transport fixtures, recorded model evidence, and live-model skips. See [coverage](reports/memory-case-coverage.json) and [test rounds](reports/test-report.html). [Runtime licenses and notices](THIRD_PARTY.md) remain intact.

Upstream: [builtin memory](https://docs.openclaw.ai/concepts/memory-builtin), [embedding](https://docs.openclaw.ai/gateway/embedding), [Gateway tools](https://docs.openclaw.ai/gateway/tools-invoke-http-api). The inventory checks the pinned release.

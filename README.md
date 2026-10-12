# OpenClaw memory foundation

A small developer lab and server-side bridge to OpenClaw's existing TypeScript memory engine. It uses a private loopback Gateway, native `memory_search`/`memory_get` and the native index. Tested runtimes: **OpenClaw 2026.9.9**, **Node 24.16.0**. Use synthetic data only.

## Run locally without a key

From this project directory, dependencies are already installed on the development computer:

```bash
./node_modules/node/bin/node src/cli.ts shell
```

On a fresh copy, first run `bash scripts/install.sh` with npm available. The installer supplies the pinned project-local runtimes from the official registry; it does not replace system Node.

At the `alpha>` prompt:

```text
note sample Synthetic Aurora uses cobalt telescopes.
index
search cobalt
get memory/sample.md
restart
search cobalt
use beta
search cobalt
use alpha
note sample Synthetic Aurora now uses amber telescopes.
index
search amber
delete sample
index
search amber
exit
```

Reindex after writes, updates and deletion. `use` selects a separate lab workspace; it provides corpus separation, not enterprise tenant security. Markdown and native SQLite state persist under `.lab/`. The lab starts its own loopback Gateway on demand and stops it at exit. Run `./node_modules/node/bin/node src/cli.ts demo` for a repeatable write/recall/source/restart scenario, or `help` for commands.

## Native engine and adapters

OpenClaw owns indexing, keyword/vector retrieval, source reads, persistence, agent flush, compaction and dreaming. Application adapters write/delete synthetic Markdown, route workspaces, manage private child processes and present results. There is no standalone memory SDK or invented Gateway write endpoint. Source deletion plus reindex removes current hits; it does not erase other copies or backups.

The [ready Gateway client](GATEWAY.md) connects a server application to an independently owned private Gateway through `POST /tools/invoke`. It never starts or stops that Gateway. Keep its operator token in the authorized server environment. Optional agent routing does not replace application authorization. A minimal client-only installation is available with `bash scripts/install.sh --client-only`. A [JSONL contract](PROTOCOL.md), [installable Python client](python/README.md), and separate [SDK app example](examples/sdk_app.py) are included. The SDK wraps this bridge; it does not implement another memory engine.

## Model acceptance and limits

- No-key keyword recall, source reads, updates, deletion, persistence and workspace separation pass against actual OpenClaw.
- The fixed real GPT-6 Sol chat, `text-embedding-3-small` index, semantic recall and source read passed; see [SMOKE.md](SMOKE.md).
- Genuine conversation → native successful flush → model-written daily note, compaction, reset capture and daily-source recall after Gateway replacement passed separately; see [LIFECYCLE.md](LIFECYCLE.md).
- Real native duplicate consolidation passed: Added 0, Merged 1, Superseded 0. The owner source session remained intact. All three model Dream Diary phases completed without fallback. Durable-source recall passed after restart. See the portable [test report](reports/test-report.html) and [sanitized before/after evidence](reports/native-acceptance-summary.json).
- Changed-fact supersession is not verified. The pinned native writer requires matching lineage. File updates through the Python adapter are separately verified; they do not prove automatic native supersession.

Local embedding/text servers and native provider selection are optional; see [PROVIDERS.md](PROVIDERS.md). Put an authorized key once in the ignored owner-only project `.env` using a local editor. Runtime loading preserves inherited environment values and never logs the key. General paid execution remains blocked by the [budget guard](BUDGET.md); the completed fixed acceptances do not unlock arbitrary paid commands. Their 5 USD test budget is separate from the 50 USD key cap.

## Checks

```bash
./node_modules/node/bin/node node_modules/typescript/bin/tsc --noEmit
./node_modules/node/bin/node node_modules/@biomejs/biome/bin/biome check .
./node_modules/node/bin/node --import ./src/load-env.ts --test --test-concurrency=1 tests/*.test.ts
```

Latest local full run: **75 tests, 71 passed, 0 failed, 4 skipped**. Skipped broad model tests remain separate from the fixed genuine-provider evidence above. Transport fault fixtures and dummy-provider smoke are explicitly mocked; native memory tests use actual OpenClaw. See [VERIFICATION.md](VERIFICATION.md) for evidence and [THIRD_PARTY.md](THIRD_PARTY.md) for runtime attribution. GitHub Actions results must be checked separately for the exact published commit. Delivery uses the feature branch; no main merge or deployment is included.

## Installed Python client

Use Python 3.10 or newer. Build and install locally:

```sh
python -m pip install build
python -m build python
python -m pip install python/dist/openclaw_memory_bridge-0.1.0-py3-none-any.whl
python examples/sdk_app.py --foundation "$PWD" --root "$PWD/.lab-test-sdk-app"
```

The app supplies workspace, user, session, and synthetic note content. It explicitly inserts recalled sources into a prompt. `pip install` alone creates no memory files and triggers no extraction or consolidation. The package includes no provider credentials. [Python setup and capability limits](python/README.md) describe the native lifecycle inspection and reset-hook methods.

The fixed operator acceptance is `./node_modules/node/bin/node examples/provenance_acceptance.ts`. Its ledger prevents automatic replay after dispatch. It is not a general SDK paid-chat API. The bounded transport adds a 2048-token ceiling only when native utility calls omit one; model, prompts, and memory semantics stay native. Retained synthetic sessions and raw evidence stay local and ignored. No new paid run is scheduled.

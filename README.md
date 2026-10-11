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

The [ready Gateway client](GATEWAY.md) connects a server application to an independently owned private Gateway through `POST /tools/invoke`. It never starts or stops that Gateway. Keep its operator token in the authorized server environment. Optional agent routing does not replace application authorization. A minimal client-only installation is available with `bash scripts/install.sh --client-only`. A [JSONL contract](PROTOCOL.md) and generic Python consumer are also included.

## Model acceptance and limits

- No-key keyword recall, source reads, updates, deletion, persistence and workspace separation pass against actual OpenClaw.
- The fixed real GPT-6 Sol chat, `text-embedding-3-small` index, semantic recall and source read passed; see [SMOKE.md](SMOKE.md).
- Genuine conversation → native successful flush → model-written daily note, compaction, reset capture and daily-source recall after Gateway replacement passed separately; see [LIFECYCLE.md](LIFECYCLE.md).
- Model consolidation remains unverified: the native sweep found zero eligible deep candidates; `MEMORY.md` did not change. Dream Diary utility requests failed finite output admission and used native fallback prose. No fallback is counted as model success.

Local embedding/text servers and native provider selection are optional; see [PROVIDERS.md](PROVIDERS.md). Put an authorized key once in the ignored owner-only project `.env` using a local editor. Runtime loading preserves inherited environment values and never logs the key. General paid execution remains blocked by the [budget guard](BUDGET.md); the completed fixed acceptances do not unlock arbitrary paid commands. Their 5 USD test budget is separate from the 50 USD key cap.

## Checks

```bash
./node_modules/node/bin/node node_modules/typescript/bin/tsc --noEmit
./node_modules/node/bin/node node_modules/@biomejs/biome/bin/biome check .
./node_modules/node/bin/node --import ./src/load-env.ts --test --test-concurrency=1 tests/*.test.ts
```

Latest full run: **75 tests, 71 passed, 0 failed, 4 skipped**. Skipped broad model tests remain separate from the fixed genuine-provider evidence above. Transport fault fixtures and dummy-provider smoke are explicitly mocked; native memory tests use actual OpenClaw. See [VERIFICATION.md](VERIFICATION.md) for evidence and [THIRD_PARTY.md](THIRD_PARTY.md) for runtime attribution. Current work is local; no push or deployment was made.

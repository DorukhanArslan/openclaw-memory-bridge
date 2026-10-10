# OpenClaw memory bridge

This bridge connects applications to the existing OpenClaw memory engine. You do not need to write a new memory engine.

The bridge uses the official OpenClaw CLI and Gateway. It requires OpenClaw **2026.9.9** and Node **24.16.0**. The installer supplies both inside the project.

## Quick start

Use synthetic data only. Setup requires `npm` and access to the npm registry. Keyword search requires no model or API key.

```bash
git clone https://github.com/DorukhanArslan/openclaw-memory-bridge.git
cd openclaw-memory-bridge
bash scripts/install.sh
npm start
```

The terminal shows an `alpha>` prompt. Enter these commands:

```text
note sample Synthetic Aurora uses cobalt telescopes.
index
search cobalt
get memory/sample.md
exit
```

Index notes after each write, update, or deletion. Enter `help` for more commands. Run `npm run demo` for an automatic example.

## Python connection

Python applications use the local JSONL process protocol. The example uses only the Python standard library. It starts the bridge as a child process.

Use Python **3.9 or later** for this example:

```bash
python3 examples/python_consumer.py
```

The example tests recall, source reads, process restarts, workspace separation, and deletion. See the [process contract](PROTOCOL.md) for requests and responses.

## Memory operations

The bridge writes and deletes Markdown notes. OpenClaw creates the search index. Native `memory_search` returns results with sources. Native `memory_get` reads the source text.

The bridge starts a loopback Gateway on demand. The bridge stops its child processes at exit. Workspace data stays in `.lab/` after exit.

## Limits

- This project is a developer lab. Workspace separation provides no enterprise tenant security.
- Vector search requires a local embedding model.
- Chat, automatic memory flush, compaction, and model-assisted dreaming require a local text model. Their model tests remain pending.
- The promotion demo sets its native test thresholds to zero. It does not prove model-based consolidation.
- Session capture tests use a synthetic transcript fixture. They do not produce a model conversation.
- The bridge depends on this OpenClaw release. Test a new release before use.

## Checks

```bash
npm test
npm run typecheck
npm run lint
```

The tests use the actual OpenClaw runtime. They cover recall, updates, deletion, sources, persistence, workspace separation, native dreaming, and session capture.

The latest complete run had **11 passes, 0 failures, and 3 skipped model tests**. The repository has no CI workflow.

See the [OpenClaw runtime attribution](THIRD_PARTY.md) for its MIT license notice.

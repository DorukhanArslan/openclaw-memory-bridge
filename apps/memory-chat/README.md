# Memory Chat

A local chatbot demo with an OpenAI-style interface, genuine model replies, and an optional inspector for saved memory, source changes, and executed tools. Start with ordinary chat; the guided walkthrough is an optional sidebar action. Memory operations use the installed public Python SDK.

## Start

From a configured repository checkout, with `OPENROUTER_API_KEY` in the server process environment:

```sh
npm run chat -- --budget-usd 1
```

Open the localhost URL printed by the server, normally `http://127.0.0.1:8765`. The server binds to loopback. A cloud machine's localhost is not your computer's localhost; this repository does not provide a public preview URL or tunnel. Run the app on your computer to open it there.

Opening the page starts neither a model request nor the memory Gateway. Ordinary model chat can work while memory is unavailable. The SDK process is created only when a memory tool, explicit memory refresh, or restart needs it. Long operations show progress while the page continues polling cached state; **Stop** prevents further dispatches after the current operation.

Sending messages or running guided steps can incur model charges. The allowance is a retained local estimate, not a provider billing hard cap. A new conversation, Stop, failed request, or restart does not refund it. Restart an existing positive allowance with the same `--budget-usd` value; changing the flag cannot replace its budget or policy. On a fresh root, omitting the flag disables model requests without consuming an allowance.

The launcher uses `PYTHON` when set, then `.bootstrap/python/bin/python` if available, otherwise `python3`. The selected interpreter must have the SDK installed. For a fresh checkout:

```sh
bash scripts/install.sh
python3 -m venv .bootstrap/python
.bootstrap/python/bin/python -m pip install ./python
```

Set the API key in the server's environment before starting. It stays server-side; there is no browser key field or credential export. The launcher does not load `.env` files.

## Try one continuous flow

Use the optional walkthrough or send these messages yourself:

1. Save a fact: “My project's code name is Atlas and its delivery day is Friday. Remember both.” Inspect the actual saved source and tool results.
2. Update one fact: “Change the code name to Nova. Keep the delivery day unchanged.” Inspect the source diff.
3. Start a new conversation and ask for the code name and delivery day. The host conversation starts empty while the same memory corpus remains available.
4. Restart memory, then ask again. The demo restarts the Gateway, closes the SDK connection, and creates a new connection when the next memory operation needs it.
5. Export the run. Inspect the recorded messages, actual tool results, source snapshots, changes, and outcomes. The export describes that run; it is not a newly executed acceptance test.

The inspector distinguishes assistant claims from completed SDK operations. Failed or stale memory reads are labelled; a genuine model reply remains visible even if memory or its later source snapshot fails. Unverified changes are not presented as successful writes. Existing demo data is preserved. Select a separate `--root /path/to/new-demo-data` when an empty corpus is required.

## Replay an exported run

From the repository root:

```sh
python3 apps/memory-chat/server.py --replay /path/to/memory-chat-capture.json
```

Open the printed localhost URL. Replay displays exported conversations and recorded source/tool evidence; chat, guided steps, and memory restart are disabled. It constructs neither the SDK nor a model provider and needs no API key, running memory engine, or Node installation. Python's standard library and this app's files are sufficient. It does not rerun the recorded operations or turn unsuccessful steps into passes.

Exports contain entered messages and saved facts. Use fictional data for captures intended for a public README.

## Connect another application

See [SDK Connection](SDK-CONNECTION.md) for the imports, request path, state ownership, and integration boundaries. The Python backend requires a local installation of this repository's pinned Node/OpenClaw runtime; installing the Python package alone does not install that runtime.

To run the server directly, use an interpreter with the SDK installed:

```sh
python server.py --foundation /path/to/openclaw-memory-bridge --root /path/to/app-data --budget-usd 1
```

That command is relative to this app's directory. Keep one server process per data root. This is a trusted local demo, not an authenticated multi-tenant service. Workspace/user routing does not provide authorization. Native automatic fact supersession remains unsupported through the pinned ingestion path, and native flush/compaction does not manage the Python host's chat history.

## Verification

Automated checks cover actual installed-SDK/OpenClaw operations, asynchronous jobs, cancellation, failure recovery, and replay. Automated model conversations use a labelled protocol fixture.

A separate [genuine browser/model/SDK run](../../reports/memory-chat-live-run.json) passed in one retained corpus: ordinary chat without Gateway startup (2.4 seconds), save Atlas/Friday, recall in a new chat, update to Nova while preserving Friday, then restart and fresh-chat recall of Nova/Friday. Cached state reads took at most 165 ms during that run, with zero JavaScript errors. This exercised manual free chat; the guided button sequence has controlled-test coverage but was not fully live-tested. Existing data and scenario allowances remain preserved.

## Troubleshooting

After an ordinary provider failure, you can explicitly send another message in the same chat; the failed turn stays visible and is not retried automatically. Only an uncertain memory-write acknowledgement requires **New chat**. On startup, an interrupted blocked conversation opens a fresh host conversation while preserving its history, saved memory, and allowance.

**Stop** requests cancellation; an already-dispatched request can finish before cancellation is observed. No additional model or memory operation starts afterward, and its reservation remains charged. Provider requests have a 30-second transport timeout. A response that reaches its output limit is shown as partial, with a notice; no paid continuation is started automatically.

If memory fails, continue ordinary chat or use the inspector's explicit refresh/restart controls. Source panels show their unavailable/stale state. Preserve the data directory and request records when reporting a Gateway failure; the diagnostics do not establish the cause of unrelated historical failures.

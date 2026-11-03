# Memory Chat

A local chatbot demo with an OpenAI-style interface, genuine model replies, and an inspector for saved memory, source changes, and executed tools. The application uses the installed public Python SDK. It adds no memory engine.

## Start

From a configured repository checkout, with `OPENROUTER_API_KEY` in the server process environment:

```sh
npm run chat -- --budget-usd 1
```

Open the localhost URL printed by the server, normally `http://127.0.0.1:8765`. The server binds to loopback. A cloud machine's localhost is not your computer's localhost; this repository does not provide a public preview URL or tunnel. Run the app on your computer to open it there.

Opening the page does not send a model request. Sending messages or running guided steps uses the configured genuine OpenRouter model and can incur charges. The explicit allowance is an estimated local request bound, not a provider billing hard cap. Its ledger persists under the selected data root; a new conversation or restart does not reset it. Start an existing positive allowance with the same `--budget-usd` value: changing that flag cannot replace its budget or policy. On a fresh data root, starting without the flag enables inspection only and consumes no allowance.

The launcher uses `PYTHON` when set, then `.bootstrap/python/bin/python` if available, otherwise `python3`. The selected interpreter must have the SDK installed. For a fresh checkout:

```sh
bash scripts/install.sh
python3 -m venv .bootstrap/python
.bootstrap/python/bin/python -m pip install ./python
```

Set the API key in the server's environment before starting. It stays server-side; there is no browser key field or credential export. The launcher does not load `.env` files.

## Try one continuous flow

Use the guided controls or send these messages yourself:

1. Save a fact: “My project's code name is Atlas and its delivery day is Friday. Remember both.” Inspect the actual saved source and tool results.
2. Update one fact: “Change the code name to Nova. Keep the delivery day unchanged.” Inspect the source diff.
3. Start a new conversation and ask for the code name and delivery day. The host conversation starts empty while the same memory corpus remains available.
4. Restart memory, then ask again. The demo restarts the Gateway and reopens the SDK before recall.
5. Export the run. Inspect the recorded messages, actual tool results, source snapshots, changes, and outcomes. The export describes that run; it is not a newly executed acceptance test.

The inspector distinguishes assistant claims from completed SDK operations. A failed operation stays visible. Empty sources and unsuccessful steps are not replaced with invented records or simulated replies. Existing demo data is preserved; the guided flow does not silently clear it. Select a separate `--root /path/to/new-demo-data` when an empty corpus is required.

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

`npm run test:chat` passed 20 tests, including an actual installed-SDK/OpenClaw flow through writes, updates, empty-conversation recall, Gateway/SDK restart, and capture/replay. That automated flow uses an explicitly labelled model protocol fixture; it does not claim a fresh genuine-model tour. A separate bounded live-provider check returned a genuine model response. Chromium checks covered desktop/mobile layout and actual page/API interaction. Typecheck and lint passed. No existing consumed scenario allowance was reset.

## Troubleshooting

After a failed or uncertain turn, choose **New chat** before sending another message or continuing the walkthrough. This clears the conversation context while preserving saved memory and the retained allowance; it does not replay the failed operation.

If Gateway startup fails, report the full terminal error and your operating system. Startup diagnostics include the transport cause, runtime, console output, and a bounded native log tail. The tail may include earlier starts. Preserve the data directory and request records while investigating.

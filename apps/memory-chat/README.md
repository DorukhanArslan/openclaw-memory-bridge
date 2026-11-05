# Memory Chat

A local chatbot demo with an OpenAI-style interface and OpenClaw-managed conversation memory. Messages enter the native interactive agent through the installed public Python SDK. OpenClaw owns the conversation transcript, memory recall, tool execution, and pre-compaction flushing; the optional inspector shows recorded outcomes.

## Start

For a fresh native demo, use a configured repository checkout with `OPENROUTER_API_KEY` in the server process environment:

```sh
npm run chat -- --root .lab/native-memory-chat --budget-usd 5
```

Open the localhost URL printed by the server, normally `http://127.0.0.1:8765`. The server binds to loopback. A cloud machine's localhost is not your computer's localhost; this repository does not provide a public preview URL or tunnel. Run the app on your computer to open it there.

Opening the page starts no model request or memory Gateway. The first message creates the SDK connection and uses the native Gateway; there is no separate plain-chat fallback. Long operations show progress while the page continues polling cached state. You can draft another message, but it is not dispatched until the active operation finishes. **Stop** prevents subsequent model dispatches after the current bounded request.

Sending messages or running guided steps can incur model charges. Each request reserves a conservative estimate before dispatch. New, validated successful replies settle that estimate using the provider's returned cost. Missing costs, failed or uncertain attempts, and reservations from earlier versions remain fully held; earlier requests are not retroactively settled. The local allowance is neither an invoice nor a provider billing hard cap. A new conversation, Stop, or restart does not clear its history. On a fresh root, omitting the flag disables model requests without consuming an allowance.

The example sets a total local ceiling of 5 USD. One message can require several model calls, each of which must fit a conservative reservation before it starts. The named root keeps this fresh demo separate from earlier `.lab/memory-chat` data and its retained allowance.

To increase an existing allowance, stop the server with **Ctrl+C in its terminal**, then restart with the same root and a higher `--budget-usd` value. For the default data root:

```sh
npm run chat -- --budget-usd 10
```

This raises the **total ceiling to 10 USD**, including prior committed usage; it does not add another 10 USD. Notes, conversations, the original admission record, and cumulative request/reservation counters are preserved. Repeating the command keeps the same ceiling. A lower ceiling or a different model/output/pricing policy is rejected. An active server must be stopped before the ceiling can change.

The launcher uses `PYTHON` when set, then `.bootstrap/python/bin/python` if available, otherwise `python3`. The selected interpreter must have the SDK installed. For a fresh checkout:

```sh
bash scripts/install.sh
python3 -m venv .bootstrap/python
.bootstrap/python/bin/python -m pip install './python[chat]'
```

After an update, stop the running server and reinstall the SDK before restarting. With the launcher's default virtual environment:

```sh
git pull
.bootstrap/python/bin/python -m pip install './python[chat]'
```

If `PYTHON` selects another interpreter, reinstall with that interpreter instead. Pulling the repository alone does not update an already installed SDK. Restart with the same `--root` and saved ceiling, or explicitly increase that ceiling as shown above. For the original default-root setup with its ceiling increased to 10 USD:

```sh
npm run chat -- --budget-usd 10
```

The `chat` extra installs native system-trust support and a public CA bundle for Python HTTPS. On macOS, the app uses Keychain trust alongside those public roots. Certificate-chain and hostname verification remain enabled.

Set the API key in the server's environment before starting. It stays server-side; there is no browser key field or credential export. The launcher does not load `.env` files.

## Try one continuous flow

Use fictional facts and send these messages yourself, or use the optional walkthrough:

1. Say: “I drink my coffee without sugar.” An explicit “remember this” is not required to create a native conversation record.
2. Ask a follow-up in the same chat. The native agent has the preceding turn in its conversation context.
3. Click **New chat**, wait for memory preparation to finish, then ask: “How do I take my coffee?” The new session has empty conversation history; recall must use the retained native memory or earlier transcript.
4. Restart memory and ask again. The Gateway and SDK reconnect to the same retained data.
5. Export the run. Inspect the actual replies, native completion and persistence receipts, source reads, and operation outcomes.

New chat and restart wait for an explicit native index operation before opening fresh context. Native transcript indexing is otherwise asynchronous; successful completion of that operation establishes the demo's recall-preparation barrier. It can take time, with progress remaining available.

A saved conversation and a curated long-term fact are different records. OpenClaw can recall earlier conversation text without writing every sentence into a preference note. Its normal agent policy and pre-compaction flush can write useful facts; the demo does not guarantee every utterance becomes an immediately curated permanent fact. Automatic dreaming is not scheduled by this demo.

The inspector distinguishes assistant claims from completed native operations and labels unavailable or stale sources. A genuine reply is retained if later inspection fails. Existing data is preserved. Select a separate `--root /path/to/new-demo-data` only when an intentionally empty corpus is required; this does not reset an existing allowance.

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
python server.py --foundation /path/to/openclaw-memory-bridge --root /path/to/app-data --budget-usd 5
```

That command is relative to this app's directory. Keep one server process per data root. This is a trusted local demo, not an authenticated multi-tenant service. Workspace/user routing does not provide authorization. Native automatic fact supersession remains unsupported through the pinned ingestion path. Native flush and compaction now operate on OpenClaw-owned sessions; they do not manage unrelated external Python histories.

## Verification

Native-chat checks must distinguish protocol fixtures, actual native lifecycle operations, and genuine provider runs. A protocol fixture verifies integration and ordering without establishing model behavior. See test output and the captured run for the version being evaluated.

The [native integration validation](../../reports/memory-chat-native-validation.json) used the production host, installed SDK and actual OpenClaw processes. A natural coffee preference was recorded, indexed before a fresh session, then retrieved with native session search and source reads. Exact encrypted tool continuations survived, and private model metadata stayed out of the export. Model replies in this run were labelled protocol fixtures; no paid provider request was made.

The [genuine native browser run](../../reports/memory-chat-native-live.json) recorded a coffee preference and the distinctive mug name “Zephyr-472” without a remember instruction. OpenClaw wrote a daily note, answered a source-backed follow-up in the same chat, and retrieved both facts in a fresh native session. The first fresh-session attempt reached its local reservation limit before a final answer. That failure remains recorded; after separately approved funding, a fact-free continuation in the same native session produced the correct genuine answer. This was completion after a budget interruption, not an uninterrupted walkthrough or a dreaming test.

The [earlier genuine browser/model/SDK run](../../reports/memory-chat-live-run.json) remains historical evidence for the former independent Python model/tool loop. It verified explicit note save, update, and recall, but does not establish the new native-chat path or automatic conversation recall. Existing records and consumed allowances are preserved.

## Troubleshooting

### HTTPS certificate errors on macOS

Stop the server, apply the upgrade commands above, and restart with your existing data root and allowance. The optional chat dependencies supply system trust through `truststore` and public roots through `certifi`, including when Python's default CA file is missing.

If a VPN or HTTPS proxy inspects traffic, its root certificate must be trusted in macOS Keychain or supplied as a trusted PEM file through `SSL_CERT_FILE` or `NODE_EXTRA_CA_CERTS`. `SSL_CERT_FILE`, `SSL_CERT_DIR`, and `NODE_EXTRA_CA_CERTS` supplement the system/public roots; invalid nonempty locations are rejected with the variable name in the error. Keep certificate verification enabled.

### Native operations

A Gateway failure now fails the native chat operation visibly; the app does not silently substitute an independent model conversation. Preserve the data directory and request records when reporting it. Cached state and inspector controls remain available while native work runs.

**Stop** requests cancellation of subsequent dispatches. An already-dispatched request can finish before cancellation is observed and remains recorded. Only a validated successful response with a returned provider cost can settle its estimate. All native main-agent, recall-agent, and flush model requests pass through the same server-side broker and retained allowance. Completion requests outside an explicitly active chat operation are rejected; automatic background model spending is disabled. A provider failure closes that operation's admission window rather than authorizing an automatic paid retry.

If preparation for a new conversation fails, do not treat that as successful fresh-context recall. The error remains visible and the previous data is retained. A completed assistant reply or a saved transcript alone is not proof that semantic indexing or long-term fact consolidation completed.

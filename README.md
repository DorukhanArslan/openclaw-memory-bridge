# OpenClaw memory bridge

This bridge connects server applications to the existing OpenClaw memory engine. You do not need to write a new memory engine.

Use the ready Gateway client to read memory from a running private Gateway. Use the managed lab to create and test synthetic notes. Both paths use the official OpenClaw API. Tested releases are OpenClaw **2026.9.9** and Node **24.16.0**.

## Connect a running Gateway

Clone this repository and install the client Node runtime:

```bash
git clone https://github.com/DorukhanArslan/openclaw-memory-bridge.git
cd openclaw-memory-bridge
bash scripts/install.sh --client-only
.bootstrap/node_modules/node/bin/node examples/ready_gateway.ts cobalt
```

Supply `BRIDGE_GATEWAY_URL` and `BRIDGE_GATEWAY_TOKEN` through your authorized server environment. Optional `BRIDGE_AGENT_ID` selects a configured agent. Use an agent with indexed synthetic notes. The client accepts loopback URLs only. It creates no Gateway and sends no restart or stop command.

Keep the operator token on the server. Authenticate users and authorize their routes before recall. Route selection provides no tenant security. See the [Gateway integration](GATEWAY.md) for the interface, limits and error codes.

## Select native providers

OpenClaw supplies OpenRouter and other providers. The managed lab's `native-model` command passes a provider/model reference and an env SecretRef; `native-vector` configures embeddings separately. Both validate config without model requests. Enter a key yourself at the hidden local prompt in [PROVIDERS.md](PROVIDERS.md). Project `.env` files are not automatically loaded. Provider acceptance needs an approved model and budget.

## Run the managed lab

Setup requires `npm` and access to the npm registry. The full installer supplies the pinned Node and OpenClaw runtimes. Keyword search requires no model or API key.

```bash
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

Index notes after each write, update or deletion. The bridge writes and deletes Markdown. OpenClaw indexes it and provides native `memory_search` and `memory_get`. The lab owns its loopback child Gateway and stops it at exit. Data stays in `.lab/`. Enter `help` for more commands or run `npm run demo`.

Python applications can use the managed lab's local JSONL process contract. Run `python3 examples/python_consumer.py` with Python 3.9 or later. See [PROTOCOL.md](PROTOCOL.md).

## Limits and checks

- Use synthetic data in this lab. Source deletion removes current indexed hits after reindex; it does not erase other copies or backups.
- Vector search requires a genuine embedding model. Model-generated dreaming, consolidation and chat flush require a genuine tool-capable text model. Local servers and selected native providers are supported; model acceptance remains pending.
- The promotion demo uses zero test thresholds. Session capture uses a labelled transcript fixture. These checks do not prove model-generated memory.
- A first client request can pay connection and native initialization cost. Warm calls can reuse sockets. No zero-startup or latency guarantee applies.

With the full installation:

```bash
npm run typecheck
npm run lint
npm test
```

Transport fault tests use synthetic HTTP servers. Native tests use actual OpenClaw. Missing model tests are skipped. A local CI workflow is prepared; GitHub execution is unverified until publication and a completed run. See [VERIFICATION.md](VERIFICATION.md) for results and [THIRD_PARTY.md](THIRD_PARTY.md) for runtime attribution.

# OpenClaw memory bridge Python client

A Python 3.10+ client for the local TypeScript bridge and pinned OpenClaw runtime. It implements no memory engine and includes no credentials.

From the repository root:

```sh
bash scripts/install.sh
python3 -m pip install ./python
```

For Memory Chat's Python HTTPS connection, install the optional chat support with the interpreter that runs the server:

```sh
python3 -m pip install './python[chat]'
```

This adds `truststore` for native system trust, including macOS Keychain, and `certifi` for public root certificates. Memory Chat keeps certificate-chain and hostname verification enabled and accepts additional trusted CA locations through `SSL_CERT_FILE`, `SSL_CERT_DIR`, and `NODE_EXTRA_CA_CERTS`. The memory-only client keeps its standard-library installation above. See [chat setup and certificate troubleshooting](https://github.com/DorukhanArslan/openclaw-memory-bridge/blob/main/apps/memory-chat/README.md) for upgrades; retain the existing data root and allowance when applying a TLS repair.

See the repository [README](https://github.com/DorukhanArslan/openclaw-memory-bridge) for the runnable example, native/SDK boundary, and recorded feature story. Use synthetic data and an application-owned state root. Workspace/user routes separate corpora; they do not authenticate users.

The client provides note write/delete, index/search/get, status/restart, session/dreaming inspection, and native interactive chat. Reindex after note changes. Close the client after a transport timeout. Installing the package alone writes no memory notes.

The child bridge inherits `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, their lowercase variants, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, and `SSL_CERT_DIR` when present in the runtime environment. The bridge passes the same settings to OpenClaw; native code owns proxy selection and TLS. Case and explicit empty values are preserved. Unrelated shell variables and Node runtime flags remain isolated. For the pinned Node runtime, additional CA trust is verified through `NODE_EXTRA_CA_CERTS`; `SSL_CERT_FILE` and `SSL_CERT_DIR` retain Node's native CA-mode semantics. Supply these settings outside the foundation's `.env` loader for application settings and credentials.

`memory.get(scope, "USER.md", start=1, lines=40)` reads an existing native profile through the same scoped bridge as note reads. You can also use the `USER.md` path and line range returned by search. `start` must be a positive integer and `lines` must be 1–200. Native excerpts may append a continuation hint. A missing profile returns the native `status: "not_found"` result. This adds no profile-write API and does not create a profile automatically; the host or native agent owns that file. Reads retain native workspace and symlink protections.

Manual native maintenance: `write_daily(scope, day, text)` replaces a canonical daily source; call `index` afterward. `configure_maintenance(scope, cumulative_limit_usd=50, host_reserve_usd=...)` selects the approved finite lab profile; `run_maintenance(scope)` returns native backfill, cron, publisher, status and diary receipts. `explain_promotion(scope, selector)` inspects native provenance. Model calls need the authorized foundation environment. Scheduling is manual and the retained ledger is shared across this SDK root.

Use `configure_chat(scope, model_url=...)` to bind a host-owned OpenAI-compatible loopback model endpoint, then `chat(scope, message)` to enter an OpenClaw-managed persistent conversation. The host endpoint must enforce its provider allowance; the SDK does not authorize unbounded model spending. The binding lasts for that SDK process and must be re-established after reconnecting. `chat` returns actual native admission, completion, history, and session-state receipts. Its response window covers native startup and completion polling.

The native chat profile enables session-transcript indexing, cross-conversation Active Memory, and normal pre-compaction flushing. The scope's session ID chooses the native conversation; keeping workspace/user stable allows later sessions to recall earlier records. Native transcript indexing is asynchronous: call `index` before crossing to a fresh session when immediate indexed recall is required. A stored transcript is not a guarantee that every sentence becomes a curated long-term fact. The profile does not schedule automatic dreaming or autonomous model work. See the [chat integration](https://github.com/DorukhanArslan/openclaw-memory-bridge/blob/main/apps/memory-chat/SDK-CONNECTION.md) for the demo's model broker, admission window, ordering, and evidence.

An independent Python model loop still owns its external history. The SDK does not flush or compact foreign message history, authenticate users, or provide tenant security through scope routing.

`MemoryTools(client, scope, day)` exposes provider-compatible `definitions` and `execute(name, arguments)`. The host selects the scope. Tools provide search, source reads, canonical profile replacement and daily-note replacement; both writes also index. The agent must preserve unrelated facts. A failed index raises an error and leaves the saved source in place. Calls on one adapter are serialized; this is not a cross-process transaction. `MaintenanceJob(client, scope)` is a callable for your scheduler after maintenance configuration. It rejects overlapping calls on that job instance, propagates failure and does not retry.

The repository example `examples/host_maintenance.py` runs a finite host schedule. Its first run is immediate; later runs wait for `--interval-seconds` after the last run ends. Repeated runs retain the same finite native ledger. Choose cadence and recovery in your host.

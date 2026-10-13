# OpenClaw memory bridge Python client

A Python 3.10+ client for the local TypeScript bridge and pinned OpenClaw runtime. It implements no memory engine and includes no credentials.

From the repository root:

```sh
bash scripts/install.sh
python3 -m pip install ./python
```

See the repository [README](https://github.com/DorukhanArslan/openclaw-memory-bridge) for the runnable example, native/SDK boundary, and recorded feature story. Use synthetic data and an application-owned state root. Workspace/user routes separate corpora; they do not authenticate users.

The client provides note write/delete, index/search/get, status/restart, and session/dreaming inspection. It provides no chat wrapper or external-context flush/compaction. Reindex after note changes. Close the client after a transport timeout. Installing the package alone writes no memory notes.

Manual native maintenance: `write_daily(scope, day, text)` replaces a canonical daily source; call `index` afterward. `configure_maintenance(scope, cumulative_limit_usd=50, host_reserve_usd=...)` selects the approved finite lab profile; `run_maintenance(scope)` returns native backfill, cron, publisher, status and diary receipts. `explain_promotion(scope, selector)` inspects native provenance. Model calls need the authorized foundation environment. Scheduling is manual and the retained ledger is shared across this SDK root.

Your external Python agent owns chat and context policy. The SDK does not flush or compact foreign message history, authenticate users, or provide tenant security through scope routing.

# OpenClaw memory bridge Python client

A Python 3.10+ client for the local TypeScript bridge and pinned OpenClaw runtime. It implements no memory engine and includes no credentials.

From the repository root:

```sh
bash scripts/install.sh
python3 -m pip install ./python
```

See the repository [README](https://github.com/DorukhanArslan/openclaw-memory-bridge) for the runnable example, native/SDK boundary, and recorded feature story. Use synthetic data and an application-owned state root. Workspace/user routes separate corpora; they do not authenticate users.

The client provides note write/delete, index/search/get, status/restart, and session/dreaming inspection. It provides no chat, flush, compaction, or dreaming execution trigger. Reindex after note changes. Close the client after a transport timeout. Installing the package alone writes no memory notes.

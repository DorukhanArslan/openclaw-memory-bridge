# Bounded native smoke checkpoint

This addition reuses OpenClaw 2026.9.9's bundled `llm-task`, native Markdown indexing, `memory_search` and `memory_get`. No provider SDK, model client, secret registry or memory engine was implemented. The wrapper writes one fixed synthetic note and supervises native processes. The broad paid model/lifecycle suite remains blocked.

The private native child preloads `src/native-bootstrap.ts` so its fetch implementation and dispatchers both come from OpenClaw's bundled Undici 8.10.2. Node 24.16.0's built-in fetch rejects that dispatcher contract with `UND_ERR_INVALID_ARG`; this was reproduced without credentials against loopback. The preload checks all three pinned versions, preserves native SSRF controls, and changes no provider, secret or account setting.

## Current acceptance

The approved finite real-provider run passed on 2026-10-11 using `openrouter/openai/gpt-6-sol` and `openai/text-embedding-3-small`. Native chat returned `{"ok":true}`. One synthetic note was indexed; `memory_search` found `memory/resident.md` for `pedal-powered commuting`, and `memory_get` returned the expected bicycle sentence. The native key counter changed from 50 USD remaining to 49.99978964 USD remaining: **0.00021036 USD** during the test window, below the separate 5 USD test budget. Concurrent use of that key is not excluded, so this is a measured counter delta, not independently isolated per-request billing. Safe results are in ignored `evidence/live-smoke/acceptance.json`. A later separate fixed [lifecycle acceptance](LIFECYCLE.md) accepted genuine extraction, native flush, compaction and daily-source persistence; model consolidation remains unverified.

`npm run test:smoke` runs actual private native CLI/Gateway processes against dummy loopback provider responses. It is **mock provider acceptance**, not real chat output, real embedding quality or consolidation acceptance. The completion sends the fixed `openai/gpt-6-sol` model, two fixed messages, no tools, `max_completion_tokens: 128`, and `reasoning.effort: none`. Fixed ASCII bytes plus 128 tokens of framing allowance bound input below 1024 tokens. Native completion timeout is 15 seconds. HTTP 429/503 and stalled-stream fixtures check one completion request and no wrapper retry.

One small note is indexed, then one semantic query is sent and the retrieved source is read. Dummy equal vectors exercise native retrieval; they do not demonstrate model semantics. Quota policy tests use dummy normalized 50 USD responses; the separate approved real run also verified authenticated native quota. Production uses the fixed HTTPS endpoint. Authenticated readiness uses `memory_get`, causing no embedding request. The success fixture checks exactly one document embedding and one query embedding. Heartbeat, cron, session hooks, flush, dreaming and model fallbacks are disabled. No corpus changes occur after indexing. Temporary smoke permission is not persisted.

Embedding retries belong to native OpenClaw, not this wrapper: transient index errors allow three attempts; rate-limited index errors allow five attempts in the pinned source; query errors allow three attempts. The fixtures exercise three transient index attempts and three rate-limited query attempts. Five rate-limited index attempts were not executed. The wrapper has zero retries and a 30-second index child deadline, followed by a maximum 10-second forced-termination grace. Native query retry wait is bounded to 8 seconds; Gateway request deadline is 40 seconds. Process termination is not a provider cancellation or billing guarantee.

## Provider limit and test budget are separate

The user reported a **50 USD provider key cap**. The approved test budget remains **5 USD**. Dedicated smoke quota validation accepts an explicitly selected 50 USD limit and requires at least 1 USD remaining; it does not turn 50 USD into a 5 USD spending cap. Missing/error/stale/ambiguous metadata, mismatched limit and insufficient headroom fail closed. The original broad-suite guard and default 5 USD diagnostic are unchanged.

On 2026-10-11 the official [GPT-6 Sol endpoint metadata](https://openrouter.ai/api/v1/models/openai/gpt-6-sol/endpoints) listed maximum prompt/output/cache-write rates, including long-context tiers, of **8/30/10 USD per million tokens**. The [embedding provider page](https://openrouter.ai/openai/text-embedding-3-small) listed **0.02 USD per million** for both routes. Conservatively charging prompt plus cache write, one 1024/128 completion and up to five 512-token document attempts plus three 64-token query attempts gives **0.02232704 USD** at those advertised rates. This conditional estimate is below 5 USD; it is **not a hard cap**, an atomic reservation, proof of future prices or a bound on other users of the key. Provider-internal routing/retries and billing were not observed. Reset/exclusive use were not confirmed by the user and are not claimed.

## One operator-run native smoke

The isolated completion path does not forward provider price/routing hints. Those hints are **not an admission requirement** for this fixed finite test: the conservative calculation above uses the highest advertised rate across all routes and tiers for the same approved model. No model/provider fallback is configured in OpenClaw, and the plugin permits only `openrouter/openai/gpt-6-sol`. This changes only dedicated smoke admission; general paid lab/lifecycle commands remain blocked.

Implementation and mock-provider checks used synthetic credentials. After the operator supplied the project-local key and the finite spending approval was verified, one real native smoke passed as recorded above. This proves the fixed chat/index/semantic-recall/source-read scenario; the broader model suite remains unrun. Extraction, flush and consolidation are outside this one-completion smoke; their separate results are in [LIFECYCLE.md](LIFECYCLE.md). Native quota JSON is read from stdout, separately from native stderr warnings.

From this repository:

```bash
bash --noprofile --norc scripts/bounded-smoke.sh
```

The command uses the existing `OPENROUTER_API_KEY` environment value or the project-root private `.env`; an existing environment value wins, including an empty one. There is no key prompt. If the key is missing or empty, it exits 2 before workspace creation or native execution and directs you to edit the local `.env` using the keyless template. See [PROVIDERS.md](PROVIDERS.md). The loader never sources the file as shell code or prints values.

With a key present, this command checks the native 50 USD key budget and available headroom, indexes the fixed synthetic note, invokes one native chat completion, searches once and reads the retrieved source. A successful result has `mode: "real-provider"`, the approved completion result and the source path. Failure exits 2 with a sanitized result and stops the workflow. It does not retry the wrapper or run consolidation. The key exists in the child process until exit; the local `.env` persists for subsequent authorized commands and the temporary lab is removed. No secret is placed in command arguments, browser code, Git or native project settings; no provider/account setting is changed. Repeat invocations are separate runs and separate costs.

The direct entry `npm run smoke:bounded` uses the same project `.env` loader and fixed approved policy. It accepts no model/provider/configuration arguments and adds no reset/exclusive-use assertion. `npm start` continues to provide the genuine no-key keyword memory lab. Future price changes or native releases require rechecking the estimate/contracts before reuse. The pinned native fingerprints fail closed when those tested request/retry contracts change.

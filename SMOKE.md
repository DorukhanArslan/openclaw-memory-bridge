# Bounded native smoke checkpoint

This addition reuses OpenClaw 2026.9.9's bundled `llm-task`, native Markdown indexing, `memory_search` and `memory_get`. No provider SDK, model client, secret registry or memory engine was implemented. The wrapper writes one fixed synthetic note and supervises native processes. The broad paid model/lifecycle suite remains blocked.

## Current acceptance

`npm run test:smoke` runs actual private native CLI/Gateway processes against dummy loopback provider responses. It is **mock provider acceptance**, not real chat output, real embedding quality or consolidation acceptance. The completion sends the fixed `openai/gpt-6-sol` model, two fixed messages, no tools, `max_completion_tokens: 128`, and `reasoning.effort: none`. Fixed ASCII bytes plus 128 tokens of framing allowance bound input below 1024 tokens. Native completion timeout is 15 seconds. HTTP 429/503 and stalled-stream fixtures check one completion request and no wrapper retry.

One small note is indexed, then one semantic query is sent and the retrieved source is read. Dummy equal vectors exercise native retrieval; they do not demonstrate model semantics. Authenticated readiness uses `memory_get`, causing no embedding request. The success fixture checks exactly one document embedding and one query embedding. Heartbeat, cron, session hooks, flush, dreaming and model fallbacks are disabled. No corpus changes occur after indexing. Temporary smoke permission is not persisted.

Embedding retries belong to native OpenClaw, not this wrapper: transient index errors allow three attempts; rate-limited index errors allow five attempts in the pinned source; query errors allow three attempts. The fixtures exercise three transient index attempts and three rate-limited query attempts. Five rate-limited index attempts were not executed. The wrapper has zero retries and a 30-second index child deadline, followed by a maximum 10-second forced-termination grace. Native query retry wait is bounded to 8 seconds; Gateway request deadline is 40 seconds. Process termination is not a provider cancellation or billing guarantee.

## Provider limit and test budget are separate

The user reported a **50 USD provider key cap**. The approved test budget remains **5 USD**. Dedicated smoke quota validation accepts an explicitly selected 50 USD limit and requires at least 1 USD remaining; it does not turn 50 USD into a 5 USD spending cap. Missing/error/stale/ambiguous metadata, mismatched limit and insufficient headroom fail closed. The original broad-suite guard and default 5 USD diagnostic are unchanged.

On 2026-10-11 the official [GPT-6 Sol endpoint metadata](https://openrouter.ai/api/v1/models/openai/gpt-6-sol/endpoints) listed maximum prompt/output/cache-write rates, including long-context tiers, of **8/30/10 USD per million tokens**. The [embedding provider page](https://openrouter.ai/openai/text-embedding-3-small) listed **0.02 USD per million** for both routes. Conservatively charging prompt plus cache write, one 1024/128 completion and up to five 512-token document attempts plus three 64-token query attempts gives **0.02232704 USD** at those advertised rates. This conditional estimate is below 5 USD; it is **not a hard cap**, an atomic reservation, proof of future prices or a bound on other users of the key. Provider-internal routing/retries and billing were not observed. Reset/exclusive use were not confirmed by the user and are not claimed.

## Concrete blocker and shortest operator command

The native isolated completion path ignores `models.providers.openrouter.params` for routing. Its catalog-owned compatibility merge also drops the attempted `openRouterRouting` override. The actual mock request therefore lacks `provider.only`, `allow_fallbacks` and `max_price`. The supported configuration attempted here cannot prove that per-request price admission. Real smoke fails closed with `native_price_routing_unverified` **before credential handoff, native spawn, indexing or Gateway startup**. No successful real smoke is claimed. The small catalog overlay supplies native model metadata only; it is not a model implementation.

No real provider key or authenticated quota was supplied during development. Chat, genuine semantic embedding and model-assisted consolidation are all **unrun/blocked**. Extraction, flush and consolidation remain lifecycle tests outside this one-completion smoke. Changing the 50 USD panel cap or adding more key confirmation flags does not resolve the native routing limitation. A compatible native path must be verified, or the operator must explicitly accept an estimate-only execution policy; this checkpoint adds neither a client workaround nor a new budget subsystem.

From this repository, the existing one-shell hidden-key command is:

```bash
bash --noprofile --norc scripts/bounded-smoke.sh
```

It reads the key only at a hidden prompt, exports it only for the native **quota diagnostic**, clears it on completion/interruption and exits 3 because paid admission is denied. It checks the reported 50 USD limit and prints sanitized numeric quota evidence. **It makes zero chat/embedding/consolidation calls.** Do not interpret this command as a real model test. No secret is placed in command arguments, browser code, Git or project settings. Native errors and raw account labels are not printed.

The direct real-smoke entry is `npm run smoke:bounded`; absent confirmations exits 2 without a quota probe, and supplying all exact prepared flags still exits 3 before credential access. `npm start` continues to provide the genuine no-key keyword memory lab.

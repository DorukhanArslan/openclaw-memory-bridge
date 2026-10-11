# Native budget preflight

Latest delivery correction: the reported provider cap is **50 USD**, while the approved test budget remains **5 USD**. The fixed [bounded native smoke](SMOKE.md) may run after native quota validation because its conservative finite estimate is 0.02232704 USD at the highest current same-model advertised rates. Missing price-routing hints are not a financial blocker for that tiny scope. Run `bash --noprofile --norc scripts/bounded-smoke.sh` to use the existing environment or project-root private `.env` key and execute it once. General paid lab/lifecycle commands remain blocked. The earlier 5 USD instructions below describe the broad preflight diagnostic, which grants no general paid admission. Project `.env` loading is described in [PROVIDERS.md](PROVIDERS.md); it does not grant paid-run admission.

The approved synthetic pair is `openrouter/openai/gpt-6-sol` for chat and `openai/text-embedding-3-small` at `https://openrouter.ai/api/v1` for embeddings, with a total **5 USD** limit. No automatic model routing is selected. Paid execution is currently **blocked**, including native indexing and managed Gateway startup when a credential-backed provider is selected.

## What the pinned runtime exposes

OpenClaw **2026.9.9** has native `status --usage --json --agent main --timeout 10000`. Its bundled OpenRouter provider reads quota metadata and reports `usage.updatedAt` and an `API key budget` billing entry with USD `limit`, `used`, and an optional normalized `period`. The bridge uses that native CLI; it adds no provider HTTP client, SDK, provider registry, or account-management API.

The normalized result does **not** preserve explicit raw `limit_reset=null`. A missing `period` can mean reset disabled, a missing field, or an unrecognized value. It cannot prove a non-resetting limit. The native snapshot also has no atomic spending reservation or verified admission hook covering every agent, utility, retry and embedding request. `llm_input` is an observation hook in this version. A quota snapshot, token estimate, timeout or test opt-in cannot establish a strict total spending ceiling. See native [OpenRouter setup](https://docs.openclaw.ai/providers/openrouter) and the provider's [key-limit documentation](https://openrouter.ai/docs/api_reference/limits).

The small application guard rejects missing, ambiguous, stale, non-USD, unlimited, wrong-limit, resetting, exhausted and near-limit snapshots. It requires exactly 5 USD and at least 1 USD remaining. That 1 USD margin is only a diagnostic threshold; it is not an estimated cost or a reservation. Even a matching snapshot returns `modelRequestsAllowed: false` because the required hard-spend evidence is unavailable.

## Smallest operator-run check

The confirmation flag asserts the exact provider key cap selected by the operator. The current reported cap is **50 USD**; the preflight's default is still 5 USD when the explicit option is omitted. This program neither changes nor independently verifies account settings. Do not pass the confirmation flag until the cap is known.

From the full installation, use the project `.env` or existing authorized environment and run the configuration/quota diagnostic:

```bash
npm run budget:preflight -- --key-limit-confirmed --provider-limit=50
npm run test:budget
```

Use the private project `.env` prepared as described in [PROVIDERS.md](PROVIDERS.md), or an existing authorized environment value. The explicit 50 USD option selects the reported provider cap; omitting it checks exactly 5 USD. The preflight checks required setting presence before creating a fresh synthetic temporary lab, validates the explicit native chat configuration, runs the native metadata command, prints only fixed labels and budget numbers, then removes its temporary lab. No chat, embedding, extraction, consolidation, indexing or Gateway-start command is admitted. The test command uses dummy quota fixtures only.

Exit **2** means confirmation was absent and no native quota probe ran. Exit **3** means paid execution is denied, including when `snapshotEligible: true`. A missing key, unavailable metadata or native failure is denied without exposing the raw status or error. No success exit means paid authorization. The native quota probe has a 10-second native timeout and a 25-second child termination deadline, with forced termination after a further 10 seconds if needed. The wrapper does not retry it. These are process bounds, not spending bounds. Inference calls/tokens/retries/background jobs dispatched by this preflight are all **zero**.

## Scope and remaining blocker

When a managed lab selects native credential references, only the exact native config-validation and quota-status argument lists are admitted; every other native command and managed Gateway startup is blocked before spawn. `LAB_ALLOW_MODEL_REQUESTS=1` cannot bypass this block. Independently owned ready Gateways are outside this managed guard and remain their operator's responsibility. Routing is not a spending or tenant-security boundary.

No authenticated quota probe or paid model acceptance was executed during development. Dummy guard tests and real native configuration/no-key memory tests are recorded separately in [VERIFICATION.md](VERIFICATION.md). The earlier verification evidence is retained.

The remaining decision is how to establish and verify a strict spending boundary for every real request. The pinned native usage interface alone does not supply it, so the paid suite remains pending. No new model-access system is being built here. For immediate no-key recall, use a fresh workspace with no native credential selection, for example `npm run lab -- note keyword-budget-check sample Synthetic cobalt telescope`, then `index` and `search` for that workspace.

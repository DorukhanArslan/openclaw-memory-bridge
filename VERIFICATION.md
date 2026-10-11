# Verification record — 2026-10-10

## Native budget preflight — 2026-10-11

The approved synthetic selection is explicit `openrouter/openai/gpt-6-sol` chat plus `openai/text-embedding-3-small` embeddings, with a total 5 USD limit. Installed OpenClaw **2026.9.9** source exposes a native USD key-limit/usage snapshot and optional normalized reset period. It omits raw `limit_reset=null` evidence and provides no verified atomic admission/reservation for every model, utility and embedding call. Therefore the small application guard never grants paid execution. No new provider HTTP client, SDK, registry or model-access subsystem was introduced.

**Seven dummy budget tests passed**, covering missing/stale/ambiguous data, wrong/unlimited/resetting/non-USD limits, exhaustion, near-limit headroom, confirmation gating, sanitized errors and dispatch blocking. A diagnostic margin is not a cost guarantee. An eligible normalized snapshot still reports `modelRequestsAllowed: false`. The real native configuration test passed after adding denied-index and denied-Gateway assertions; its loopback embedding counter remained **zero**. These are guard/configuration checks, not authenticated account-limit or paid model acceptance.

The final aggregate passed in **254.37 seconds**: **56 tests, 52 passed, 0 failed, 4 skipped, 0 cancelled**. It ran serially with a fresh synthetic HOME and an explicitly empty provider/model environment. The 52 passes comprise 29 synthetic transport checks, 7 dummy budget checks, 4 configuration/native-validation checks and 12 counted native memory/integration checks. Keyword recall, source reads, updates/deletion/reindexing, persistence, workspace separation, native no-model lifecycle, native grounded maintenance, the Python consumer and separately owned ready Gateway all passed. The four genuine model checks remained skipped; no extraction/consolidation/vector/model-flush success is inferred from them.

A separate actual **no-key native `status --usage` JSON check passed** and denied admission when key-budget data was absent. The preflight without its confirmation flag exited **2** before native probing. TypeScript, Biome, installer syntax, both documented private-input Bash blocks, existing CI YAML parsing, whitespace checks and credential/evidence ignore rules passed. Bash input was syntax-checked only. The initial dummy fixture accidentally substituted its default 5 USD for an undefined limit; explicit missing-field fixture coverage repaired that test and the final complete run passed.

No provider key was read or supplied by these checks. No authenticated native quota request, account-setting change, paid inference, model download or new GitHub run occurred. Config-only native handoff and missing-budget rejection are verified; actual authentication, the dedicated key's non-resetting 5 USD setting and genuine model acceptance remain unverified. Selected native credential-backed operations and managed Gateway startup are blocked before dispatch; the ready client remains outside this managed guard.

New raw evidence is local and ignored under `evidence/budget-preflight/`. SHA-256 checks confirm the earlier `evidence/final-verification/` files (45 passed / 4 skipped on `e45ba0b`) are unchanged. This addition remains local with no push. See [BUDGET.md](BUDGET.md) for the smallest same-shell operator-run configuration/quota diagnostic, expected exit codes and the hard-spend blocker.

## Native provider handoff (local preparation)

OpenClaw 2026.9.9 already supplies OpenRouter and other provider plugins. The new managed commands hand off a native provider/model reference or compatible embedding configuration, an env SecretRef, and exact selected env names. OpenClaw owns auth resolution and provider HTTP. The ready Gateway client has no provider changes; its owner configures providers through native OpenClaw.

The pinned CLI accepted the generated builtin-provider overlay and `memory.search.remote.apiKey` env SecretRef. Native schema validation decides supported overlays; a rejected overlay restores the previous lab config. No OpenRouter SDK, provider HTTP client or parallel provider registry was added. Config setup performs no index/Gateway startup. A loopback embedding request counter observed **zero requests** during setup.

**Four configuration checks passed**: selected-name env forwarding, runtime-control rejection and output masking; native model references; explicit provider acceptance gating; and actual pinned CLI validation/rollback with no embedding requests. These are configuration/unit/mock checks, not real provider retrieval or consolidation acceptance.

The final isolated full package on commit `e45ba0b3dc8d19e14e7505d5605736efae874cd6` passed: **49 tests, 45 passed, 0 failed, 4 skipped**, zero cancelled, in **271.27 seconds**. Its local evidence remains under ignored `evidence/final-verification/`. The earlier run had one lifecycle assertion matching the old local-only missing-model message; that assertion was repaired, its targeted rerun passed, and this final full run supersedes the failed run. TypeScript, Biome, install-script syntax, documented Bash-input syntax and diff whitespace checks passed.

The four genuine model checks remained skipped in that run. At that commit, native provider checks required explicit model/endpoint/key-env selection and `LAB_ALLOW_MODEL_REQUESTS=1` after operator budget approval; the later budget guard additionally blocks paid acceptance as documented in [BUDGET.md](BUDGET.md). No actual provider key was read, created, entered, stored or sent by the development checks; no paid/model request ran. Existing secret files were not inspected. Prompt instructions were syntax-checked without executing key input. `.env`/`.env.*` ignore rules were verified; the bridge does not automatically load them. User entry and native runtime resolution remain operator actions; authentication/tool capability and genuine semantic retrieval/extraction/consolidation remain unverified.

This preparation is local only. The earlier `feat/ready-gateway` commit b84951b passed its published GitHub CI; that result does not verify these unpushed changes. See [PROVIDERS.md](PROVIDERS.md) for the exact native handoff and local input flow.

Runtime: **OpenClaw 2026.9.9 (`bcfc888`)**, project-local **Node 24.16.0**. It uses the real native runtime, not a replacement engine or mocked memory responses. Raw machine-specific test outputs and runtime state remain local under ignored directories; this portable record contains no local user paths or credentials.

## Ready-Gateway integration acceptance

The server-side `ReadyGateway` client uses the documented `POST /tools/invoke` envelope and native `memory_search`/`memory_get` schemas, inspected in the pinned installed release. It imports Node HTTP only; a client-only installation needs no local OpenClaw package. Its constructor makes no network request and it exposes no Gateway lifecycle, indexing, write or provider-configuration API. The existing managed lab remains available.

**29 synthetic transport tests passed** (0 failures). These cover fixed agent/session routing and request arguments, pooled sockets, structured/text result envelopes, unavailable/disabled/stale replies, HTTP auth/policy/rate/server errors, connection refusal/disconnect, malformed JSON/UTF-8/result shapes, missing sources, absolute body deadlines, caller cancellation, byte limits, redirects, outstanding-request bounds, closed clients and caller-driven retry. These are HTTP fault fixtures, not engine acceptance. Failure messages do not echo a token, response body, URL or nested transport cause.

The separate **real ready-Gateway test passed**, using the pinned native runtime and a fresh synthetic source. It accepted keyword recall with `provider: none`, actual source reads and missing-source errors. Closing a client left the same independently owned Gateway available to another client. When the fixture owner stopped its Gateway, the client returned `connection_failed`; only the owner started a replacement, which retained native recall. The ready client performed no spawn/restart/stop operation.

One uncontrolled macOS run measured first ready request **176.51 ms** and warm samples **33.38, 23.01, 24.01, 36.32, 25.26 ms** (median **25.26 ms**). The fixture owner's Gateway startup was separately **34.83 s**. The real test took **91.77 s**. These values do not guarantee zero startup, latency, peak resources or general performance. Native initialization and reconnection can still cost time.

Fresh independent source copies, with no dependency/cache/runtime-state/user-config reuse, completed both installers. Full setup installed Node 24.16.0 and OpenClaw 2026.9.9; client-only setup installed Node 24.16.0 without a local OpenClaw package. The minimal copy passed all 29 transport tests and the documented example exited with its expected missing-configuration message before any Gateway call. Full-copy typecheck, lint and installer shell syntax passed. Dependency installation phase output is not a controlled cold-install benchmark.

The local CI definition is parsed YAML and pins official checkout/setup-node v6 commit refs. It defines lint/types, complete synthetic/native tests and a client-only clean setup, with read-only repository permissions and no retained checkout credential. **GitHub has not executed this workflow in this task.** No push, merge or release occurred.

The complete clean-install `npm test` passed in **511.12 seconds**: **45 counted tests, 41 passed, 0 failed, 4 explicitly skipped, 0 cancelled**. The 41 passes comprise **29 synthetic transport tests and 12 counted native runtime checks/subtests**. Managed dreaming, canonical file-memory operations, no-model reset capture, the Python JSONL consumer and ready-Gateway ownership all passed. A native retrieval parent is included in the counted totals; counts are not feature parity scores.

In that full clean run, the separately owned Gateway startup was **16.56 s**, first ready request **36.31 ms**, and five warm requests were **88.85, 47.36, 26.33, 26.81, 27.81 ms** (median **27.81 ms**). Its ready test took **41.76 s**. Keep these observations separate from the earlier standalone run: cache state and OS load were uncontrolled, and neither run promises zero startup or general latency.

Real embedding/chat/consolidation acceptance is still blocked by missing approved model endpoints. The four skips are existing native semantic retrieval, the new ready-client semantic retrieval, genuine dreaming narrative, and model chat/flush/compaction. The ready semantic test joins the existing model gates; missing models are skipped, not simulated. The fixture uses only its managed, temporary in-memory test authentication. No persistent credential was created, saved or discovered; no personal provider configuration, unrelated memory, paid provider or model download was used.

All executable source, tests, installer, lockfile and CI files in the clean copy matched implementation commit `30ec253`; the only later difference was this verification prose. Shell syntax, clean-copy typecheck and lint, workflow YAML parsing, whitespace checks, client-only transport tests and the missing-configuration example check passed. GitHub Actions execution, genuine model output/quality, model-assisted consolidation additions/merges/supersessions and production authorization remain unverified. This stage creates local commits only.

## Accepted original foundation baseline

The last complete baseline ran for **517.1 seconds**: **13 counted tests, 10 passed, 0 failed, 3 explicitly skipped, 0 cancelled**. Typecheck and lint passed. The count includes the retrieval parent and seven behavioral subtests, native dreaming and native lifecycle acceptance.

Accepted with fresh synthetic workspaces and actual private Gateway/CLI processes:

- Markdown write → native forced index → keyword recall with `provider: none`.
- Actual source lines via `memory_get`; score/citation/provenance output retained.
- Different session keys, real Gateway replacement, and a replacement host retaining native memory state.
- Independent workspace corpora using the same note ID without cross-corpus recall.
- Update plus native reindex removing previous content; source deletion plus reindex removing current hits.
- Native grounded REM backfill/staging, completed canonical light→REM→deep cron sweep, native promotion explanation and sourced durable-write/recall path.
- Native session creation with an explicitly labelled synthetic operator transcript fixture, reset lifecycle dispatch, actual asynchronous `session-memory` artifact, source read, replacement-host recall and workspace separation.
- Public same-identity session adoption response for native maintenance metadata, and pinned schema acceptance of workspace-restricted file tools plus model/flush configuration without a text-model call.

## Dreaming limits recorded honestly

Grounded REM staged **4** entries, normalized to **3** short-term entries; the native sweep produced **3 light hits** and **2 REM hits**. Cron reached `completionStatus: succeeded`, while default deep gates retained `promotedTotal: 0` for the tiny fixture. The separate manual `promote-test apply` explicitly passed zero score/count thresholds and appended **3** sourced entries to `MEMORY.md`, subsequently recalled after restart. This proves the native sourced append path, not default-gated model consolidation.

The native diary contained an upstream fallback sentence because isolated completion preparation found no compatible provider authentication. Selected-model metadata is not evidence that an actual completion succeeded. No private provider credentials were inherited and no paid provider call was used.

The lifecycle fixture is not a generated model conversation. Native reset capture is a filtered transcript excerpt, not model-based fact extraction. Time-based daily/idle rollover is supported upstream but has not been accepted in this lab.

## New external contract/repository preparation

The added JSONL v1 host and Python standard-library consumer are application adapters around native CLI/Gateway operations. They expose no generic RPC, arbitrary command, new memory implementation or provider credential setup. They preserve engine errors instead of presenting them as empty hits.

An independent clean source copy, without copied dependencies, runtime state or personal npm configuration, successfully ran `bash scripts/install.sh`: Node 24.16.0 and OpenClaw 2026.9.9 were installed from the official registry using the lockfile. Its typecheck, lint, Python syntax check and installer shell syntax check passed.

The final complete `npm test` on that clean installation ran for **912.6 seconds**: **14 counted tests, 11 passed, 0 failed, 3 explicitly skipped, 0 cancelled**. All accepted original scenarios passed again. The additional actual Python→JSONL→native OpenClaw test verified write/index/recall, source reading, Gateway replacement, error correlation, workspace isolation, host replacement and delete/index/no recall. This test ran for **197.7 seconds** in the complete package. Its separate earlier acceptance run also passed (241.7 seconds).

The first protocol attempt failed when a second simultaneous workspace Gateway did not become ready. Its cause was not proven. The sequential host was then bounded to one active workspace Gateway, matching the terminal shell, and the subsequent standalone and clean-install full-package acceptance passed. No failed run is counted as a pass.

Raw `evidence/`, `.lab/`, temporary test workspaces, caches, logs, `.env` files and Python bytecode are excluded by `.gitignore`. The lockfile is retained for reproducibility. Repository publication is verified separately from this local acceptance record. That baseline had no CI workflow; the ready-Gateway addition prepares one locally as described above.

## Model-dependent acceptance still pending

The baseline's **3 model tests were skipped**, not passed:

- Local vector retrieval: requires a selected embedding server/model; checks semantic recall without shared query words and restart persistence.
- Model-generated Dream Diary: requires a selected text model; waits for new narrative and rejects the known fallback text.
- Actual model chat/agentic memory flush/summarizing compaction: requires a selected tool-capable text model; demands native successful flush metadata, real daily memory content, committed compaction, reset capture and recall.

Accepted additions/merges/supersessions and rewrite preimages during model-assisted deep consolidation remain pending separate review of genuine output. Native candidate gates must pass. Manual compaction does not execute the automatic flush path in this pinned version.

Read-only model discovery found connection refused at common loopback endpoints (Ollama 11434, LM Studio 1234, OpenAI-compatible 8080). No model executable was found on the inspected PATH. The app's `synthetic-chat` setting was a schema fixture, not an installed model. Other ports/installations were not exhaustively searched. Personal credentials/configuration and unrelated conversations were not read; no model weights were downloaded and no paid API was invoked.

The smallest remaining model decision is a running local OpenAI-compatible base URL with a tool-capable chat model ID, plus an embedding model ID for vector acceptance. New model downloads or credential setup require separate authorization.
# Bounded smoke local checkpoint

The final secrets-free regression on the pinned Node 24.16.0/OpenClaw 2026.9.9 installation completed in **330.19 seconds: 64 tests, 60 passed, 0 failed, 4 skipped, 0 cancelled**. Typecheck, lint, Bash syntax, whitespace and negative CLI checks passed. Evidence is retained under ignored `evidence/paid-smoke/`; SHA256 checks confirmed both `evidence/final-verification/` and `evidence/budget-preflight/` were preserved.

The **eight new smoke tests** are preparation acceptance: dummy quota/manual-policy checks, a real-mode denial check and six native-runtime/dummy-provider cases. The native success transport contains a single fixed `openai/gpt-6-sol` completion, `max_completion_tokens: 128`, `reasoning.effort: none`, no tools and **348** conservative input tokens including framing allowance. Exactly one document embedding and one query embedding were observed; source-only readiness added zero embeddings. Completion 429/503 dispatched one request each. A stalled completion was aborted at the native 15-second bound with scheduler tolerance. Transient index and rate-limited query fixtures each dispatched three native attempts, with zero wrapper retry. Background model jobs were disabled. These results do **not** prove genuine model quality or provider billing.

Three early attempts failed because native isolated completion omitted price-routing fields; real admission remains denied rather than counting that omission as a pass. Two earlier fixture assertions failed because they omitted the native note's trailing newline; the exact source assertion was corrected. Those failed attempts are recorded separately in `prior-attempts.json` and are not part of the passing aggregate.

**Real chat: unrun/blocked. Real semantic embeddings: unrun/blocked. Model-assisted consolidation/extraction/flush: unrun/blocked.** All four genuine-model gates remain skipped. The existing no-key native memory/lifecycle tests passed again. No real provider key, authenticated quota probe or paid model call was used. The user-reported 50 USD key cap is separate from the 5 USD test budget. Current native price-routing limitations, the conditional 0.02232704 USD finite estimate and the operator's quota-only hidden-key command are documented in [SMOKE.md](SMOKE.md). No publication, push or merge was performed for this checkpoint.

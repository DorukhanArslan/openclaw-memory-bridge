# Latest verification: native merge and installed Python SDK

The current feature branch verifies real native duplicate consolidation, complete model Dream Diary generation, and a minimal installed Python client. See [test rounds](reports/test-report.html), [sanitized native evidence](reports/native-acceptance-summary.json), and [SDK setup](python/README.md).

Native acceptance passed all six stages: daily agent write, model consolidation, one durable duplicate merge, source reference, complete model diary publication, and durable recall after restart. Native counts are Added 0 / Merged 1 / Superseded 0. Source-session identity was preserved. Unrelated facts remained. This does not verify changed-fact supersession, which requires matching native lineage.

The clean Python 3.12 venv installed the built wheel. A separate app ran with `-I` and passed eleven actual no-key OpenClaw checks: recall, source reads, updates, prompt context insertion, Gateway restart, scope isolation, native reset-hook capture from a labelled fixture, native lifecycle inspection, structured errors, reconnect persistence, and deletion. Three additional Python protocol fixture tests passed; those fixtures test client errors and do not prove model extraction. Syntax, TypeScript, and Biome checks passed. The final serial Node suite completed in 382.18 seconds: **77 tests, 73 passed, 0 failed, 4 skipped, 0 cancelled**. Skipped optional checks are not counted as new model or vector passes. Raw output is local in `evidence/sdk-acceptance/node-tests.log`.

The sampled cumulative provider counter after the successful native test was about 0.22686 USD, below the approved 5 USD ceiling at measurement. No key was manually read or displayed. No credential or account setting changed. The utility output adapter only adds an explicit finite token ceiling; it does not alter native memory semantics. No push, merge, deployment, or package publication occurred for this branch.

## Historical verification records

The records below describe earlier checkpoints. Their then-pending consolidation status is superseded by the current result above; their failures remain failures.

# Verification record

## Current closed checkpoint — 2026-10-11

The independent foundation uses pinned OpenClaw 2026.9.9 and Node 24.16.0 with synthetic notes/conversations. Native acceptance was recorded locally; repository publication and GitHub Actions must be verified separately against the exact commit. Earlier sections below preserve their results at the time they ran; their pending/blocked statements do not supersede this current checkpoint.

The final full regression completed with exit 0 in **347.37 seconds: 75 tests, 71 passed, 0 failed, 4 explicitly skipped, 0 cancelled**. Native no-key memory/write/index/source/update/delete/restart/workspace, lifecycle fixtures, ready-Gateway and consumer tests passed. Synthetic HTTP fault, dummy budget and dummy-provider tests are separate preparation checks. The four skipped broad genuine-model checks are semantic retrieval, ready-client semantic retrieval, Dream Diary narrative and general chat/flush/compaction; their skips are not converted to passes by the fixed provider acceptances.

The targeted finite-budget/native-prepared-fetch/configuration checks passed **8/8**. TypeScript and Biome passed. The final full run includes the core native CLI stdout/JSON repair. The later scenario-only addition of one consolidation recall turn was exercised by the separate actual continuation; it did not receive another full-suite rerun. The fixed lifecycle wrapper also now exits nonzero for an unverified stage, matching the continuation wrapper; that small reporting correction received static checks, without another paid run. No paid acceptance command was added to the default tests.

### Actual provider evidence

The earlier fixed GPT-6 Sol + `text-embedding-3-small` smoke passed native chat, index, semantic search and source retrieval, as recorded below and in [SMOKE.md](SMOKE.md). The later fixed lifecycle accepted genuine conversation, native successful flush, model-produced daily Markdown, native summarizing compaction, genuine reset capture and daily-source recall after actual Gateway replacement/reindex. The initial Markdown snapshots were empty; the application did not prewrite the conversational preference. Native maintenance recorded `memoryFlush.kind: succeeded` and subsequent `compactionCount: 1`.

That lifecycle command still exited 2: after those accepted stages, REM JSON parsing failed because native stderr warning text was mixed with stdout. The adapter now reads stdout separately; the subsequent actual consolidation continuation parsed it successfully. This partial run is not counted as an overall success.

The continuation **copied** the verified model-produced note into a separate synthetic workspace through the application adapter. Original source-session provenance was not preserved. Native REM backfill reported `groundedFiles: 1`, `writtenEntries: 1`, `stagedShortTermEntries: 0`. The subsequent native agent recall turn made four admitted GPT-6 Sol dispatches. A genuine native dreaming cron completed, but reported **zero eligible candidates and zero applied promotions**. Status showed zero recall/grounded signals. `MEMORY.md` remained absent, so durable-promotion and durable-source-recall acceptance failed. Daily-source recall after restart still worked.

Model-assisted consolidation additions/merges/supersessions remain **unverified**, not unsupported upstream. Native light/REM narrative requests were denied before dispatch by the finite model/output contract, and logs explicitly showed fallback narrative generation. Neither those fallbacks, selected-model metadata nor successful cron status is counted as real narrative/model-rewrite acceptance. The fixture's candidate eligibility cause was not isolated. See [LIFECYCLE.md](LIFECYCLE.md) for exact evidence and limits.

### Failed attempts, spending and retained evidence

Earlier actual attempts are preserved separately, not counted as passes: shutting down before asynchronous flush finished; a global-only fetch wrapper that missed the prepared native Undici path; lower-case-method and byte-body admission mismatches rejected before dispatch; and an input-exhausted partial extraction run without a successful observed flush marker. The wrapper now covers the real prepared fetch path, accepts native byte bodies/method case and records counters across native children. The credential-free native-prepared-fetch test verifies rejection before network dispatch.

The finite supervision limits are **16 dispatches, 245,000 serialized input bytes, 14,000 aggregate requested output tokens, 4,096 output tokens per request**, with a conditional **4.83 USD** advertised-rate envelope and no general paid admission. Native retries use the same owner-only ledger. The accepted lifecycle recorded 11 dispatches / 244,404 input bytes / 10,752 requested output tokens; the consolidation continuation recorded 4 / 74,825 / 4,096. Historical attempts used their own retained ledgers; these latest counters are not all-run totals.

The last read-only native quota snapshot reported **50 USD limit and 49.83476954 USD remaining**. The key-counter change from the initial 50 USD snapshot was **0.16523046 USD**, below the approved total 5 USD test budget at measurement. The lifecycle window after the earlier smoke changed by **0.16502010 USD**. Concurrent key use and delayed billing were not isolated; this is not per-generation billing or a guarantee of settled cost. In particular, unchanged immediate continuation counters do not mean its four model requests were free. The final diagnostic made zero model requests and retained `modelRequestsAllowed: false` (exit 3 by design).

Safe evidence remains ignored under `evidence/lifecycle-acceptance/`: `acceptance.json`, `consolidation.json`, `model-produced-daily.md`, `final-budget.txt`, `full-regression.txt`, retained failed-attempt JSON/logs and a compact `result.json`. The project-local key is resolved only through the authorized application loader/native SecretRef path; its value was not manually read, copied or emitted. No persistent credential, provider account setting or Gateway security setting was changed. Private synthetic native children and temporary workspaces were cleaned up. No Gateway was publicly exposed and no deployment was made. Feature-branch publication does not include local credentials or raw runtime evidence.

Paid work is closed. The remaining decision is whether a later, explicitly scoped consolidation acceptance should preserve native session provenance, establish eligible recall signals and admit a verified bounded utility-output shape. No further model retries are running.

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
# Bounded smoke local checkpoint (earlier preparation)

The final secrets-free regression on the pinned Node 24.16.0/OpenClaw 2026.9.9 installation completed in **330.19 seconds: 64 tests, 60 passed, 0 failed, 4 skipped, 0 cancelled**. Typecheck, lint, Bash syntax, whitespace and negative CLI checks passed. Evidence is retained under ignored `evidence/paid-smoke/`; SHA256 checks confirmed both `evidence/final-verification/` and `evidence/budget-preflight/` were preserved.

The **eight new smoke tests** are preparation acceptance: dummy quota/manual-policy checks, a real-mode denial check and six native-runtime/dummy-provider cases. The native success transport contains a single fixed `openai/gpt-6-sol` completion, `max_completion_tokens: 128`, `reasoning.effort: none`, no tools and **348** conservative input tokens including framing allowance. Exactly one document embedding and one query embedding were observed; source-only readiness added zero embeddings. Completion 429/503 dispatched one request each. A stalled completion was aborted at the native 15-second bound with scheduler tolerance. Transient index and rate-limited query fixtures each dispatched three native attempts, with zero wrapper retry. Background model jobs were disabled. These results do **not** prove genuine model quality or provider billing.

Three early attempts failed because native isolated completion omitted price-routing fields; real admission remains denied rather than counting that omission as a pass. Two earlier fixture assertions failed because they omitted the native note's trailing newline; the exact source assertion was corrected. Those failed attempts are recorded separately in `prior-attempts.json` and are not part of the passing aggregate.

**Real chat: unrun/blocked. Real semantic embeddings: unrun/blocked. Model-assisted consolidation/extraction/flush: unrun/blocked.** All four genuine-model gates remain skipped. The existing no-key native memory/lifecycle tests passed again. No real provider key, authenticated quota probe or paid model call was used. The user-reported 50 USD key cap is separate from the 5 USD test budget. Current native price-routing limitations, the conditional 0.02232704 USD finite estimate and the operator's quota-only hidden-key command are documented in [SMOKE.md](SMOKE.md). No publication, push or merge was performed for this checkpoint.

## Finite smoke delivery correction

The final aggregate after removing the unnecessary price-routing admission requirement completed in **320.08 seconds: 64 tests, 60 passed, 0 failed, 4 skipped, 0 cancelled**. The separate targeted smoke suite passed **8/8** in 90.67 seconds. Typecheck, lint, Bash syntax, argument rejection, no-key smoke failure, hidden-prompt EOF and whitespace checks passed. These are preparation/native-runtime/mock-provider results; genuine provider/model acceptance is not counted as a pass.

Official same-model endpoint prices were rechecked on 2026-10-11. Budgeting one 1024-input/128-output completion at the highest advertised input/output/cache-write rates across all GPT-6 Sol tiers, plus five document and three query embedding attempts, gives the conservative **0.02232704 USD** estimate. Missing optional routing hints are therefore not a blocker for this fixed scope under the approved 5 USD test budget. OpenClaw retains a fixed model reference, no model/provider fallback, one zero-tool isolated completion, native output/deadline bounds and native embedding retries. No provider client, account setting, general paid-suite gate or engine implementation was replaced. Native quota JSON now reads stdout separately from stderr warnings.

`bash --noprofile --norc scripts/bounded-smoke.sh` now performs the fixed **real chat + embedding + source-read smoke once**, after native quota validation for the reported 50 USD key cap. The caller enters the key privately. No additional reset/exclusive-use confirmation is inferred or required; those account-wide claims are not made. Native/provider failures stop the workflow. This local correction was verified without real credentials or paid calls.

**Real chat and semantic embeddings: ready for the operator, unrun by the developer. Authenticated real-provider quota: unrun. Model-assisted consolidation/extraction/flush: pending and outside this finite smoke.** All four genuine-model tests remain skipped. The broader suites remain blocked. Native metadata transport against the extra loopback quota fixture returned unavailable and was not accepted as real quota proof; normalized quota fixtures remain explicit mocks. Failed targeted attempts are recorded separately.

Evidence is under ignored `evidence/finite-smoke/`, including aggregate logs/results, static checks, source hashes, targeted results and official-price references. SHA256 verification confirmed all three earlier evidence folders were unchanged. No push, publication or merge was performed.

## Project-local environment correction — 2026-10-11

The application now loads the exact project-root `.env` with pinned Node's dotenv parser. Existing process settings, including empty ones, take precedence. Runtime commands, all npm test commands and the bounded smoke use that same file even when launched from another working directory. Native OpenClaw provider transport, SecretRefs and spending gates remain intact. No dependencies were added.

The prepared local `.env` is keyless, owner-only (0600) and Git-ignored. Only the empty `.env.example` is tracked. The loader never writes credential files, evaluates shell text or logs values. Missing required settings stop the smoke before workspace creation/native execution and direct the operator to a local editor. Runtime-control settings, symlinks and invalid values produce sanitized errors.

Validation: **71 tests, 67 passed, 0 failed, 4 skipped**, 359.58 seconds. The seven new environment tests passed both separately and in the full suite. They cover environment precedence, parsing without evaluation, another working directory, npm-style test preloading, the smoke wrapper with synthetic keys, missing-key early exit, sanitized errors, atomic validation and Git exclusion. Actual no-key native memory/persistence/workspace and provider-config regressions passed; smoke provider responses are dummy loopback fixtures. The four genuine model checks remain skipped. Type checking, lint, Bash syntax and diff-whitespace checks passed.

Value-free summaries and the complete synthetic test log are in ignored `evidence/project-env/`. Initial development checks exposed a test-reporter assumption and a TypeScript narrowing issue; both were corrected before this final run. No real key was read, copied, written or requested. No real-provider, paid chat, embedding or consolidation call ran; their acceptance remains pending. No push occurred.

## Native HTTP compatibility and credential checkpoint — 2026-10-11

After the operator entered their own project `.env` key, required-setting presence passed. The first bounded smoke failed; native metadata reported `Usage unavailable`. A credential-free loopback reproduction showed Node 24.16.0's built-in fetch rejecting OpenClaw's Undici 8.10.2 dispatcher with `UND_ERR_INVALID_ARG`, while bundled Undici fetch succeeded. `src/native-bootstrap.ts` now preloads that same bundled fetch in the private native CLI/Gateway child and verifies the three pinned versions. It changes no provider endpoint, secret management, TLS/SSRF policy or memory implementation. The regression confirms SSRF still rejects an unapproved loopback request.

Targeted validation: **13 tests, 13 passed, 0 failed**, 101.14 seconds. These include the compatibility reproduction, guarded native fetch, native SecretRef config validation and dummy-provider completion/embedding/error/timeout scenarios. Type checking and lint (34 files) passed. The earlier 71-test aggregate predates this compatibility correction; it was not rerun for this checkpoint. Evidence is in ignored `evidence/native-http-compat/`.

Post-fix native metadata succeeded: exact **50 USD** key limit, **0 USD** used, **50 USD** remaining at the check. This was a read-only authenticated `/credits`/`/key` probe; model requests were zero. No key value, account label or raw status was emitted, and the application did not modify the operator's `.env`. Metadata authentication does not establish model access or semantic/model-assisted memory acceptance.

Automatic approval review rejected a duplicate pre-fix metadata variant; it was not executed. After the credential-free reproduction and tested fix, the first post-fix native quota check was approved and passed. Review then rejected the concrete paid smoke because the visible user messages did not explicitly authorize its chat/embedding spending. That paid command was not executed. One fixed smoke, estimated at 0.02232704 USD under the documented price assumptions and separate 5 USD test budget, awaits explicit operator approval. Real chat/embedding and consolidation remain unaccepted. Safe checkpoint details are in `evidence/live-smoke/`.

## Approved finite real-provider acceptance — 2026-10-11

The earlier approval blocker is resolved. With the existing human approval verified, the same fixed command was retried once and completed with exit 0 on implementation commit `68a6a6d`. No additional paid run followed it. No provider configuration, credential file or account setting was changed, and no push occurred.

Actual private OpenClaw 2026.9.9 CLI/Gateway acceptance passed:

- Native `llm-task` used `openrouter/openai/gpt-6-sol` and returned `{"ok":true}`.
- Native indexing used `openai/text-embedding-3-small` for one fixed synthetic note.
- Native `memory_search` returned one hit at `memory/resident.md` for `pedal-powered commuting`.
- Native `memory_get` returned the checked source text, `Zephyr travels to the office by bicycle.`

The initial native key snapshot reported a 50 USD limit, 0 USD used and 50 USD remaining. One subsequent read-only native cost probe reported 49.99978964 USD remaining. The measured key-counter difference is **0.00021036 USD**, below the separate approved **5 USD** test budget. This is a test-window counter delta; concurrent key use was not excluded and separate per-generation billing was not obtained. The conservative pre-run estimate was 0.02232704 USD and was not a hard spending cap. The cost probe exited 3 by design because general paid-suite admission remains denied despite an eligible quota snapshot; the metadata read itself succeeded and made zero model requests.

There were zero wrapper retries. Native provider price-routing hints remain unverified. Agent lifecycle, model-assisted consolidation, extraction and flush were not exercised by this finite smoke and remain pending. This real acceptance is separate from the 13/13 targeted compatibility/mock-provider checks and the earlier 71-test aggregate; it does not convert their four skipped broader model checks into passes. Type checking and lint passed for the implementation checkpoint, with no executable changes during this documentation update.

Safe output, the cost snapshot and the structured result are under ignored `evidence/live-smoke/real-smoke.txt`, `cost-after.txt` and `acceptance.json`. The project key was consumed through the approved application loader/native provider path; its value was never manually read or emitted. The temporary synthetic smoke workspace and native processes were cleaned up.

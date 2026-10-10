# Verification record — 2026-10-10

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

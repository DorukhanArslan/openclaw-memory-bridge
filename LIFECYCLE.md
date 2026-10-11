# Native lifecycle acceptance — 2026-10-11

This lab uses OpenClaw 2026.9.9's existing agent lifecycle. The application supplies synthetic input, supervises requests and observes native files/RPC results. It does not extract facts, summarize conversations or implement consolidation itself. The latest acceptance below supersedes the earlier failed continuation. No new paid run is scheduled.

## Latest real native consolidation and diary acceptance

The official `agent --local` operator path produced a daily duplicate in the same native workspace that held its source session. The source session ID was unchanged after Gateway restart. Generic `gateway call chat.send` uses method-minimal scopes in this release and produces non-owner memory provenance; its earlier daily write was recalled but rejected for promotion. No stored trust label, native database, security setting, or operator scope was edited to bypass that check.

The baseline durable duplicate was an explicit synthetic application fixture with matching project scope. The daily source was genuinely written by the native model. Native validated consolidation reported **Added: 0, Merged: 1, Superseded: 0**. The writer replaced the duplicate with one sourced entry and its promotion marker. All four unrelated facts remained. Light, REM, and deep diary publication completed with real model text and no fallback. After native reindex and Gateway replacement, `memory_search` recalled `MEMORY.md` with source lines.

[Sanitized before/after evidence](reports/native-acceptance-summary.json) records these checks. Raw synthetic evidence remains ignored in `evidence/provenance-merge-acceptance/acceptance.json`. The native source workspace is retained locally for audit. Earlier failed scenarios are retained separately and are not counted as successes. [Each test round](reports/test-report.html) states its actual result.

The pinned native utility completion path omits an explicit output-token limit. The application transport adds `max_completion_tokens: 2048` only for this fixed approved model/profile when both native output fields are absent. It preserves model, prompt, tools, source provenance, and the native consolidation algorithm. This is a budget adapter. It is not a new memory capability. Aggregate limits are 16 dispatches, 180000 serialized input bytes, 40000 output tokens, and 8192 tokens per explicitly bounded request. Their conservative advertised-rate envelope is 4.44 USD. The current cumulative usage plus that envelope is checked against 5 USD before dispatch. Native retries share the same owner-only ledger.

The passing scenario made six dispatches, with 39479 serialized input bytes and 10240 reserved output tokens. The immediate sampled cumulative key counter was about 0.22686 USD. Provider counters can lag and include concurrent key use; this is not settled per-generation billing or an atomic provider reservation.

**Changed-fact supersession is not tested.** Native validation requires matching lineage and prevents merges between different facts or project groups. The earlier changed-preference scenario failed those checks and used append-only fallback. The successful duplicate merge does not imply arbitrary automatic updates. Python note update/delete tests exercise application Markdown adapters followed by the native index.

## Accepted genuine model behavior

The fixed two-turn conversation used `openrouter/openai/gpt-6-sol`. The starting workspace and the snapshot after the first turn contained no memory note. After enabling the native 1 KiB test flush trigger, OpenClaw wrote this daily Markdown:

```text
- User's durable standing preference for synthetic Project Borealis (an imaginary observatory rehearsal used only in this lab): use indigo filters every Thursday.
```

Accepted evidence in ignored `evidence/lifecycle-acceptance/acceptance.json`:

- Genuine model conversation; no application-prewritten preference note.
- Native `memoryFlush: { kind: "succeeded", compactionCount: 0 }` and the actual daily file above. Both are required; a configuration flag alone is insufficient.
- Native `memory_get` returned the daily source and its lines.
- Native summarizing compaction committed (`compacted: true`, stored `compactionCount: 1`).
- Native reset capture produced a separate transcript artifact from this genuine conversation.
- Following actual Gateway replacement and native reindexing, `indigo`, `indigo filters` and `Borealis Thursday` each recalled the daily source. This accepts daily-source persistence, separately from durable promotion.

This run dispatched 11 supervised native requests, with 244,404 serialized input bytes and 10,752 requested output tokens. Its later REM step stopped on a native stderr warning mixed into JSON; the full command exited 2. The JSON adapter now reads stdout separately. The already observed stages remain accepted; the interrupted run is not an overall success. The separate continuation below verified the repaired CLI parsing.

## Historical consolidation continuation: not accepted

The continuation copied the verified model-produced daily note into a **fresh, separate synthetic workspace**. That copy is an application adapter; it does not preserve original source-session provenance or prove automatic end-to-end consolidation of the original conversation. One genuine agent recall turn and three native keyword queries followed.

Native REM backfill reported one grounded file and one written entry, but zero staged short-term entries. The light→REM→deep sweep completed with `completionStatus: succeeded`; its native log reported `candidates=0, applied=0, failed=0, narrativesPending=2`. Status reported three short-term entries, zero recall signals and zero grounded signals. Test gates were explicit `minScore: 0`, `minRecallCount: 1`, `minUniqueQueries: 1`, with at most two deep candidates. The exact cause of signal eligibility was not isolated.

`MEMORY.md` was absent both before and after the sweep. There was no accepted native Added/Merged/Superseded rewrite summary, and no durable `MEMORY.md` source to recall after restart. The daily source still recalled after restart. **Durable promotion failed acceptance; model consolidation is unverified.** A successful cron status does not prove either behavior.

Native light/REM narrative requests also failed the finite model/output admission contract and were denied before dispatch. Native logs explicitly recorded fallback narrative generation. That prose is not accepted as genuine model-generated Dream Diary output. The four admitted requests in this continuation belong to its agent recall turn; they do not establish a consolidation completion.

Safe before/after sources, recall, native status and filtered diagnostics are retained in ignored `evidence/lifecycle-acceptance/consolidation.json`; the continuation exited 2. Upstream supports model-assisted consolidation, but this fixture did not exercise an eligible deep rewrite. No further paid retry was made. A future acceptance needs eligible native recall evidence with intact session provenance and a bounded native utility-output contract.

## Finite supervision and cost

Only the fixed acceptance operations temporarily admit native GPT-6 Sol requests. The shared ledger limits each operation to 16 dispatches, 245,000 serialized input bytes, 14,000 aggregate requested output tokens and 4,096 output tokens per request. Native retries consume the same ledger. Unknown remote requests or requests without the verified model/output shape are rejected before dispatch. The private preload guards both global fetch and OpenClaw's actual prepared bundled-Undici fetch path. It logs counters, not credentials, headers or request content.

At the documented maximum prompt-plus-cache-write/output rates of 18/30 USD per million, the conservative envelope is **4.83 USD**. Before each operation, that envelope plus the native key's observed prior usage had to fit the approved total **5 USD** test budget. This is conditional supervision, not a provider billing guarantee or atomic reservation against concurrent key use. The provider key cap is separately **50 USD**. Credential resolution, provider transport, SSRF controls, memory operations and lifecycle execution remain native OpenClaw responsibilities.

The final read-only snapshot reported **49.83476954 USD remaining**, a **0.16523046 USD** key-counter change from the initial 50 USD snapshot across smoke and all lifecycle attempts. The lifecycle window after the earlier smoke changed by **0.16502010 USD**. Counter timing and concurrent use were not isolated; unchanged intermediate counters do not imply zero cost. The final probe made zero model requests and exited 3 because general paid admission remains denied. See ignored `final-budget.txt` and `result.json` in the lifecycle evidence directory.

The fixed commands used for this checkpoint were:

```bash
./node_modules/node/bin/node examples/lifecycle_acceptance.ts
./node_modules/node/bin/node examples/consolidation_acceptance.ts
```

Both have already consumed their owner-only ledgers and reject automatic repetition. They are not routine launch commands; do not delete/reset a ledger to bypass that protection. General credential-backed lab execution remains guarded. The regular no-key CLI and tests remain runnable; see [README.md](README.md).

## Native limits

Built-in memory does not promise model extraction after every conversation. This acceptance used the native test flush threshold; it does not prove normal default-threshold timing or daily/idle rollover. Manual compaction does not invoke automatic flush in this pinned release. Reset capture is a transcript artifact; the separate daily file and successful flush marker are the extraction evidence. A fallback append or selected-model label is insufficient evidence of an accepted model rewrite. See the official [flush documentation](https://docs.openclaw.ai/reference/session-management-compaction/housekeeping) and [dreaming documentation](https://docs.openclaw.ai/concepts/dreaming).

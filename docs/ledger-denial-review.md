# Ledger denial race review — 2026-10-12

Review [4246232278](https://github.com/DorukhanArslan/openclaw-memory-bridge/pull/2#discussion_r4246232278) was reproduced on merged main `7eb0119` and local demo commit `378e43e`. A deterministic two-process fixture pauses a denied request after its first ledger read, lets a separate process admit a bounded request, then resumes denial. The old denial write replaced counters 4 with the stale counters 3. This is a synthetic reproduction, not evidence of actual excess spending or historical ledger corruption.

Denial recording now acquires the same exclusive `.lock` as admission, rereads the ledger while holding it, and preserves those fresh counters when adding `lastDenial`. The no-follow regular-file descriptor checks remain unchanged. An occupied lock fails closed without modifying the ledger or removing the other owner's lock. The demo branch applies the same fix to its per-request input denial.

Before the fix, main's three new regression cases failed; the local demo's five failed. After the fix, the deterministic process races preserve request, input-byte and output-token counters, retain the profile, and reject further admissions at each aggregate request limit. The existing link/nonregular-file regressions still pass.

Final targeted verification: main-only checkout **13/13 passed**, local demo checkout **16/16 passed**. TypeScript and Biome passed in both. One initial sandboxed transport check failed with loopback listen EPERM; the authorized local-loopback rerun passed. No new full-suite run was performed for this narrow fix. Main's independent GitHub CI run [38226931962](https://github.com/DorukhanArslan/openclaw-memory-bridge/actions/runs/38226931962) passed on the pre-fix merge commit; it does not verify this unpublished fix.

Tests use newly created temporary synthetic ledgers and credential-free child environments. No real model/provider requests ran. Existing ledgers, conversation records, Library reports and the user's credentials were not changed. Both fixes are local only; no push or new merge occurred.

Local logs: `/tmp/openclaw-ledger-race-{main,local}-red.log`, `/tmp/openclaw-ledger-race-{main,local}-final.log`.


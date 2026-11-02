# OpenClaw Memory Bridge — Port Delivery

The basic port is complete. The delivery is a trusted local TypeScript bridge and installed Python SDK for the pinned OpenClaw memory engine. Optional engine features and historical investigations do not extend this delivery's acceptance criteria.

## Acceptance criteria

| Requirement | Executable verification |
| --- | --- |
| Write a note, index it, search it, and read its cited source | `python/tests/test_readme_cases.py`: SDK-01 and SDK-02 |
| Update and delete notes without stale search results after indexing | SDK-03 and SDK-04 |
| Preserve memory across Gateway restart, a new client process, and a new session | SDK-05 |
| Route different workspace/user pairs to separate corpora | SDK-06; routing is not authentication |
| Read scoped profile sources and reject invalid paths/ranges | SDK-02 and SDK-10 |
| Keep search within the memory corpus and reject transcript-file reads | `tests/session-corpus-contract.test.ts` |
| Preserve transport, timeout, and native-runtime regressions | Full Node and installed-Python suites, typecheck, and lint |

The host application supplies authentication, its conversation history, and prompt insertion. The SDK's session controls inspect native sessions; they do not make external Python chat history OpenClaw-owned.

## Final verification

Verified November 2, 2026 with OpenClaw 2026.9.9 and Node 24.16.0:

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Full Node suite, including the memory/session source contract | 245 | 0 | 8 |
| Full installed-Python SDK suite | 103 | 0 | 7 |
| Typecheck and lint | Passed | 0 | — |

The Node suite ran all current test files with two concurrent file workers. Python ran against the installed SDK, whose client source matches the checkout. Genuine provider tests retain their explicit gates; the eight optional Node skips and seven Python historical/unsupported skips are not passes. No new paid inference was performed.

Search now explicitly selects the native memory corpus. The real-native regression verifies that saved notes can be recalled and read, owned-session history remains inspectable separately, transcript-only fixture text is excluded from memory results, and transcript-file reads are rejected. Historical reports, dependency pins, and consumed request records remain unchanged.

```sh
npm run typecheck
npm run lint
node_modules/node/bin/node --import ./src/load-env.ts --test --test-concurrency=2 tests/*.test.ts
FOUNDATION_ROOT="$PWD" .bootstrap/python/bin/python -m unittest discover -s python/tests -v
```

## Optional work

Automatic changed-fact supersession, broad ranking-policy studies, media embeddings, and searchable session corpora are outside this port's delivery scope. The historical closed-owner diary failure remains recorded; later successful runs do not explain its original cause. No additional feature work is required to satisfy the acceptance criteria above.

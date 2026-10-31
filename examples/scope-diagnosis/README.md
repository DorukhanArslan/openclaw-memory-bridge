# Deep Diary Scope Diagnostics

This directory contains diagnostic tools for the unresolved historical deep Diary failure, `Async work scope is closed`. The original run passed 19 of 20 checks; the deep Diary publisher failed. Later matched maintenance completed successfully without a production SDK fix. Neither a later pass nor an induced closed-owner experiment establishes the original initiating cause.

The required evidence is a native rejection stack joined to the same scope's creation, tracker registration, deep-completion entry, and drain/close caller, with matching source and candidate state across SDK and direct native routes. See [the required evidence](../../reports/native-sdk-parity.json) and [the prior investigation](../../reports/sdk-diary-closeout-audit.json).

## Prepare and check observation without model calls

Run the following from the repository root. This copies source and installed dependencies into a disposable runtime outside the checkout. It does not copy memory state, ledgers, `.env`, or credentials. Keep the copy separate: instrumentation must not modify production files.

```sh
set -eu
foundation_root="$PWD"
scope_case=$(mktemp -d /workspace/scratch/openclaw-scope-capture.XXXXXX)
mkdir "$scope_case/runtime"
cp -a --reflink=auto "$foundation_root/src" "$foundation_root/node_modules" "$foundation_root/package.json" "$foundation_root/package-lock.json" "$scope_case/runtime/"
python3 examples/scope-diagnosis/instrument.py "$foundation_root" "$scope_case/runtime" "$scope_case"
node_modules/node/bin/node examples/scope-diagnosis/check.mjs "$foundation_root" "$scope_case"
```

`cp --reflink=auto` is the Linux copy option used in this environment; use an equivalent independent copy on other systems. Do not replace it with hard links or symlinks to production files.

The preparation command validates compatibility before patching and verifies original hashes. Its manifest and patch describe the disposable changes. The check exercises the real pinned scope primitive and records its original rejection stack; it sends no model requests and does not run maintenance. It is an observer check, not evidence that the original failure has been reproduced.

The observer records scope identity, owner identity, lifecycle transitions, phase, and call stacks. It includes `narrative-completion-enter` immediately before the native completion call and `narrative-completion-error` when that call rejects. Original exception text is restricted to the target closed-scope error; prompts, completion results, credentials, and arbitrary provider error payloads are not trace fields. Tracing can affect scheduling, and observations remain specific to the process and thread that produced them.

## Analyze an actual matched capture

`analyze.py CASE_DIRECTORY` expects `result.json` and `scope-events.jsonl`. It reports missing or invalid evidence explicitly. Missing manifests cannot prove identical source state, an empty trace cannot establish lifecycle order, and a healthy continuation is not a captured causal rejection. The analyzer includes `sdk-continuation` rather than silently dropping that route.

The existing `run.py` is a live matched-maintenance runner. It requires retained `.lab-test-parity` state, host and native ledgers, an eligible synthetic corpus, configured provider access, and sufficient allowance for both routes. The prepare/check commands above do not satisfy those prerequisites or authorize a live run. Do not reset ledgers, reconstruct missing historical state as if original, or repeat an uninstrumented paid run to fill an evidence gap.

## Focused offline regression checks

```sh
FOUNDATION_ROOT="$PWD" .bootstrap/python/bin/python -m unittest discover -s python/tests -p 'test_scope_*.py' -v
```

These checks cover the diagnostic tools. They do not replace model acceptance or identify the initiating cause of the original historical failure. Preserve the historical reports and leave the causal investigation open until the required trace exists.

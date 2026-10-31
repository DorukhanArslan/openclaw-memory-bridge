# Retained Evidence and Report Reproduction

The committed JSON and HTML in this directory describe historical runs. Rendering their HTML again does not execute tests, call a model, or establish that the same behavior passed in a new environment. Failed results and unresolved causes must remain visible.

## Reproduce four HTML reports from a clean checkout

Python 3.10 or newer is sufficient. No installed SDK, Node runtime, provider credentials, or `.env` file is needed for this render-only command:

```sh
python3 scripts/render_reports.py --output-dir .bootstrap/rendered-reports
```

The command also accepts `--foundation /absolute/path/to/checkout` and works from another working directory when invoked by its full script path. It imports the local SDK source only to satisfy the existing renderer imports; it never constructs a memory client or provider.

| Tracked JSON input | Reproduced HTML |
| --- | --- |
| `reports/test-rounds.json` | `test-report.html` |
| `reports/host-agent-memory.json` | `host-agent-memory.html` |
| `reports/residence-memory.json` | `residence-memory.html` |
| `reports/native-sdk-parity.json` | `native-sdk-parity.html` |

All inputs are read and all four views are rendered before destination writes. Use a separate output directory: the wrapper refuses the canonical `reports/` directory and linked output files. The HTML should be byte-identical to the committed views for the same inputs and renderer versions. Input records are not modified. The test-round report can also be rendered alone with `python3 scripts/render-test-report.py --output-dir .bootstrap/rendered-reports`.

## Optional historical model audits

The six historical MODEL-01 through MODEL-06 audits require three original records that are not tracked by Git:

| Path relative to the evidence directory | Audits |
| --- | --- |
| `live-smoke/acceptance.json` | MODEL-01: semantic recall and source |
| `lifecycle-acceptance/acceptance.json` | MODEL-02/03/04: extraction, flush, compaction |
| `provenance-merge-acceptance/acceptance.json` | MODEL-05/06: duplicate merge and model diaries |

Inspect their availability without printing payloads or making provider calls:

```sh
python3 scripts/evidence_status.py --json
python3 scripts/evidence_status.py --require-complete --json
```

The first command is an optional inventory: missing files are reported as missing with `complete: false`, while its exit status remains zero. The second exits nonzero if any required record is unavailable. A present malformed, non-object, or unreadable record is an error in both modes. Availability and JSON shape do not establish that an acceptance assertion passed.

The default directory is `<checkout>/evidence`. To use a preserved archive outside the checkout, point directly at the directory containing the three case subdirectories:

```sh
python3 scripts/evidence_status.py --evidence-root /absolute/path/to/preserved-evidence --require-complete --json
BRIDGE_EVIDENCE_ROOT=/absolute/path/to/preserved-evidence \
FOUNDATION_ROOT="$PWD" .bootstrap/python/bin/python -m unittest discover -s python/tests -p test_readme_model_evidence.py -v
```

With no records, the default audit run skips MODEL-01 through MODEL-06 and reports each exact missing path. Strict audit mode makes missing records fail:

```sh
BRIDGE_EVIDENCE_ROOT=/absolute/path/to/preserved-evidence \
BRIDGE_REQUIRE_MODEL_EVIDENCE=1 FOUNDATION_ROOT="$PWD" \
.bootstrap/python/bin/python -m unittest discover -s python/tests -p test_readme_model_evidence.py -v
```

`BRIDGE_REQUIRE_MODEL_EVIDENCE` accepts only `0` or `1`. It does not authorize or dispatch model calls. Invalid present records and failed evidence assertions are never converted into skips. MODEL-07 remains a separate unsupported-supersession skip even in strict mode.

Obtain the preserved genuine records from the original operator or archive. Review them for sensitive information before sharing; the entire `evidence/` directory remains ignored. The tracked feature-tour JSON does not embed all three raw records. Report excerpts and synthetic loader fixtures cannot substitute for them. In particular, the current bounded-smoke runner does not produce the legacy MODEL-01 schema. Do not replay paid lifecycle or provenance runners merely to fill these historical input paths, and do not reset consumed ledgers.

## Builders that still require original context

These builders curate raw historical records rather than simply rendering tracked JSON. They preflight required JSON inputs and stop with the missing or invalid paths before replacing reports. `BRIDGE_EVIDENCE_ROOT` applies to their raw evidence inputs as well.

| Builder | Additional requirements |
| --- | --- |
| `examples/build_maya_maintenance_report.py` | `maya-maintenance-2026-10-13/acceptance.json`; original path context must remain compatible with its redaction contract. |
| `examples/build_conversation_report.py` | `e2e-conversation/conversation.json`, `sdk-recall.json`, `request-ledger.json`; optional `final-answer.json`; matching retained workspace under `.lab-test-e2e-conversation/<route>/workspace`. Raw JSON alone does not satisfy the workspace equality check. |
| `examples/build_memory_story.py` | The three historical acceptance files above; tracked conversation and application JSON; README; pinned installed runtime source files; existing `chatbot-memory-demo.html` with a main element. Optional maintenance, host-agent, and consolidation JSON affect the output. |

The feature-tour builder validates its base HTML and loads any present optional JSON before construction. It constructs all JSON and HTML outputs before replacing any report, so missing fields discovered while rendering do not leave partially rebuilt historical content. These builders retain their canonical output locations; use an isolated checkout with the authentic retained context if rebuilding them. The four-report renderer above is the supported path when only the committed JSON is available.

## Focused offline checks

```sh
FOUNDATION_ROOT="$PWD" .bootstrap/python/bin/python -m unittest discover -s python/tests -p test_evidence_status.py -v
FOUNDATION_ROOT="$PWD" .bootstrap/python/bin/python -m unittest discover -s python/tests -p 'test_report_*.py' -v
```

Loader and preflight tests use clearly labelled synthetic inputs. They verify missing/invalid-input handling and output preservation, not model capability. Reproduction tests use committed report data in a temporary clean checkout without `evidence/`, installed dependencies, or credentials, and compare generated HTML with the committed views.

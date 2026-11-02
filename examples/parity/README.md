# Durable Comparison Traces

The comparison harness records private application-level traces before Gateway restart and process replacement. The journals are separate from the existing exact replay tapes and are enabled by the future `run.py` and `diagnose.py` flows. Existing consumed runs and historical reports are not reconstructed or overwritten.

## Model-free runtime check

Use the installed Python SDK and an unused output directory:

```sh
FOUNDATION_ROOT="$PWD" .bootstrap/python/bin/python examples/parity/trace_smoke.py \
  --foundation "$PWD" --root "$PWD/.lab-test-parity-trace-check"
```

This writes a labelled synthetic note, indexes it in keyword mode, searches and reads it through the actual installed SDK and native runtime, restarts the SDK Gateway, and recreates the native driver. It selects no model credentials and requests no inference. The original native journal remains open across driver generations; its prefix is checked before replacement and again after sealing.

The existing paid comparison examples retain their independent admission and replay restrictions. Adding traces does not authorize provider traffic, extend a request allowance, or make those examples ready for general paid execution.

## Recorded surfaces

- Native CLI arguments, complete separate stdout/stderr, exit status and timeout/error outcomes.
- Native Gateway daemon streams, collected within fixed bounds and redacted before journaling at stop.
- Direct native and SDK `/tools/invoke` requests, response bodies, observed HTTP status and error outcomes.
- SDK JSONL requests/responses, child stderr and explicit lost-ack outcomes.
- Coordinator stages, generation boundaries and durable barriers before restart, shutdown and process replacement.

Records include capture identity, producer route/PID, sequence number, UTC wall time, monotonic nanoseconds, generation, operation identity and start/end state. Sequence and monotonic ordering belong to one producer. Cross-process stages use explicit coordinator barriers; timestamps alone are not a global total-order guarantee. Separate stdout/stderr are retained without claiming their byte-level interleaving.

Provider HTTP traffic, authentication headers and private runtime owner instrumentation are outside this capture contract. These traces do not identify the cause of the original `Async work scope is closed` failure or recover its missing original wire events.

## Durability and completion

Each journal is created exclusively with mode `0600` under a private `0700` directory. Every complete event is written in full and fsynced before the action is forwarded or its outcome returned. Restart barriers also fsync a durable prefix. The default event/body bound is 8 MiB; overflow is an explicit capture failure, not silent truncation. Gateway stream collectors are independently bounded.

Only a journal with valid identity, ordering, matched operations and a final `trace.complete` footer is sealed. An interrupted journal remains an inspectable prefix. Readers never repair, truncate, append to, or relabel it as complete. A private manifest records expected producer files and their actual SHA-256 hashes. Missing producers, mixed captures, duplicate producer names, unfinished operations and poisoned writes prevent a complete-capture result.

`complete` describes recorded evidence, not scenario success. A fully observed HTTP error can have a complete trace while the operation fails. Native command/direct-HTTP bytes that are not UTF-8 can be retained as explicitly labelled, redacted base64. The SDK JSON observers reject invalid UTF-8 before forwarding it. A lost response body, unsupported data or uncertain recording cannot pass as complete. Reports keep `ok` false until required journals are sealed; failures are not converted into passing model evidence.

## Privacy and exact replay

Known configured credentials and every observed/generated Gateway token are registered in memory and redacted, including echoes split across incoming chunks. Credential-labelled fields, bearer strings and credential-bearing URLs are also masked. Request authentication headers are never recorded. Journals can still contain application conversations and source text, so they remain private local evidence.

The original protocol and successful HTTP tape object shapes, ordering, duplicate values and provenance fields remain unchanged. If an exact replay payload would disclose a secret, recording fails rather than storing the secret or silently altering the replay. Trace files are diagnostic records, not replay input.

No journal, capture manifest, local model result, credential, or consumed allowance is automatically committed or published.

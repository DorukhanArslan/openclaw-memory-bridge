# OpenClaw memory bridge for Python agents

**Review draft. Do not replace or publish README yet.** The new examples and scenario tests are local proposal files. The SDK branch is published at `961cb42`. This draft uses basic STE writing principles. It does not claim formal ASD-STE100 certification.

## What your agent gains

Your app can save a fact, recall it later, and inspect its source. It can put that fact into an agent prompt. The fact can survive a process restart. Your app can also update or remove its own notes.

The Python package is a client for the existing TypeScript bridge. OpenClaw does the indexing, search, and source reads. The bridge writes application notes and runs a private local Gateway. A Gateway is the OpenClaw process that serves native tools.

An index is the engine's searchable representation of note content. A source is the file and line range behind a recalled fact. An embedding represents text as numbers for meaning-based search. Lineage is a native link between a replacement fact and an earlier memory.

The SDK does not run your language model. It does not save every chat message or extract facts from your external agent by itself. Your app supplies the memory content and decides when to recall it.

## Start without a model key — SDK-00 and SDK-01

Use Python 3.10 or newer. The commands below use Python 3.12. The runtime is pinned to Node 24.16.0 and OpenClaw 2026.9.9. A fresh foundation install needs npm. Run these commands from the foundation repository:

```sh
bash scripts/install.sh
python3.12 -m venv .bootstrap/readme-venv
.bootstrap/readme-venv/bin/python -m pip install build
.bootstrap/readme-venv/bin/python -m build python
.bootstrap/readme-venv/bin/python -m pip install python/dist/openclaw_memory_bridge-0.1.0-py3-none-any.whl
.bootstrap/readme-venv/bin/python examples/readme_quickstart.py \
  --foundation "$PWD" --root "$PWD/.lab-test-readme-example"
```

The package is not on PyPI. Install the local wheel. Installing or importing it creates no memory Markdown files. The executable example writes one synthetic note on purpose.

Here is the complete Python flow used by **SDK-01**:

```python
from pathlib import Path
from openclaw_memory_bridge import BridgeConfig, MemoryClient, MemoryScope

foundation = Path.cwd()  # This repository, with its runtime installed.
data_root = foundation / ".lab-test-readme-example"
scope = MemoryScope("observatory", "alex", "first")

with MemoryClient(BridgeConfig(foundation, data_root)) as memory:
    memory.write(scope, "filters", "Synthetic Vega uses cobalt filters on Tuesday.")
    memory.index(scope)
    hits = memory.search(scope, "cobalt")["results"]
    context = "\n".join(hit["snippet"] for hit in hits)
    agent_prompt = f"Use these recalled sources:\n{context}\nWhich filter does Vega use?"
    print(agent_prompt)
    # Your app sends agent_prompt to its own model.
```

**Observable result:** the note exists as `memory/filters.md`. Native keyword search returns that source. The built prompt contains `cobalt` and the source reference. The test does not call a model or measure answer quality. It does not claim that an agent replied.

`examples/readme_quickstart.py` is the executable example. **SDK-01** calls its prompt-building function with the real installed SDK. The inline code shows the same API flow.

## Direct SDK features and real cases

The fragments below assume an open client named `memory` and a matching `scope`. Put them inside the quickstart `with` block. Each scenario starts from its stated input; the fragments are not one combined script.

All SDK cases use synthetic data, the installed wheel, and the actual no-key engine. Each case closes its client and removes its temporary root. Example result descriptions state checked facts, not invented scores or model answers.

### Save, index, and recall — SDK-01

**Benefit:** an agent can use a fact after the app has stored it.

Input: `Synthetic Vega uses cobalt filters on Tuesday.` The bridge writes `memory/filters.md`. `index` asks OpenClaw to rebuild the native index. `search("cobalt")` recalls the source. The app inserts the returned snippet into its prompt.

Use `write(scope, note_id, text)`, `index(scope)`, and `search(scope, query)`. Reindex after a note change. The no-key path is keyword search. It does not promise synonym recall.

### Inspect the recalled source — SDK-02

**Benefit:** your app can show why an agent recalled a fact.

A search hit has `path`, `startLine`, `endLine`, and `snippet`. Read the source with the native `memory_get` tool through the SDK:

```python
hit = memory.search(scope, "cobalt")["results"][0]
source = memory.get(scope, hit["path"], start=hit["startLine"],
                    lines=min(200, hit["endLine"] - hit["startLine"] + 1))
```

The test checks the physical note, the cited range, and the returned `cobalt` text. It also rejects invalid ranges and paths outside the supported memory paths. The app must keep source references with its answers if it needs citations.

### Update a note — SDK-03

**Benefit:** your agent can recall the app's revised fact.

```python
memory.write(scope, "filters", "Synthetic Vega uses amber filters on Friday.")
memory.index(scope)
new_hits = memory.search(scope, "amber")["results"]
old_hits = memory.search(scope, "cobalt")["results"]
```

The same source file now contains `amber`. The test finds the new fact and no longer finds `cobalt`. This is an application Markdown update followed by native reindexing. It is not native lineage-based supersession of a consolidated memory.

### Delete a note — SDK-04

**Benefit:** your app can remove a source from current recall.

```python
memory.delete(scope, "filters")
memory.index(scope)
hits = memory.search(scope, "cobalt")["results"]
```

The test checks that the file is gone and recall is empty. A second delete reports an error. This operation does not erase other copies, backups, or captured transcripts. Your app must decide which sources it owns.

### Recall across sessions and restarts — SDK-05

**Benefit:** an agent can reuse stored facts in a later conversation.

```python
later = MemoryScope("observatory", "alex", "later")
memory.restart(scope)
hits = memory.search(later, "cobalt")["results"]
```

The test replaces the real Gateway, then closes and reconnects the Python client. The same root and scope still recall the note. Its file bytes stay unchanged. A session selects a native session key; it does not create a separate memory corpus. The app must keep the data root and scope IDs stable.

### Route users and workspaces — SDK-06

**Benefit:** your app can keep separate test corpora.

```python
other_user = MemoryScope("observatory", "sam", "first")
other_workspace = MemoryScope("separate", "alex", "first")
```

The SDK derives a stable native workspace route from the workspace/user pair. Different pairs use different routes. The test first checks empty recall and absent source files in the other corpora. It then writes a saffron fact under the same note ID. Each corpus recalls its own fact and not the other fact. The original corpus still recalls cobalt.

This is routing, not authentication or enterprise isolation. Your app must authenticate users and control who can choose their IDs. IDs use 1–48 lowercase letters, digits, or hyphens, with a letter first. A different session for the same pair uses the same corpus.

### Inspect a session and capture it on reset — SDK-07

**Benefit:** a developer can inspect native session state and test the capture hook.

```python
memory.configure(scope, ingestion=True)
memory.inject_fixture(scope, "Synthetic fixture: Vega records charts on copper paper.")
history = memory.session_history(scope)
state = memory.session_state(scope)
capture = memory.reset_session(scope)
```

`inject_fixture` creates a labelled synthetic transcript fixture. Its result says `modelExecuted: False`. It is not a genuine model reply or automatic extraction.

The native session-memory hook creates a dated Markdown capture on reset. The test checks its original session ID, session key, file content, and subsequent `copper` recall. Reset without ingestion enabled reports an error. Reset does not promise a new logical session UUID. Your app must use this fixture method only for deliberate test input.

### Inspect status and the diary — SDK-08

**Benefit:** your app can inspect native memory and dreaming state.

```python
memory_status = memory.status(scope)
dream_status = memory.dream_status(scope)
diary_text = memory.dream_diary(scope).get("content", "")
```

The no-key test sees dreaming disabled and an empty diary. These methods do not create model diary text. An operator must first generate a diary in that native workspace. A nonempty diary alone does not prove model generation; native fallback text is possible.

### Handle errors — SDK-09 and EDGE-01

**Benefit:** your app can distinguish an error from successful empty recall.

```python
from openclaw_memory_bridge import FoundationError

try:
    hits = memory.search(scope, "cobalt")["results"]
except FoundationError as error:
    print(error.code)
```

**SDK-09** uses the actual bridge to reject invalid operations, IDs, and empty queries. It checks that the valid note and recall remain intact. **EDGE-01** uses labelled protocol fixtures to check timeouts, malformed replies, and request correlation. A timeout leaves completion uncertain. Close that client before deciding whether to retry. A happy-path acceptance does not replace these edge tests.

## Native capabilities that are not SDK triggers

The following examples come from real native acceptance records unless marked otherwise. The new `MODEL-*` tests audit those records. They do not make fresh model requests and are not direct SDK generation cases. Missing records cause a skip. A skip is not a pass.

| Case | Concrete input → native action → checked result | Access and requirement |
|---|---|---|
| MODEL-01: semantic recall | `Zephyr travels to the office by bicycle.` → native embedding index → `pedal-powered commuting` recalled `memory/resident.md`; source read confirmed `bicycle` | Bridge embedding configuration, then native search. Recorded `text-embedding-3-small` acceptance. No SDK embedding selector. Fresh model run: not tested in this draft. |
| MODEL-02: extraction | A genuine conversation states the indigo/Thursday preference for synthetic Borealis → the native model later writes a daily note → the source contains that preference | Native agent lifecycle. The app did not prewrite this note. No SDK extraction method. |
| MODEL-03: flush | The conversation crosses the configured test trigger → native flush reports `kind: succeeded` → the physical daily note and recall confirm the fact | Native model plus flush configuration and continued agent execution. Enabling config alone is not success. No SDK flush trigger. |
| MODEL-04: compaction | The native conversation is summarized → native compaction commits → stored `compactionCount` becomes 1 | Native model operation. Compaction does not force flush. The SDK can inspect session state but cannot compact your external agent history. |
| MODEL-05: duplicate merge | A prior durable Vega fact and a model-written daily duplicate share project scope → native validated consolidation → Added 0, Merged 1, Superseded 0; one sourced durable fact remains | Official local operator agent path and native dreaming. Four unrelated facts and source-session identity remain. No SDK consolidation trigger. |
| MODEL-06: model Dream Diary | Native memory fragments enter dreaming → light, REM, and deep model publishers finish → diary text is written without fallback | Native model workflow. The bounded transport supplies missing output-token limits. SDK exposes diary inspection only. |
| MODEL-07: changed-fact supersession | A new fact would replace an old consolidated fact → matching native lineage is required → no accepted result exists | **Not verified.** Do not substitute SDK note overwrite for this capability. |

The recorded text-model tests used GPT-6 Sol. The merge baseline was an explicit synthetic application fixture. Its new daily duplicate was genuinely written by the native model. The test preserved the native source session. It did not import or relabel trust metadata.

The fixed operator tests use a cumulative 5 USD test ceiling and finite request ledgers. The utility transport adapter adds a token ceiling; it does not implement consolidation or change model prompts. Do not turn these tests into unrestricted paid execution. No fresh paid test is part of this draft.

### Deterministic native maintenance — NATIVE-02

A daily synthetic cobalt note → native REM staging and dreaming → a sourced durable promotion → recall after restart. The existing real-engine test checks phase signals, source references, and persistence. This no-model maintenance case does not prove model consolidation or a model diary.

## Configuration and process ownership

**NATIVE-03** checks provider configuration with the actual pinned native schema and dummy credentials. Configuration sends zero embedding requests in that test. It does not prove provider authentication or authorize model use.

`BridgeConfig(foundation, root, timeout=180)` points to the foundation runtime and your data root. The bridge creates its private workspace/config/state under that root when the scope is used. `configure(scope, ingestion=False)` only controls the capture hook. It does not select embeddings or a text model.

No key is required for keyword cases. Optional approved provider keys belong in the foundation's ignored `.env`, not in Python source or browser code. The bridge uses its existing project loader and selected native SecretRefs. The Python client does not forward arbitrary provider credentials from the app environment. Provider/model setup is a separate operator action.

CLI configuration uses the foundation's `.lab` root. For CLI/SDK interoperation, use that same root and the SDK's `scope.routing_workspace` as the CLI workspace ID. Close the client before operator configuration. Native configuration commands include:

```text
./node_modules/node/bin/node src/cli.ts native-model WS PROVIDER/MODEL KEY_ENV
./node_modules/node/bin/node src/cli.ts native-vector WS URL MODEL KEY_ENV
./node_modules/node/bin/node src/cli.ts validate-config WS
```

These are command shapes, not measured outputs or a paid-execution recipe. General credential-backed execution remains guarded. Local embeddings are optional and require an installed, running compatible server. The same `search(scope, query)` method uses native results after that separate configuration and indexing. Fresh SDK semantic integration is not tested in this draft.

**Cold start:** `MemoryClient` starts its owned JSONL bridge. The first native tool request starts a private Gateway. Repeated requests can reuse it. Indexing, status checks, restarts, or workspace changes can stop or replace that process. Closing the client closes its owned processes.

**Ready Gateway — NATIVE-01:** the separate TypeScript `ReadyGateway` client borrows an already-running Gateway. It can search and get sources without owning server lifetime. Its real-engine case checks warm recall, source reads, connection loss, and that client close leaves the owner's Gateway alive. Python `MemoryClient` has no ready-Gateway constructor option. Keep the operator token server-side.

## Run the scenario cases

After installing the wheel, run the direct SDK cases:

```sh
FOUNDATION_ROOT="$PWD" .bootstrap/readme-venv/bin/python -I -m unittest discover \
  -s python/tests -p test_readme_cases.py -v
```

Audit available historical genuine-model records:

```sh
FOUNDATION_ROOT="$PWD" .bootstrap/readme-venv/bin/python -I -m unittest discover \
  -s python/tests -p test_readme_model_evidence.py -v
```

The second command is an evidence audit, not a fresh model run. The coverage matrix gives each case's setup, assertions, cleanup, prerequisites, and existing-test mapping. Existing transport, secret, path, budget, and timeout tests remain. No test is removed by this proposal.

## Limits you should keep in your app design

Store facts deliberately. Index after source changes. Supply recalled context to your model. Keep stable scope IDs and a persistent data root. Use native agent execution if you need native extraction/flush/compaction; external app chats do not enter that lifecycle automatically.

No MD creation, background schedule, or consolidation is guaranteed after `pip install` or every conversation. Model generation plus SDK inspection in the same paid scope is not newly verified here. Changed-fact supersession remains unverified. Scope routing is not a security boundary.

## Exact installed public API

These signatures were inspected from the installed wheel. `scope` is a MemoryScope. `start` and `lines` in `get`, and `ingestion` in `configure`, are keyword-only. The lower-level `call` uses a native workspace route, not a MemoryScope. Most apps should use the named methods.

```text
BridgeConfig(foundation: 'Path | str', root: 'Path | str', timeout: 'float' = 180) -> None
MemoryScope(workspace: 'str', user: 'str', session: 'str') -> None
MemoryClient(config: 'BridgeConfig')
MemoryClient.configure(self, scope: 'MemoryScope', *, ingestion: 'bool' = False)
MemoryClient.write(self, scope: 'MemoryScope', note_id: 'str', text: 'str')
MemoryClient.delete(self, scope: 'MemoryScope', note_id: 'str')
MemoryClient.index(self, scope: 'MemoryScope')
MemoryClient.search(self, scope: 'MemoryScope', query: 'str')
MemoryClient.get(self, scope: 'MemoryScope', path: 'str', *, start: 'int' = 1, lines: 'int' = 40)
MemoryClient.restart(self, scope: 'MemoryScope')
MemoryClient.status(self, scope: 'MemoryScope')
MemoryClient.session_history(self, scope: 'MemoryScope')
MemoryClient.session_state(self, scope: 'MemoryScope')
MemoryClient.inject_fixture(self, scope: 'MemoryScope', text: 'str')
MemoryClient.reset_session(self, scope: 'MemoryScope')
MemoryClient.dream_status(self, scope: 'MemoryScope')
MemoryClient.dream_diary(self, scope: 'MemoryScope')
MemoryClient.call(self, op: 'str', workspace: 'str' = 'alpha', **args: 'Any') -> 'Any'
MemoryClient.close(self) -> 'None'
```

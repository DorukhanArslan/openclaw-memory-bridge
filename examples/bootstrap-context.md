# Native Bootstrap Template Context Check

This optional diagnostic verifies creation of real workspace templates and loading of their actual content into a native prepared system prompt. It uses the pinned OpenClaw 2026.9.9 runtime and Node 24.16.0, with no provider credentials, Gateway, model completion, or external service.

After installing the repository dependencies, run from the repository root:

```sh
bootstrap_case=$(mktemp -d /tmp/openclaw-bootstrap-check.XXXXXX)
node_modules/node/bin/node examples/bootstrap_context.mjs --output-dir "$bootstrap_case/result"
```

The output directory must not already exist. Each run uses private synthetic home, state, configuration, and workspace directories. Keep these generated workspaces outside the checkout: native setup may initialize Git inside them. This does not create a worktree for the project.

The diagnostic calls the public `openclaw setup --baseline --workspace ... --json` path. Explicit `--baseline` matters because ordinary setup can select a system-agent request. It verifies that the generated `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, and `BOOTSTRAP.md` match the actual bundled template bodies after native frontmatter handling.

It then uses pinned native diagnostic internals to resolve bootstrap files without hooks, apply the native character budgets and bootstrap routing, apply the final BOOTSTRAP inclusion filter, and render the native configured system prompt. The prepared prompt represents a primary manual run in the canonical workspace with native read access. A file only counts as loaded when it is nonmissing, has actual injected content, and the corresponding rendered content appears in that prompt. Merely finding the filename or a missing-file placeholder is insufficient.

`receipt.json` records verified source contracts, per-file hashes, missing/truncated flags, raw and injected character counts, and content-in-prompt assertions. Character statistics describe native bounded context before final prompt normalization; separate rendered-content hashes and presence checks cover the actual prompt form. Full prompt text, profile text, and environment values are not exported. Budget-limited results describe the actual bounded excerpts, rather than implying that the full original template was included.

Controls cover a fresh `--skip-bootstrap` workspace, a deliberately smaller context budget, and preservation of existing files across repeated baseline setup. In the skipped case, missing-file placeholders are distinguished from real template content, and BOOTSTRAP is excluded from the final prompt by native routing. Budgeting must leave source files unchanged.

These results establish **official template creation and native prepared-context injection**. They do not establish a real model reply, assistant compliance with the instructions, or completion of the first-run bootstrap conversation. The script checks pinned private native contracts only for this diagnostic; it adds no production SDK bootstrap API or native-internal dependency to the bridge.

The normal lab retains `skipBootstrap: true`. Historical Maya reports still correctly record missing BOOTSTRAP content and are not rewritten as successful template-loading runs.

Focused regression:

```sh
node_modules/node/bin/node --import ./src/load-env.ts --test tests/bootstrap-context.test.ts
```

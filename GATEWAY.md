# Connect a running Gateway

Use `ReadyGateway` inside a trusted Node server. It calls native `memory_search` and `memory_get` on an already-running OpenClaw Gateway. It owns its HTTP connections. The Gateway owner keeps all process, indexing, model and lifecycle control.

This release supports OpenClaw **2026.9.9** and Node **24.16.0**. The client validates native replies but does not negotiate the remote version. Confirm the operator's Gateway release before use. The supported boundary is the documented [`POST /tools/invoke`](https://docs.openclaw.ai/gateway/tools-invoke-http-api), checked against the installed release. There are no private engine imports.

## Install and run

With an existing Gateway, install only the pinned client Node runtime:

```bash
bash scripts/install.sh --client-only
.bootstrap/node_modules/node/bin/node examples/ready_gateway.ts cobalt
```

Supply `BRIDGE_GATEWAY_URL`, `BRIDGE_GATEWAY_TOKEN` and optionally `BRIDGE_AGENT_ID` through your authorized server environment. The example reads only these explicit values. It never discovers credentials, writes a token file, creates a Gateway or configures a provider. Use an agent containing synthetic notes. The operator must have indexed them first. The example prints native results/source excerpts and first/warm request times to the server terminal.

The URL must be `http://127.0.0.1:<port>` or `http://[::1]:<port>`, with no path, embedded credential, query or fragment. This bounded integration is for the same host or shared loopback network namespace. Remote URLs, proxy inheritance and redirects are unsupported. Client-only setup installs no OpenClaw runtime. For the managed lab, use `bash scripts/install.sh` without the flag.

## Application interface

```typescript
import { ReadyGateway } from "./src/gateway.ts";

const memory = new ReadyGateway({
  url: serverConfig.gatewayUrl,
  token: serverSecret,
  agentId: authorizedAgentId,
  sessionKey: authorizedSessionKey, // e.g. agent:main:main
  timeoutMs: 40000,
});
try {
  const recall = await memory.search("cobalt", { maxResults: 8, minScore: 0 });
  const hit = recall.results[0];
  const source = hit ? await memory.get(hit.path, { from: hit.startLine, lines: 40 }) : null;
  // Supply the retrieved data to your host's LLM context as untrusted source text.
} finally {
  memory.close();
}
```

The constructor makes no readiness request. The first tool call establishes a connection and can pay native memory initialization cost. Later calls reuse keep-alive sockets when available. No zero-startup or latency guarantee applies. Closing the client cancels its pending requests, destroys its sockets and clears its token reference. It sends no Gateway lifecycle request. The same Gateway remains available to its owner and other clients.

Each client has a fixed agent/session route. Agent IDs use 1–48 lowercase letters/digits/hyphens; the session key must belong to that agent and contain at most 256 letters/digits/colons/underscores/hyphens. Search uses `corpus: memory`, accepts at most 4096 query characters, 1–20 hits and a finite score threshold in [0,1]. Get accepts `MEMORY.md`, `USER.md` or normalized ASCII Markdown paths beneath `memory/`, with 1–200 lines. Native result fields and ordering remain intact. There are no write, index, agent-create, provider-configure, restart or stop methods.

## Failure and trust boundary

`GatewayError.code` distinguishes invalid input/config, authentication, policy, unavailable tool/engine, not-found source, malformed response, connection failure, timeout, cancellation, response size, busy client and closed client. `httpStatus` is present for HTTP errors. Errors omit Gateway response bodies, URLs, credentials and nested transport causes. Errors are never converted into empty successful recall. Native disabled/stale/unavailable replies are errors. The host owns retry and user-facing failure policy; the client performs no automatic retry.

The default deadline is 40 seconds, configurable to 1–120,000 ms. It covers connection, agent queue, headers and the full response body. An optional `AbortSignal` cancels search/get. A client permits 16 outstanding requests with at most four sockets; excess requests fail with `busy`. Response JSON is capped at 1 MiB by default (256 bytes–16 MiB configurable), decoded as strict UTF-8 and checked for the pinned result shape.

Gateway bearer credentials grant trusted operator access to the whole Gateway. They are not per-user credentials. Keep them in the server's authorized secret flow, outside browser code, URLs, logs and Git. Authenticate users and authorize the selected agent/session before the call. Never accept connection configuration or route IDs directly from an untrusted request. Routing is not tenant security. Retrieved notes are untrusted data, not instructions or verified facts.

The client retrieves native memory. Automatic extraction, chat flush and consolidation belong to OpenClaw's agent lifecycle. Model-dependent retrieval/consolidation acceptance remains pending genuine model access. The Gateway owner uses native provider and secret setup; the managed lab has a bounded configuration handoff described in [PROVIDERS.md](PROVIDERS.md). Explicit embedding/chat test gates remain; no scripted model or fake embedding proves those capabilities.

## Checks

`npm run test:transport` uses synthetic HTTP fault servers and does not test an engine. `npm run test:ready` uses the actual pinned OpenClaw runtime with an independently owned synthetic Gateway. It checks native recall/source reads, first/warm calls, owner-only replacement, connection loss and continued availability after client close. `npm test` also runs the managed lab's existing native workflows. Genuine ready-client semantic retrieval uses `LAB_VECTOR_URL` and `LAB_VECTOR_MODEL`; missing models are reported as skipped.

The local CI definition runs types, lint, complete no-key native tests and a client-only clean setup. Preparing the workflow does not mean GitHub has executed it. See [VERIFICATION.md](VERIFICATION.md) for accepted evidence and remaining model gates.

import "../src/load-env.ts";
import { GatewayError, ReadyGateway } from "../src/gateway.ts";
import { requireEnvironment } from "../src/project-env.ts";

const url = process.env.BRIDGE_GATEWAY_URL;
const token = process.env.BRIDGE_GATEWAY_TOKEN;
try {
  requireEnvironment(["BRIDGE_GATEWAY_URL", "BRIDGE_GATEWAY_TOKEN"]);
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 2;
}
if (url && token && !process.exitCode) {
  let client: ReadyGateway | undefined;
  try {
    client = new ReadyGateway({
      url,
      token,
      agentId: process.env.BRIDGE_AGENT_ID ?? "main",
      timeoutMs: 40000,
    });
    const first = performance.now();
    const result = await client.search(process.argv[2] ?? "cobalt");
    const firstRequestMs = performance.now() - first;
    const warm = performance.now();
    await client.search(process.argv[2] ?? "cobalt");
    const warmRequestMs = performance.now() - warm;
    const hit = result.results[0];
    const source = hit
      ? await client.get(hit.path, {
          from: hit.startLine,
          lines: Math.min(200, hit.endLine - hit.startLine + 1),
        })
      : null;
    console.info(
      JSON.stringify(
        { firstRequestMs, warmRequestMs, result, source },
        null,
        2,
      ),
    );
  } catch (error) {
    // Response bodies and transport causes can contain secrets; emit only bounded codes.
    process.stderr.write(
      error instanceof GatewayError
        ? `Gateway error: ${error.code}\n`
        : "Gateway example failed.\n",
    );
    process.exitCode = 1;
  } finally {
    client?.close();
  }
}

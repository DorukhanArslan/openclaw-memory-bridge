// Test-only observer. Never records auth headers, tokens or provider traffic.
import { appendFileSync } from "node:fs";

const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const result = await original(input, init);
  if (
    process.env.PARITY_CAPTURE &&
    String(input).startsWith("http://127.0.0.1:") &&
    String(input).endsWith("/tools/invoke")
  ) {
    appendFileSync(
      process.env.PARITY_CAPTURE,
      `${JSON.stringify({ request: JSON.parse(String(init?.body)), response: await result.clone().json(), status: result.status })}\n`,
    );
  }
  return result;
};

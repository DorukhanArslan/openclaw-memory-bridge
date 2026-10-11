import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectBudget, PAID_SELECTION } from "./budget-preflight.ts";

/** Fixed approved smoke policy, separate from the native quota snapshot. */
export type SmokeConfirmations = {
  keyLimit: boolean;
  prices: string;
  providerLimitUsd?: 5 | 50;
};
export const SMOKE = Object.freeze({
  prompt: 'Return {"ok":true} for this synthetic connectivity test.',
  note: "# Synthetic resident\nZephyr travels to the office by bicycle.\n",
  query: "pedal-powered commuting",
  path: "memory/resident.md",
  maxInputTokens: 1024,
  maxOutputTokens: 128,
  timeoutMs: 15000,
  prices: "8,30,10,0.02",
  testCeilingUsd: 5,
  estimatedUsd: (1024 * (8 + 10) + 128 * 30 + (5 * 512 + 3 * 64) * 0.02) / 1e6,
});
export function confirmSmoke(value: SmokeConfirmations) {
  if (!value.keyLimit)
    throw new Error(
      "The selected provider limit must match the approved smoke policy.",
    );
  if (value.prices !== SMOKE.prices)
    throw new Error(
      "Current price confirmation is missing or differs from this smoke policy.",
    );
  if (
    value.providerLimitUsd !== undefined &&
    ![5, 50].includes(value.providerLimitUsd)
  )
    throw new Error(
      "Confirm the exact 5 or 50 USD provider limit separately from the 5 USD test budget.",
    );
  if (SMOKE.estimatedUsd >= SMOKE.testCeilingUsd)
    throw new Error("Finite smoke estimate exceeds the approved test budget.");
}

export function smokeBudget(
  status: unknown,
  confirmations: SmokeConfirmations,
) {
  confirmSmoke(confirmations);
  const budget = inspectBudget(
    status,
    Date.now(),
    confirmations.providerLimitUsd ?? 5,
  );
  if (!budget.snapshotEligible || !budget.keyBudget)
    throw new Error(`Bounded smoke denied: ${budget.code}`);
  return budget.keyBudget;
}

/** Fixed ASCII content plus 128 tokens of conservative chat framing allowance. */
export function inputTokenUpperBound(messages: Array<{ content: string }>) {
  if (messages.some((m) => [...m.content].some((c) => c.charCodeAt(0) > 127)))
    throw new Error("This smoke accepts only fixed ASCII input.");
  return messages.reduce((sum, m) => sum + Buffer.byteLength(m.content), 128);
}

// Reading contracts is not importing private engine functions. Unknown builds fail closed.
const CONTRACTS = {
  "openclaw/dist/llm-task-tool-DkNVXG0W.mjs":
    "1c66f23ae43a1b50d1becd82b033be8af67c4e9e568eb41c6f1cdb5531875f35",
  "openclaw/dist/host-prepared-isolated-completion-QyyI1Ftw.mjs":
    "d843c460122824c685fd2c65b432f3e1ba560dc74d2227fcc58b04647c535e2b",
  "openclaw/dist/simple-completion-execution-CxTo960c.mjs":
    "8f0c4ab5e378fab8091d3c1d066087862dea94f1655e3c8c2592f1815fd739d2",
  "openclaw/dist/extensions/memory-core/manager-runtime.js":
    "6ae8f02e229a5422d88dde59a6c070cce03e1ac9ffe5fa87172db8512f0eea0e",
  "@openclaw/ai/dist/openai-completions-CVwOQW-U.mjs":
    "5cb1fe0be0cbeb10d13fa06870d492184401ee02a22340c539c9c8bb86750c3c",
  "@openclaw/ai/dist/openai-completions-stream-Crkc597h.mjs":
    "ed8e78573229052a51780af542614d24d96c611fad7f9d5c96e4c5db124af1c9",
};
export async function verifySmokeRuntime() {
  const modules = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../node_modules",
  );
  for (const [path, expected] of Object.entries(CONTRACTS)) {
    const actual = createHash("sha256")
      .update(await readFile(resolve(modules, path)))
      .digest("hex");
    if (actual !== expected)
      throw new Error(
        "Pinned native smoke contract differs; reverify before paid execution.",
      );
  }
  const system =
    "You are a JSON-only function. Return ONLY a valid JSON value. Do not wrap in markdown fences. Do not include commentary. Do not call tools.";
  const input = `TASK:\n${SMOKE.prompt}\n\nINPUT_JSON:\nnull\n`;
  const bound = inputTokenUpperBound([{ content: system }, { content: input }]);
  if (bound > SMOKE.maxInputTokens)
    throw new Error("Native completion input bound is unknown or too large.");
  return { inputUpperBound: bound, selection: PAID_SELECTION };
}

/** Test transport only: no real credential or off-loopback destination is accepted. */
export type SmokeFixture = { url: string; status?: unknown };
export function fixtureEndpoint(fixture: SmokeFixture) {
  const url = new URL(fixture.url);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Smoke fixtures must use an uncredentialed IPv4 loopback endpoint.",
    );
  if (process.env.SYNTHETIC_SMOKE_KEY !== "synthetic-smoke-placeholder")
    throw new Error("Smoke fixtures require the exact dummy credential.");
  return url.href;
}

// Credential-free deterministic process interleaving; never dispatches HTTP.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";

const [mode, moduleUrl, path, denialKind = "model"] = process.argv.slice(2);
if (!mode || !moduleUrl || !path) throw new Error("Fixture arguments required");
const request = {
  method: "POST",
  body: JSON.stringify({
    model: "openai/gpt-6-sol",
    max_completion_tokens: 512,
  }),
};
if (mode === "deny-after-admission") {
  const original = fs.readFileSync;
  const inode = fs.statSync(path).ino;
  let raced = false;
  fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
    const snapshot = original(...args);
    if (
      !raced &&
      typeof args[0] === "number" &&
      fs.fstatSync(args[0]).ino === inode
    ) {
      raced = true;
      // Pause denial after its first snapshot. A separate process records a real
      // local admission before denial resumes. Scheduling is deterministic.
      const admitted = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url), "admit", moduleUrl, path],
        { encoding: "utf8", env: {} },
      );
      if (admitted.status !== 0)
        throw new Error(`Sibling admission failed: ${admitted.stderr}`);
    }
    return snapshot;
  }) as typeof fs.readFileSync;
  syncBuiltinESMExports();
}
const { admitLifecycleRequest } = await import(moduleUrl);
const endpoint = "https://openrouter.ai/api/v1/chat/completions";
if (mode === "admit") {
  admitLifecycleRequest(path, endpoint, request);
} else {
  const denied =
    denialKind === "input"
      ? {
          ...request,
          body: JSON.stringify({
            model: "openai/gpt-6-sol",
            max_completion_tokens: 512,
            messages: [{ role: "user", content: "x".repeat(100000) }],
          }),
        }
      : {
          ...request,
          body: JSON.stringify({
            model: "wrong-model",
            max_completion_tokens: 512,
          }),
        };
  try {
    admitLifecycleRequest(path, endpoint, denied);
    throw new Error("Denied shape unexpectedly admitted");
  } catch (error) {
    if (!/bound denied|per-request input budget/.test(String(error)))
      throw error;
  }
  console.log(fs.readFileSync(path, "utf8"));
}

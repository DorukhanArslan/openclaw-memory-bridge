import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { credentialEnv } from "./provider-handoff.ts";

export const PROJECT_ENV = fileURLToPath(new URL("../.env", import.meta.url));
const SETTINGS = new Set([
  "BRIDGE_GATEWAY_URL",
  "BRIDGE_GATEWAY_TOKEN",
  "BRIDGE_AGENT_ID",
  "LAB_MODEL_URL",
  "LAB_MODEL_NAME",
  "LAB_VECTOR_URL",
  "LAB_VECTOR_MODEL",
  "LAB_NATIVE_MODEL_REF",
  "LAB_NATIVE_KEY_ENV",
  "LAB_NATIVE_VECTOR_URL",
  "LAB_NATIVE_VECTOR_MODEL",
  "LAB_NATIVE_VECTOR_KEY_ENV",
  "LAB_ALLOW_MODEL_REQUESTS",
]);

function allowed(name: string) {
  if (SETTINGS.has(name)) return true;
  if (!/_(?:API_KEY|KEY|TOKEN|SECRET)$/.test(name)) return false;
  try {
    credentialEnv(name);
    return true;
  } catch {
    return false;
  }
}

/** Application adapter only. The default path is independent of process.cwd(). */
export function loadProjectEnv(
  env: NodeJS.ProcessEnv = process.env,
  file: string = PROJECT_ENV,
): void {
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error(
      "Project .env could not be loaded safely. Check the local file.",
    );
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 65536) throw new Error();
    const text = readFileSync(fd, "utf8");
    if (text.includes("\0")) throw new Error();
    // Node's dotenv parser treats expansions and command substitutions as text.
    const parsed = parseEnv(text);
    for (const [name, value] of Object.entries(parsed))
      if (
        !allowed(name) ||
        typeof value !== "string" ||
        value.length > 4096 ||
        /[\r\n\0]/.test(value)
      )
        throw new Error();
    // Validate the entire file before mutating any environment setting.
    for (const [name, value] of Object.entries(parsed))
      if (!Object.hasOwn(env, name)) env[name] = value;
  } catch {
    // Never expose parser input, values, file-system errors or secret-bearing lines.
    throw new Error(
      "Project .env could not be loaded safely. Check the local file.",
    );
  } finally {
    closeSync(fd);
  }
}

export class MissingEnvironmentError extends Error {
  constructor(names: string[]) {
    super(
      `Missing required environment settings: ${names.join(", ")}. Edit the project's .env locally using .env.example; never paste secrets into a command or chat.`,
    );
  }
}

/** Presence only. Existing values, including empty ones, are never replaced. */
export function requireEnvironment(
  names: string[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (names.some((name) => !allowed(name)))
    throw new Error("Unsupported required environment setting.");
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length) throw new MissingEnvironmentError(missing);
}

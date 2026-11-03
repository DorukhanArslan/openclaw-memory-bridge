import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isIP } from "node:net";

type ErrorRecord = Record<string, unknown>;

function record(value: unknown): value is ErrorRecord {
  return typeof value === "object" && value !== null;
}

/** Keep useful transport metadata, not nested messages, stacks or request data. */
export function describeGatewayFailure(error: unknown): string {
  const primary =
    error instanceof Error && error.message.trim()
      ? error.message.slice(0, 2000)
      : "Unknown Gateway startup error.";
  const causes: string[] = [];
  const seen = new Set<object>();
  function visit(value: unknown, depth: number): void {
    if (!record(value) || depth > 3 || seen.has(value) || seen.size >= 12)
      return;
    seen.add(value);
    const parts: string[] = [];
    if (
      typeof value.code === "string" &&
      /^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)
    )
      parts.push(value.code);
    if (
      typeof value.syscall === "string" &&
      /^[a-z][a-z0-9_]{0,31}$/.test(value.syscall)
    )
      parts.push(value.syscall);
    if (typeof value.address === "string" && isIP(value.address))
      parts.push(value.address);
    if (
      typeof value.port === "number" &&
      Number.isInteger(value.port) &&
      value.port > 0 &&
      value.port <= 65535
    )
      parts.push(`port ${value.port}`);
    if (parts.length) causes.push(parts.join(" "));
    visit(value.cause, depth + 1);
    if (Array.isArray(value.errors))
      for (const child of value.errors.slice(0, 8)) visit(child, depth + 1);
  }
  visit(error, 0);
  return causes.length ? `${primary} (${causes.join("; ")})` : primary;
}

/** Read only a regular file's bounded tail; never follow its final symlink. */
export async function readGatewayLogTail(
  path: string,
  maxBytes = 12000,
): Promise<string> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 65536)
    return "(native log unavailable: invalid tail limit)";
  if (typeof constants.O_NOFOLLOW !== "number")
    return "(native log unavailable: safe file reads are unsupported)";
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1)
      return "(native log unavailable: expected a regular file with one link)";
    if (info.size === 0) return "(native log is empty)";
    const offset = Math.max(0, info.size - maxBytes);
    const buffer = Buffer.alloc(Math.min(info.size, maxBytes));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (offset > 0) {
      // An incomplete first line may contain a cut credential. Drop it rather
      // than presenting a fragment that a full-value redactor cannot match.
      const newline = text.indexOf("\n");
      if (newline < 0)
        return "(native log tail contains only an incomplete line; omitted)";
      text = text.slice(newline + 1);
    }
    return text.trim()
      ? text
      : "(native log tail has no complete nonempty lines)";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "(native log file was not created)";
    if (code === "ELOOP")
      return "(native log unavailable: symbolic link refused)";
    return "(native log unavailable: file could not be read safely)";
  } finally {
    await file?.close().catch(() => {});
  }
}

export function formatGatewayStartupFailure(input: {
  error: unknown;
  elapsedMs: number;
  exitCode: number | null;
  signal: string | null;
  consoleLog: string;
  fileLog: string;
  nodeVersion: string;
  platform: string;
  redact: (text: string) => string;
}): string {
  const elapsed = Number.isFinite(input.elapsedMs)
    ? `${Math.max(0, Math.round(input.elapsedMs))} ms`
    : "unknown duration";
  const processState =
    input.exitCode !== null
      ? `exited with code ${input.exitCode}`
      : input.signal !== null
        ? `terminated by ${input.signal}`
        : "no exit or signal recorded";
  return input.redact(
    `${describeGatewayFailure(input.error)}\n` +
      `Gateway startup: ${elapsed}; Node ${input.nodeVersion}; ${input.platform}.\n` +
      `Native process: ${processState}.\n` +
      "Gateway diagnostics:\n" +
      `Console output:\n${input.consoleLog.trim() || "(no console output captured)"}\n` +
      `Native log:\n${input.fileLog.trim() || "(native log is empty)"}\n` +
      "(The native log tail may include entries from earlier starts.)",
  );
}

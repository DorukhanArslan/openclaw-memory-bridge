// Private application-level evidence, separate from strict protocol replay tapes.
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

type Options = {
  captureId: string;
  route: string;
  secrets?: string[];
  maxEventBytes?: number;
};
type Metadata = { operationId?: string; generation?: number };
export type TraceEvent = {
  v: 1;
  captureId: string;
  route: string;
  pid: number;
  sequence: number;
  wallTime: string;
  monotonicNs: string;
  generation: number;
  kind: string;
  operationId?: string;
  operationState?: "start" | "end";
  data: unknown;
};
const label = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(value);
const sensitive = (key: string) =>
  /^(authorization|proxyauthorization|apikey|accesstoken|refreshtoken|gatewaytoken|token|password|secret|secrets|clientsecret|credentials|cookie|setcookie)$/i.test(
    key.replace(/[-_ ]/g, ""),
  );
const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
function privateParent(path: string) {
  const parent = dirname(path),
    stat = lstatSync(parent);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    realpathSync(parent) !== parent ||
    stat.mode & 0o077
  )
    throw new Error(
      "Trace requires a private directory without symbolic links.",
    );
}

export class TraceJournal {
  readonly path: string;
  private fd: number;
  private readonly scope: Pick<Options, "captureId" | "route">;
  private readonly limit: number;
  private secrets: string[] = [];
  private sequence = 0;
  private operation = 0;
  private generation = 0;
  private bytes = 0;
  private readonly pending = new Set<string>();
  private readonly digest = createHash("sha256");
  private broken = false;
  private closed = false;
  private identity: { dev: number; ino: number };

  constructor(path: string, options: Options) {
    if (!label(options.captureId) || !label(options.route))
      throw new Error("Invalid trace scope.");
    this.limit = options.maxEventBytes ?? 8 * 1024 * 1024;
    if (
      !Number.isSafeInteger(this.limit) ||
      this.limit < 256 ||
      this.limit > 64 * 1024 * 1024
    )
      throw new Error("Invalid trace event byte limit.");
    this.path = resolve(path);
    this.scope = { captureId: options.captureId, route: options.route };
    privateParent(this.path);
    this.fd = openSync(
      this.path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    const stat = fstatSync(this.fd);
    this.identity = { dev: stat.dev, ino: stat.ino };
    try {
      for (const secret of options.secrets ?? []) this.addSecret(secret);
      this.append("trace.open", { maxEventBytes: this.limit });
      const directory = openSync(
        dirname(this.path),
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } catch {
      this.broken = true;
      if (!this.closed) closeSync(this.fd);
      this.closed = true;
      throw new Error("Trace creation failed; preserve the partial file.");
    }
  }

  get poisoned() {
    return this.broken;
  }
  addSecret(value: string) {
    if (this.closed || this.broken)
      return this.fail("journal is closed or poisoned");
    if (typeof value !== "string")
      return this.fail("invalid secret registration");
    if (value && !this.secrets.includes(value)) {
      this.secrets.push(value);
      this.secrets.sort((a, b) => b.length - a.length);
    }
  }
  private text(value: string): string {
    let result = value;
    for (const secret of this.secrets)
      result = result.split(secret).join("[REDACTED]");
    result = result.replace(/\bBearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]");
    result = result.replace(
      /("(?:authorization|proxy[-_]?authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|gateway[-_]?token|token|password|client[-_]?secret|secret|cookie)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
      '$1"[REDACTED]"',
    );
    return result.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, (text) => {
      try {
        const url = new URL(text);
        let changed = false;
        if (url.username) {
          url.username = "[REDACTED]";
          changed = true;
        }
        if (url.password) {
          url.password = "[REDACTED]";
          changed = true;
        }
        for (const key of url.searchParams.keys())
          if (sensitive(key) || /^(key|auth|sig|signature)$/i.test(key)) {
            url.searchParams.set(key, "[REDACTED]");
            changed = true;
          }
        return changed ? url.href : text;
      } catch {
        return text;
      }
    });
  }
  redact(value: unknown): unknown {
    const active = new Set<object>();
    const visit = (item: unknown, depth: number): unknown => {
      if (depth > 64) throw new Error("Trace value exceeds its nesting bound.");
      if (item === null || typeof item === "boolean") return item;
      if (typeof item === "string") return this.text(item);
      if (typeof item === "number" && Number.isFinite(item)) return item;
      if ((!Array.isArray(item) && !plain(item)) || active.has(item))
        throw new Error("Trace values must be acyclic JSON.");
      active.add(item);
      try {
        if (Array.isArray(item))
          return item.map((part) => visit(part, depth + 1));
        const output: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(item)) {
          const clean = this.text(key);
          if (Object.hasOwn(output, clean))
            throw new Error("Trace redaction creates ambiguous object keys.");
          Object.defineProperty(output, clean, {
            value: sensitive(key) ? "[REDACTED]" : visit(value, depth + 1),
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
        return output;
      } finally {
        active.delete(item);
      }
    };
    return visit(value, 0);
  }
  fail(reason: string): never {
    this.broken = true;
    if (!this.closed) {
      try {
        closeSync(this.fd);
      } catch {}
      this.closed = true;
    }
    throw new Error(
      `Trace capture failed: ${this.text(reason)}. Preserve its incomplete journal.`,
    );
  }
  private append(
    kind: string,
    data: unknown,
    metadata: Metadata & { operationState?: "start" | "end" } = {},
  ): TraceEvent {
    if (this.closed || this.broken)
      return this.fail("journal is closed or poisoned");
    try {
      if (
        !label(kind) ||
        (metadata.operationId !== undefined && !label(metadata.operationId)) ||
        (metadata.generation !== undefined &&
          metadata.generation !== this.generation)
      )
        throw new Error();
      if (
        [
          this.scope.captureId,
          this.scope.route,
          kind,
          metadata.operationId ?? "",
        ].some((value) => this.secrets.some((secret) => value.includes(secret)))
      )
        throw new Error();
      const stat = lstatSync(this.path);
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.dev !== this.identity.dev ||
        stat.ino !== this.identity.ino ||
        stat.size !== this.bytes ||
        stat.mode & 0o077
      )
        throw new Error();
      const event: TraceEvent = {
        v: 1,
        ...this.scope,
        pid: process.pid,
        sequence: this.sequence + 1,
        wallTime: new Date().toISOString(),
        monotonicNs: process.hrtime.bigint().toString(),
        generation: this.generation,
        kind,
        ...(metadata.operationId ? { operationId: metadata.operationId } : {}),
        ...(metadata.operationState
          ? { operationState: metadata.operationState }
          : {}),
        data: this.redact(data),
      };
      const bytes = Buffer.from(`${JSON.stringify(event)}\n`);
      if (bytes.length > this.limit) throw new Error();
      let offset = 0;
      while (offset < bytes.length) {
        const n = writeSync(this.fd, bytes, offset);
        if (!n) throw new Error();
        offset += n;
      }
      fsyncSync(this.fd);
      this.digest.update(bytes);
      this.bytes += bytes.length;
      this.sequence++;
      return event;
    } catch {
      return this.fail("record cannot be persisted completely");
    }
  }
  record(kind: string, data: unknown, metadata: Metadata = {}) {
    if (["trace.open", "trace.complete", "generation.start"].includes(kind))
      return this.fail("reserved event kind");
    return this.append(kind, data, metadata);
  }
  start(kind: string, data: unknown): string {
    const id = `op-${++this.operation}`;
    this.append(`${kind}.start`, data, {
      operationId: id,
      operationState: "start",
    });
    this.pending.add(id);
    return id;
  }
  end(operationId: string, kind: string, data: unknown) {
    if (!this.pending.has(operationId))
      return this.fail("unknown or already completed operation");
    const event = this.append(kind, data, {
      operationId,
      operationState: "end",
    });
    this.pending.delete(operationId);
    return event;
  }
  beginGeneration(label: string) {
    if (this.pending.size)
      return this.fail("cannot replace a generation with pending operations");
    this.generation++;
    this.append("generation.start", { label });
    return this.generation;
  }
  barrier(label: string) {
    return this.append("trace.barrier", { label, pending: this.pending.size });
  }
  finish() {
    if (this.pending.size) return this.fail("operations remain unfinished");
    this.append("trace.complete", { events: this.sequence + 1, pending: 0 });
    closeSync(this.fd);
    this.closed = true;
    return {
      path: this.path,
      sha256: this.digest.digest("hex"),
      events: this.sequence,
      complete: true as const,
    };
  }
}

/** Inspect a durable prefix without rewriting it or inventing missing events. */
export function readTrace(path: string) {
  const records: TraceEvent[] = [],
    errors: string[] = [],
    pending = new Set<string>(),
    used = new Set<string>();
  const target = resolve(path);
  let raw = Buffer.alloc(0),
    fd: number | undefined;
  try {
    privateParent(target);
    fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.mode & 0o077 ||
      stat.size > 256 * 1024 * 1024
    )
      throw new Error();
    raw = readFileSync(fd);
  } catch {
    errors.push("unreadable_or_unsafe_trace");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  let cursor = 0,
    lastTime = -1n,
    generation = 0,
    completed = false;
  while (cursor < raw.length && !errors.length) {
    const end = raw.indexOf(10, cursor);
    if (end < 0) {
      errors.push("truncated_tail");
      break;
    }
    try {
      const value: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          raw.subarray(cursor, end),
        ),
      );
      if (!plain(value)) throw new Error();
      const first = records[0],
        time =
          typeof value.monotonicNs === "string" &&
          /^\d+$/.test(value.monotonicNs)
            ? BigInt(value.monotonicNs)
            : -1n;
      if (
        completed ||
        value.v !== 1 ||
        !label(value.captureId) ||
        !label(value.route) ||
        !label(value.kind) ||
        !Number.isSafeInteger(value.pid) ||
        Number(value.pid) < 1 ||
        value.sequence !== records.length + 1 ||
        typeof value.wallTime !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.wallTime) ||
        !Number.isFinite(Date.parse(value.wallTime)) ||
        time < lastTime ||
        !Object.hasOwn(value, "data")
      )
        throw new Error();
      if (
        first
          ? value.captureId !== first.captureId ||
            value.route !== first.route ||
            value.pid !== first.pid ||
            value.kind === "trace.open"
          : value.kind !== "trace.open"
      )
        throw new Error();
      if (value.kind === "generation.start") generation++;
      if (value.generation !== generation) throw new Error();
      if (value.operationState === "start") {
        if (!label(value.operationId) || used.has(value.operationId))
          throw new Error();
        pending.add(value.operationId);
        used.add(value.operationId);
      } else if (value.operationState === "end") {
        if (!label(value.operationId) || !pending.delete(value.operationId))
          throw new Error();
      } else if (value.operationState !== undefined) throw new Error();
      if (value.kind === "trace.complete") {
        if (
          pending.size ||
          !plain(value.data) ||
          value.data.events !== value.sequence ||
          value.data.pending !== 0
        )
          throw new Error();
        completed = true;
      }
      records.push(value as unknown as TraceEvent);
      lastTime = time;
    } catch {
      errors.push("invalid_record_or_sequence");
    }
    cursor = end + 1;
  }
  if (!completed) errors.push("missing_completion");
  if (pending.size) errors.push("unfinished_operations");
  return {
    path: target,
    sha256: createHash("sha256").update(raw).digest("hex"),
    events: records.length,
    complete: completed && !errors.length,
    errors,
    pending: [...pending],
    records,
  };
}

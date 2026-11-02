"""Private application-level diagnostic journal, separate from replay tapes."""
from __future__ import annotations

from datetime import datetime, timezone
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time
from urllib.parse import unquote_plus, urlsplit, urlunsplit


class TraceError(RuntimeError):
    """Recording uncertainty invalidates a complete-capture claim."""


_PRIVATE = {"authorization", "proxyauthorization", "cookie", "setcookie", "gatewaytoken", "clientsecret", "secrets",
            "apikey", "apisecret", "password", "passwd", "secret", "token",
            "accesstoken", "refreshtoken", "credential", "credentials"}
_URL = re.compile(r"(?:https?|wss?)://[^\s<>\"']+", re.I)
_LABEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}")


def _nonfinite(_):
    raise TraceError("Nonfinite JSON value.")


def _sensitive(name):
    return re.sub(r"[^a-z0-9]", "", str(name).lower()) in _PRIVATE


def _safe_url(match):
    try:
        value = urlsplit(match.group())
        host = value.netloc.rsplit("@", 1)[-1]
        def query_safe(query):
            result = []
            for part in query.split("&"):
                key, sep, data = part.partition("=")
                name = unquote_plus(key)
                result.append(key + "=[REDACTED]" if _sensitive(name) or name.lower() in ("key", "auth", "sig", "signature") else part)
            return "&".join(result)
        query, fragment = query_safe(value.query), query_safe(value.fragment)
        if host == value.netloc and query == value.query and fragment == value.fragment:
            return match.group()
        return urlunsplit((value.scheme, host, value.path, query, fragment))
    except ValueError:
        return "[REDACTED URL]"


class TraceJournal:
    def __init__(self, path, *, capture_id, route, secrets=(), max_event_bytes=8 * 1024 * 1024):
        self.path = Path(path).absolute()
        if (not isinstance(capture_id, str) or not _LABEL.fullmatch(capture_id) or
                not isinstance(route, str) or not _LABEL.fullmatch(route) or
                type(max_event_bytes) is not int or not 256 <= max_event_bytes <= 64 * 1024 * 1024):
            raise TraceError("Invalid trace identity or event bound.")
        parent = self.path.parent
        if (parent.resolve(strict=True) != parent or not parent.is_dir() or
                parent.stat().st_mode & 0o077):
            raise TraceError("Trace directory must be private and canonical.")
        self.capture_id, self.route = capture_id, route
        self.max_event_bytes = max_event_bytes
        self._secrets = set()
        for secret in secrets:
            self.add_secret(secret)
        if any(secret in capture_id or secret in route for secret in self._secrets):
            raise TraceError("Trace scope cannot contain a registered secret.")
        self._sequence = self._operations = self._generation = 0
        self._bytes = 0
        self._pending = set()
        self._poisoned = self._closed = False
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        self._fd = os.open(self.path, flags, 0o600)
        opened = os.fstat(self._fd)
        self._identity = opened.st_dev, opened.st_ino
        try:
            parent_fd = os.open(parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)
            self.record("trace.open", {"maxEventBytes": max_event_bytes})
        except BaseException:
            os.close(self._fd)
            self._closed = True
            raise

    @property
    def poisoned(self):
        return self._poisoned

    def add_secret(self, value):
        if isinstance(value, str) and value:
            self._secrets.add(value)

    def redact(self, value):
        return self._redact(value, set(), 0)

    def _redact(self, value, active, depth):
        if depth > 64:
            raise TraceError("Trace value exceeds its nesting bound.")
        if isinstance(value, (dict, list, tuple)):
            if id(value) in active:
                raise TraceError("Trace values must be acyclic JSON.")
            active.add(id(value))
            try:
                if not isinstance(value, dict):
                    return [self._redact(v, active, depth + 1) for v in value]
                output = {}
                for key, item in value.items():
                    if not isinstance(key, str):
                        raise TraceError("Trace object keys must be strings.")
                    clean = self._redact(key, active, depth + 1)
                    if clean in output:
                        raise TraceError("Trace redaction creates ambiguous object keys.")
                    output[clean] = "[REDACTED]" if _sensitive(key) else self._redact(item, active, depth + 1)
                return output
            finally:
                active.remove(id(value))
        if isinstance(value, bytes):
            try:
                return self._redact(value.decode("utf-8"), active, depth + 1)
            except UnicodeDecodeError:
                for secret in sorted(self._secrets, key=len, reverse=True):
                    value = value.replace(secret.encode(), b"[REDACTED]")
                return {"encoding": "base64", "value": base64.b64encode(value).decode("ascii")}
        if isinstance(value, str):
            for secret in sorted(self._secrets, key=len, reverse=True):
                value = value.replace(secret, "[REDACTED]")
            value = re.sub(r"\bBearer\s+[^\s,;\"']+", "Bearer [REDACTED]", value, flags=re.I)
            value = re.sub(r'("(?:authorization|proxy[-_]?authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|gateway[-_]?token|token|password|client[-_]?secret|secret|cookie)"\s*:\s*)"(?:\\.|[^"\\])*"', r'\1"[REDACTED]"', value, flags=re.I)
            return _URL.sub(_safe_url, value)
        if value is None or isinstance(value, (bool, int, float)):
            return value
        raise TraceError("Trace values must be JSON.")

    def fail(self, reason="Trace capture is incomplete."):
        self._poisoned = True
        if not self._closed:
            os.close(self._fd)
            self._closed = True
        raise TraceError(reason)

    def _write(self, kind, data, operation_id=None, operation_state=None):
        if self._closed or self._poisoned:
            raise TraceError("Trace journal is closed or poisoned.")
        try:
            st, named = os.fstat(self._fd), self.path.lstat()
            if (not isinstance(kind, str) or not _LABEL.fullmatch(kind) or
                    not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or st.st_mode & 0o077 or
                    (st.st_dev, st.st_ino) != self._identity or
                    (named.st_dev, named.st_ino) != self._identity or st.st_size != self._bytes):
                raise TraceError("Trace identity or event kind changed.")
            event = {"v": 1, "captureId": self.capture_id, "route": self.route,
                     "pid": os.getpid(), "sequence": self._sequence + 1,
                     "wallTime": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                     "monotonicNs": str(time.monotonic_ns()), "generation": self._generation,
                     "kind": kind, "data": self.redact(data)}
            if operation_id is not None:
                event["operationId"] = operation_id
            if operation_state is not None:
                event["operationState"] = operation_state
            raw = (json.dumps(event, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode("utf-8")
            if len(raw) > self.max_event_bytes:
                raise TraceError("Trace event exceeds the complete-event bound.")
            remaining = memoryview(raw)
            while remaining:
                written = os.write(self._fd, remaining)
                if written <= 0:
                    raise OSError("Trace write made no progress.")
                remaining = remaining[written:]
            os.fsync(self._fd)
            self._bytes += len(raw)
            self._sequence += 1
            return event
        except BaseException as error:
            self._poisoned = True
            os.close(self._fd)
            self._closed = True
            raise TraceError("Trace recording failed; capture remains incomplete.") from error

    def record(self, kind, data, operation_id=None):
        return self._write(kind, data, operation_id)

    def start(self, kind, data):
        self._operations += 1
        operation_id = f"op-{self._operations}"
        self._pending.add(operation_id)
        self._write(kind + ".start", data, operation_id, "start")
        return operation_id

    def end(self, operation_id, kind, data):
        if operation_id not in self._pending:
            self.fail("Unknown or already completed trace operation.")
        event = self._write(kind, data, operation_id, "end")
        self._pending.remove(operation_id)
        return event

    def begin_generation(self, label):
        if self._pending:
            self.fail("Cannot replace a generation with pending operations.")
        self._generation += 1
        self.record("generation.start", {"label": label})
        return self._generation

    def barrier(self, label):
        return self.record("trace.barrier", {"label": label, "pending": len(self._pending)})

    def finish(self):
        if self._closed:
            raise TraceError("Trace journal is closed.")
        if self._pending or self._poisoned:
            self.fail("Trace is unfinished or poisoned; no complete manifest is available.")
        try:
            self.record("trace.complete", {"events": self._sequence + 1, "pending": 0})
        finally:
            if not self._closed:
                os.close(self._fd)
                self._closed = True
        result = read_trace(self.path)
        if not result["complete"]:
            raise TraceError("Trace sealing did not produce a complete journal.")
        return {k: v for k, v in result.items() if k not in ("records", "reasons")}


def read_trace(path):
    """Validate a durable prefix without repairing, truncating or appending it."""
    path = Path(path).absolute()
    result = {"path": str(path), "complete": False, "events": 0, "records": [], "reasons": [], "errors": [], "pending": []}
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    try:
        if path.parent.resolve(strict=True) != path.parent or path.parent.stat().st_mode & 0o077:
            raise TraceError("Unsafe trace directory.")
        fd = os.open(path, flags)
        try:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or st.st_mode & 0o077 or st.st_size > 256 * 1024 * 1024:
                raise TraceError("Unsafe trace file or unsupported size.")
            with os.fdopen(fd, "rb", closefd=False) as stream:
                raw = stream.read()
        finally:
            os.close(fd)
        result["sha256"] = hashlib.sha256(raw).hexdigest()
        pending = set()
        seen = set()
        identity = None
        previous_clock = previous_generation = -1
        footer = False
        event_limit = None
        for line in raw.splitlines(keepends=True):
            if not line.endswith(b"\n"):
                raise TraceError("Unterminated trace tail.")
            event = json.loads(line, parse_constant=_nonfinite)
            current = (event.get("captureId"), event.get("route"), event.get("pid"))
            sequence = len(result["records"]) + 1
            if (footer or type(event.get("v")) is not int or event["v"] != 1 or type(event.get("sequence")) is not int or event["sequence"] != sequence or
                    not isinstance(event.get("kind"), str) or not _LABEL.fullmatch(event["kind"]) or "data" not in event or
                    not isinstance(event.get("monotonicNs"), str) or not re.fullmatch(r"[0-9]+", event["monotonicNs"]) or
                    type(event.get("generation")) is not int):
                raise TraceError("Invalid trace sequence or event schema.")
            clock = int(event["monotonicNs"])
            if clock < previous_clock:
                raise TraceError("Non-monotonic trace clock.")
            if not isinstance(event.get("wallTime"), str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", event["wallTime"]):
                raise TraceError("Missing UTC wall clock.")
            datetime.fromisoformat(event["wallTime"].replace("Z", "+00:00"))
            if identity is None:
                identity = current
                if (event["kind"] != "trace.open" or event["generation"] != 0 or
                        not isinstance(current[0], str) or not _LABEL.fullmatch(current[0]) or
                        not isinstance(current[1], str) or not _LABEL.fullmatch(current[1]) or
                        type(current[2]) is not int or current[2] < 1 or not isinstance(event["data"], dict) or
                        type(event["data"].get("maxEventBytes")) is not int or event["data"]["maxEventBytes"] < 1):
                    raise TraceError("Missing trace-open boundary.")
                event_limit = event["data"]["maxEventBytes"]
                result["captureId"], result["route"] = current[:2]
            elif current != identity:
                raise TraceError("Mixed trace identity.")
            elif event["kind"] == "trace.open":
                raise TraceError("Duplicate trace-open boundary.")
            expected_generation = previous_generation + (1 if event["kind"] == "generation.start" else 0)
            if sequence == 1:
                expected_generation = 0
            if event["generation"] != expected_generation:
                raise TraceError("Invalid generation boundary.")
            if len(line) > event_limit:
                raise TraceError("Oversized trace event.")
            operation = event.get("operationId")
            if event.get("operationState") == "start":
                if not isinstance(operation, str) or not operation or operation in seen:
                    raise TraceError("Invalid operation start.")
                pending.add(operation)
                seen.add(operation)
            elif event.get("operationState") == "end":
                if operation not in pending:
                    raise TraceError("Unmatched operation outcome.")
                pending.remove(operation)
            elif "operationState" in event:
                raise TraceError("Unknown operation state.")
            if event["kind"] == "trace.complete":
                if (pending or not isinstance(event["data"], dict) or event["data"].get("pending") != 0 or
                        event["data"].get("events") != sequence):
                    raise TraceError("Incomplete operation set at footer.")
                footer = True
            result["records"].append(event)
            previous_clock, previous_generation = clock, event["generation"]
        result["events"] = len(result["records"])
        result["pending"] = sorted(pending)
        result["complete"] = footer and not pending
        if not result["complete"]:
            result["reasons"].append("Unsealed trace prefix.")
    except (OSError, ValueError, KeyError, TypeError, TraceError) as error:
        result["events"] = len(result["records"])
        result["reasons"].append(type(error).__name__)
    result["errors"] = result["reasons"][:]
    return result

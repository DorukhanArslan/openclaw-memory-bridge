"""Standard-library consumer of the real foundation JSONL process; no memory algorithm."""
from __future__ import annotations

import json
import os
import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from queue import Empty, Queue
import subprocess
from threading import Thread, Lock
from typing import Any


# Backfill, repeated native CLI polling, cron completion and asynchronous
# publishers have separate bounds. Keep their receipt stream alive through
# the full server envelope without changing ordinary request timeouts.
MAINTENANCE_RESPONSE_TIMEOUT = 2400


class FoundationError(RuntimeError):
    def __init__(self, message: str, code: str = "transport_error"):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class BridgeConfig:
    foundation: Path | str
    root: Path | str
    timeout: float = 180


@dataclass(frozen=True)
class MemoryScope:
    workspace: str
    user: str
    session: str

    def __post_init__(self):
        for value in (self.workspace, self.user, self.session):
            if not re.fullmatch(r"[a-z][a-z0-9-]{0,47}", value):
                raise ValueError("Scope IDs need 1–48 lowercase letters, digits, or hyphens.")

    @property
    def routing_workspace(self) -> str:
        # An application adapter. This is routing, not an authorization boundary.
        encoded = json.dumps([self.workspace, self.user], separators=(",", ":"))
        return "w-" + hashlib.sha256(encoded.encode()).hexdigest()[:40]



class FoundationClient:
    """One sequential request stream. Use a separate client for concurrent callers."""

    def __init__(self, foundation: Path | str, root: Path | str, timeout: float = 180):
        self.foundation = Path(foundation).resolve()
        self.root = Path(root).resolve()
        self.timeout = timeout
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        self.sequence = 0
        self.lock = Lock()
        self.poisoned = False
        self.responses: Queue[str | None] = Queue()
        node = self.foundation / "node_modules/node/bin/node"
        if not node.is_file():
            raise FoundationError("Install foundation dependencies with bash scripts/install.sh first.")
        self.process = subprocess.Popen(
            [str(node), str(self.foundation / "src/stdio.ts"), str(self.root)],
            cwd=self.foundation, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1,
            env={"PATH": str(node.parent) + os.pathsep + "/usr/bin:/bin", "LANG": "en_US.UTF-8"},
        )
        self.reader = Thread(target=self._read, daemon=True)
        self.reader.start()
        try:
            ready = self._receive(15)
            if ready.get("v") != 1 or ready.get("event") != "ready":
                raise FoundationError("Foundation did not acknowledge JSONL protocol v1.")
            self.engine = ready["engine"]
        except BaseException:
            self.process.terminate()
            self.process.wait(timeout=15)
            raise

    def _read(self) -> None:
        assert self.process.stdout is not None
        for line in self.process.stdout:
            self.responses.put(line)
        self.responses.put(None)

    def _receive(self, timeout: float | None = None) -> dict[str, Any]:
        try:
            line = self.responses.get(timeout=self.timeout if timeout is None else timeout)
        except Empty as error:
            self.poisoned = True
            raise FoundationError("Foundation response timed out; close this client before retry.", "timeout") from error
        if line is None:
            self.poisoned = True
            raise FoundationError(f"Foundation exited before a response (code {self.process.poll()}).")
        try:
            response = json.loads(line)
        except json.JSONDecodeError as error:
            self.poisoned = True
            raise FoundationError("Foundation emitted non-JSON protocol output.") from error
        if not isinstance(response, dict):
            self.poisoned = True
            raise FoundationError("Foundation emitted a non-object protocol response.")
        return response

    def call(self, op: str, workspace: str = "alpha", **args: Any) -> Any:
        with self.lock:
            return self._call(op, workspace, **args)

    def _call(self, op: str, workspace: str = "alpha", **args: Any) -> Any:
        if self.poisoned:
            raise FoundationError("Close this client after a transport failure.", "transport_failed")
        if self.process.poll() is not None:
            raise FoundationError("Foundation process is not running.")
        self.sequence += 1
        request_id = f"python-{self.sequence}"
        assert self.process.stdin is not None
        payload = json.dumps({"v": 1, "id": request_id, "op": op, "workspace": workspace, "args": args}) + "\n"
        if len(payload.encode()) > 128000:
            raise FoundationError("Request exceeds 128 KB.", "invalid_request")
        try:
            self.process.stdin.write(payload)
            self.process.stdin.flush()
        except (BrokenPipeError, OSError) as error:
            self.poisoned = True
            raise FoundationError("Foundation input stream failed.", "transport_failed") from error
        response_timeout = max(self.timeout, MAINTENANCE_RESPONSE_TIMEOUT) if op == "run_maintenance" else self.timeout
        response = self._receive(response_timeout)
        if response.get("v") != 1 or response.get("id") != request_id:
            self.poisoned = True
            raise FoundationError("Foundation response did not match this request.", "protocol_error")
        if response.get("ok") is not True:
            error = response.get("error", {})
            if not isinstance(error, dict):
                self.poisoned = True
                raise FoundationError("Foundation emitted a malformed error.", "protocol_error")
            raise FoundationError(str(error.get("message", "Unknown foundation error")), str(error.get("code", "engine_error")))
        return response["result"]

    def close(self) -> None:
        if self.process.poll() is None:
            try:
                self.call("shutdown")
                self.process.wait(timeout=15)
            except (FoundationError, subprocess.TimeoutExpired, BrokenPipeError):
                self.process.terminate()
                try:
                    self.process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
        for stream in [self.process.stdin, self.process.stdout]:
            if stream is not None:
                stream.close()
        self.reader.join(timeout=2)

    def __enter__(self) -> FoundationClient:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()



class MemoryClient(FoundationClient):
    """Installed client. All indexing and recall stay in the native bridge."""
    def __init__(self, config: BridgeConfig):
        super().__init__(config.foundation, config.root, config.timeout)

    def configure(self, scope: MemoryScope, *, ingestion: bool = False):
        return self.call("configure", scope.routing_workspace, ingestion=ingestion)

    def write(self, scope: MemoryScope, note_id: str, text: str):
        return self.call("write", scope.routing_workspace, noteId=note_id, text=text)

    def write_daily(self, scope: MemoryScope, day: str, text: str):
        """Replace an app-owned canonical daily note; index explicitly afterward."""
        return self.call("write_daily", scope.routing_workspace, day=day, text=text)

    def configure_maintenance(self, scope: MemoryScope, *, cumulative_limit_usd: float, host_reserve_usd: float):
        """Select the approved native model and retained finite manual-run ledger."""
        return self.call("configure_maintenance", scope.routing_workspace,
                         cumulativeLimitUsd=cumulative_limit_usd, hostReserveUsd=host_reserve_usd)

    def run_maintenance(self, scope: MemoryScope):
        """Native grounded backfill + managed dreaming; inspect returned receipts."""
        return self.call("run_maintenance", scope.routing_workspace)

    def explain_promotion(self, scope: MemoryScope, selector: str):
        return self.call("explain_promotion", scope.routing_workspace, selector=selector)

    def delete(self, scope: MemoryScope, note_id: str):
        return self.call("delete", scope.routing_workspace, noteId=note_id)

    def index(self, scope: MemoryScope):
        return self.call("index", scope.routing_workspace)

    def search(self, scope: MemoryScope, query: str):
        return self.call("search", scope.routing_workspace, session=scope.session, query=query)

    def get(self, scope: MemoryScope, path: str, *, start: int = 1, lines: int = 40):
        return self.call("get", scope.routing_workspace, path=path, **{"from":start,"lines":lines})

    def restart(self, scope: MemoryScope):
        return self.call("restart", scope.routing_workspace)

    def status(self, scope: MemoryScope):
        return self.call("status", scope.routing_workspace)

    def session_history(self, scope: MemoryScope):
        return self.call("session_history", scope.routing_workspace, session=scope.session)

    def session_state(self, scope: MemoryScope):
        return self.call("session_state", scope.routing_workspace, session=scope.session)

    def inject_fixture(self, scope: MemoryScope, text: str):
        """Explicit synthetic fixture. This does not generate a model reply."""
        return self.call("fixture", scope.routing_workspace, session=scope.session, text=text)

    def reset_session(self, scope: MemoryScope):
        return self.call("session_reset", scope.routing_workspace, session=scope.session)

    def dream_status(self, scope: MemoryScope):
        return self.call("dream_status", scope.routing_workspace)

    def dream_diary(self, scope: MemoryScope):
        return self.call("dream_diary", scope.routing_workspace)

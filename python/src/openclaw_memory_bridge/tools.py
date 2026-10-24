"""Host adapters. OpenClaw retains all index, search and maintenance behavior."""
from __future__ import annotations

from copy import deepcopy
from datetime import date
from threading import Lock
from typing import Any

from .client import MemoryClient, MemoryScope


def _tool(name: str, description: str, key: str) -> dict[str, Any]:
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": {key: {"type": "string"}},
                           "required": [key], "additionalProperties": False}}}


_DEFINITIONS = [
    _tool("memory_search", "Search the user's persistent memory. Read sources before answering personal questions.", "query"),
    _tool("memory_get", "Read source lines by path returned by memory search.", "path"),
    _tool("memory_save", "Replace the complete canonical preference note. Read it first and preserve other current facts. Automatically indexes. This is an application file write, not native supersession.", "text"),
    _tool("memory_save_daily", "Replace today's complete synthetic daily note. Read it first and preserve earlier events with dates. Automatically indexes. This is not native flush.", "text"),
]


class MemoryTools:
    """Bind model tools to a host-selected scope; model arguments cannot select it.

    Calls on this instance are serialized, including write followed by index.
    A failed index leaves the saved source in place and raises to the host.
    No rollback, retry, extraction, contradiction or context policy is added.
    """

    def __init__(self, memory: MemoryClient, scope: MemoryScope, day: str):
        if date.fromisoformat(day).isoformat() != day:
            raise ValueError("day must use YYYY-MM-DD")
        self.memory, self.scope, self.day = memory, scope, day
        self._lock = Lock()

    @property
    def definitions(self) -> list[dict[str, Any]]:
        return deepcopy(_DEFINITIONS)

    def execute(self, name: str, arguments: dict[str, Any]) -> Any:
        key = {"memory_search": "query", "memory_get": "path",
               "memory_save": "text", "memory_save_daily": "text"}.get(name)
        if key is None or not isinstance(arguments, dict) or set(arguments) != {key}:
            raise ValueError("Unknown memory tool or invalid arguments")
        value = arguments[key]
        if not isinstance(value, str) or not value.strip():
            raise ValueError("Memory tool requires a non-empty string")
        with self._lock:
            if name == "memory_search":
                return self.memory.search(self.scope, value)
            if name == "memory_get":
                return self.memory.get(self.scope, value)
            if name == "memory_save":
                result = self.memory.write(self.scope, "preference", value)
            else:
                result = self.memory.write_daily(self.scope, self.day, value)
            # Do not return a success receipt when indexing fails.
            return {**result, "index": self.memory.index(self.scope)}


class MaintenanceJob:
    """Callable for a host scheduler after configure_maintenance succeeds.

    The host selects cadence and handles errors. No automatic retries or daemon.
    A concurrent call on this instance fails instead of running twice.
    """

    def __init__(self, memory: MemoryClient, scope: MemoryScope):
        self.memory, self.scope = memory, scope
        self._lock = Lock()

    def __call__(self) -> Any:
        if not self._lock.acquire(blocking=False):
            raise RuntimeError("Maintenance job is already running")
        try:
            return self.memory.run_maintenance(self.scope)
        finally:
            self._lock.release()

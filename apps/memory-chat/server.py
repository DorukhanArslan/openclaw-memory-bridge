"""Standalone demo consumer. Memory access uses only the installed public SDK."""
from __future__ import annotations

import argparse
from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timezone
import difflib
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import stat
import threading
import time
from typing import Any
from urllib.parse import urlsplit
import uuid

from provider import MODEL, Provider

HERE = Path(__file__).resolve().parent
MAX_STATE_BYTES = 8 * 1024 * 1024
MAX_TURNS = 100
MAX_MODEL_STEPS = 6
SYSTEM = """You are a helpful memory-enabled assistant. Reply in the user's language.
Answer greetings, general questions, and calculations directly. Use memory tools
only when relevant to saved facts or when the user asks you to remember something.
If a memory tool fails, explain the limitation and still answer what you can.
All personal/project facts must come from the user or actual memory tools.
Use memory_save for requested enduring facts and memory_save_daily for dated events.
Read the existing note first before replacing it, preserve unrelated facts, and keep
each note concise (at most 40 lines, 8000 UTF-8 bytes). Canonical preferences hold
current facts; an explicit update is an application note edit, not native fact supersession.
Never claim a write succeeded without a successful tool result. For recall, always
memory_search then memory_get the returned source; cite its relative path.
If the first search misses, try a shorter keyword. Never guess a saved fact.
You own this conversation; OpenClaw supplies memory, not your chat history.
No automatic native flush, compaction or maintenance is performed by this demo.
"""
TOUR = [
    "Save the Atlas project",
    "Update the code name to Nova",
    "Recall in a new conversation",
    "Restart and recall again",
    "Complete the run capture",
]
NATIVE_TOUR = [
    "Share a preference naturally",
    "Update the project detail",
    "Recall in a new conversation",
    "Restart and recall again",
    "Complete the run capture",
]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def private_directory(path: Path) -> None:
    path = path.absolute()
    for part in [*reversed(path.parents), path]:
        if part.is_symlink():
            raise ValueError("Demo data directories must not be symbolic links.")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not path.is_dir():
        raise ValueError("Demo data root must be a directory.")
    path.chmod(0o700)


def read_json(path: Path) -> dict[str, Any]:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_STATE_BYTES:
            raise ValueError("Invalid or oversized demo record.")
        result = json.load(stream)
    if not isinstance(result, dict):
        raise ValueError("Demo record must be a JSON object.")
    return result


def save_json(path: Path, value: Any) -> None:
    if path.is_symlink():
        raise ValueError("Demo records must not be symbolic links.")
    payload = json.dumps(value, ensure_ascii=False, indent=2).encode()
    if len(payload) > MAX_STATE_BYTES:
        raise RuntimeError("Demo record is full; export it before starting another data root.")
    temporary = path.with_name(f".{path.name}-{uuid.uuid4().hex}.tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def source_changes(before: list[dict], after: list[dict]) -> list[dict]:
    old, new = {f["path"]: f["text"] for f in before}, {f["path"]: f["text"] for f in after}
    result = []
    for path in sorted(old.keys() | new.keys()):
        left, right = old.get(path), new.get(path)
        if left == right:
            continue
        lines = list(difflib.unified_diff((left or "").splitlines(), (right or "").splitlines(), lineterm=""))
        result.append({"path": path, "before": left, "after": right,
                       "added": sum(line.startswith("+") and not line.startswith("+++") for line in lines),
                       "removed": sum(line.startswith("-") and not line.startswith("---") for line in lines)})
    return result


class TurnCancelled(RuntimeError):
    pass


class _MemoryAccess:
    """Resolve the installed client only when a model actually uses a tool."""
    def __init__(self, owner):
        self.owner = owner

    def __getattr__(self, name):
        if name not in {"get", "search", "write", "write_daily", "index"}:
            raise AttributeError(name)
        return lambda *args, **kwargs: self.owner._sdk_call(name, *args, **kwargs)


class ChatDemo:
    """A responsive host/model loop; native memory is an explicit tool dependency."""

    def __init__(self, foundation: Path, root: Path, provider: Any, *, client_factory=None):
        from openclaw_memory_bridge import BridgeConfig, MemoryClient, MemoryScope, MemoryTools

        self.foundation, self.root = Path(foundation).resolve(), Path(root).absolute()
        private_directory(self.root)
        self._lock = threading.RLock()
        self._view_lock = threading.Lock()
        self._published = {}
        self._job = None
        self._stopping = threading.Event()
        self._cancel = threading.Event()
        self._turn_deadline = None
        self.busy = False
        self._record = self.root / "app-state.json"
        self._lock_path = self.root / "chat.lock"
        self._lock_fd = os.open(self._lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        os.write(self._lock_fd, str(os.getpid()).encode())
        self.memory = None
        self.closed = False
        self.provider = provider
        self._MemoryScope, self._MemoryTools = MemoryScope, MemoryTools
        self._config = BridgeConfig(self.foundation, self.root / "memory", timeout=25)
        self._client_factory = client_factory or MemoryClient
        self._memory_access = _MemoryAccess(self)
        self._turn_memory_failed = False
        self._turn_memory_used = False
        self._uncertain_write = False
        self.memory_available = None
        self.memory_stale = False
        self.memory_error = None
        self.conversations, self.turns = [], []
        self.observed_paths = set()
        self.files, self.changes, self.events = [], [], []
        self.error = None
        self.notice = None
        self.tour_step = 0
        try:
            if self._record.exists() or self._record.is_symlink():
                record = read_json(self._record)
                if record.get("schemaVersion") != 1 or record.get("kind") != "memory-chat-state":
                    raise ValueError("Unsupported demo state record.")
                self.conversations = record["conversations"]
                self.current = record["current"]
                self.turns = record["turns"]
                self.observed_paths = set(record["observedPaths"])
                self.tour_step = record.get("tourStep", 0)
                self.files = record.get("lastSources", [])
                if not self.files:
                    prior = next((t for t in reversed(self.turns) if t.get("after")), None)
                    self.files = deepcopy(prior["after"]) if prior else []
                self.memory_stale = bool(self.files)
                for turn in self.turns:
                    if turn.get("status") == "running":
                        turn["status"] = "interrupted"
                        for conversation in self.conversations:
                            if conversation["id"] == turn["conversationId"]:
                                conversation["blocked"] = True
                if not self.conversations or self.current not in {c["id"] for c in self.conversations}:
                    raise ValueError("Invalid saved conversation state.")
            if not self.conversations or self.conversation.get("blocked"):
                had_previous = bool(self.conversations)
                self.new_conversation()
                if had_previous:
                    self.notice = "Opened a new chat after an interrupted request. Saved memory and request records were preserved."
            # Opening the page must never require a healthy native Gateway.
            self._save()
        except BaseException:
            self.close()
            raise

    @property
    def conversation(self):
        return next(c for c in self.conversations if c["id"] == self.current)

    @property
    def scope(self):
        return self._MemoryScope("memory-chat", "demo", self.current)

    def _save(self):
        save_json(self._record, {"schemaVersion": 1, "kind": "memory-chat-state",
                                "conversations": self.conversations, "current": self.current,
                                "turns": self.turns, "observedPaths": sorted(self.observed_paths),
                                "lastSources": self.files, "tourStep": self.tour_step})
        self._publish()

    def _clean(self, value):
        if isinstance(value, str):
            return value.replace(str(self.root), "<demo-data>").replace(str(self.foundation), "<foundation>")
        if isinstance(value, list):
            return [self._clean(item) for item in value]
        if isinstance(value, dict):
            return {key: self._clean(item) for key, item in value.items()}
        return value

    def _publish(self):
        if not self.conversations:
            return
        revision = hashlib.sha256(json.dumps(self.files, sort_keys=True).encode()).hexdigest()
        conversation = self.conversation
        status = self.provider.status() if hasattr(self.provider, "status") else {"ready": bool(self.provider.ready), "reason": None}
        try:
            budget = self.provider.state()
        except Exception:
            with self._view_lock:
                budget = deepcopy(self._published.get("budget", {"limitUsd": 0, "remainingUsd": 0, "reservedUsd": 0, "requests": 0}))
            status = {"ready": False, "reason": "allowance_unavailable"}
            self.notice = "The retained provider allowance could not be read. No new model request can be admitted."
        result = {"mode": "live", "model": {"name": MODEL, **status},
                  "conversation": {"id": conversation["id"], "messages": deepcopy(conversation["messages"]),
                                   "blocked": bool(conversation.get("blocked"))},
                  "conversations": [{"id": c["id"], "title": c["title"] if c["messages"] else "New chat",
                                     "updatedAt": c["updatedAt"]} for c in reversed(self.conversations)],
                  "memory": {"files": deepcopy(self.files), "revision": revision,
                             "available": self.memory_available, "stale": self.memory_stale, "error": self.memory_error},
                  "changes": deepcopy(self.changes), "events": deepcopy(self.events),
                  "budget": budget, "error": self.error, "notice": self.notice,
                  "tour": {"step": self.tour_step, "total": len(TOUR),
                           "label": TOUR[min(self.tour_step, len(TOUR) - 1)], "done": self.tour_step >= len(TOUR)}}
        with self._view_lock:
            self._published = result

    def state(self, *, refresh=False):
        # Polling has no SDK, provider-network, or long-running-operation lock.
        with self._view_lock:
            result = deepcopy(self._published)
            result["busy"] = self.busy
            result["job"] = deepcopy(self._job)
            return result

    def _progress(self, label):
        with self._view_lock:
            if self._job is not None:
                self._job["label"] = label
        self._publish()

    def request_cancel(self):
        self._cancel.set()

    def request_stop(self):
        self._stopping.set()
        self._cancel.set()

    def _check_stopping(self):
        if self._stopping.is_set() or self._cancel.is_set():
            raise TurnCancelled("The request was stopped. No further model or memory operation was started.")
        if self._turn_deadline is not None and time.monotonic() >= self._turn_deadline:
            raise TimeoutError("The chat turn reached its time limit. No automatic retry was made.")

    def _get_memory(self):
        self._check_stopping()
        if self.memory is None:
            self.memory = self._client_factory(self._config)
        if getattr(self.memory, "poisoned", False):
            raise RuntimeError("The memory connection needs to be restarted before another memory operation.")
        return self.memory

    def _memory_failure(self, error):
        self._turn_memory_failed = True
        self.memory_available = False
        self.memory_stale = bool(self.files)
        self.memory_error = self._clean(str(error))[:12000]
        self._progress("Memory unavailable; returning the result to the model")
        if self.memory is not None and getattr(self.memory, "poisoned", False):
            client, self.memory = self.memory, None
            try:
                client.close()
            except Exception:
                pass

    def _sdk_call(self, name, *args, **kwargs):
        self._check_stopping()
        self._turn_memory_used = True
        if self._turn_memory_failed:
            raise RuntimeError("Memory is unavailable for this turn. No saved fact or write can be confirmed.")
        try:
            client = self._get_memory()
        except TurnCancelled:
            raise
        except Exception as error:
            self._memory_failure(error)
            raise RuntimeError("Memory is unavailable: " + self._clean(str(error))[:3000]) from error
        try:
            result = getattr(client, name)(*args, **kwargs)
        except TurnCancelled:
            raise
        except Exception as error:
            code = getattr(error, "code", None)
            if name in {"write", "write_daily"} and code not in {"invalid_request", "engine_error"}:
                self._uncertain_write = True
            self._memory_failure(error)
            raise RuntimeError("Memory operation failed: " + self._clean(str(error))[:3000]) from error
        self.memory_available = True
        self.memory_error = None
        return result

    def _source(self, path):
        source = self._sdk_call("get", self.scope, path, start=1, lines=200)
        if source.get("status") == "not_found":
            return None
        text = source.get("text")
        if not isinstance(text, str):
            raise RuntimeError("SDK did not return a readable source excerpt.")
        return {"path": path, "text": text, "sha256": hashlib.sha256(text.encode()).hexdigest(),
                "excerpt": True, "maxLines": 200}

    def _snapshot(self):
        files = []
        if len(self.observed_paths) > 30:
            raise RuntimeError("The demo inspector supports at most 30 observed sources.")
        for path in sorted(self.observed_paths):
            source = self._source(path)
            if source is not None:
                files.append(source)
        self.files = files
        self.memory_stale = False
        return deepcopy(files)

    def _baseline(self, path, turn):
        source = self._source(path)
        self.observed_paths.add(path)
        turn["before"] = [f for f in turn["before"] if f["path"] != path]
        if source is not None:
            turn["before"].append(source)
        self._publish()

    def _observe(self, value):
        if not isinstance(value, dict):
            return
        path = value.get("path")
        if isinstance(path, str) and (path.startswith("memory/") or path in {"USER.md", "MEMORY.md", "DREAMS.md"}):
            self.observed_paths.add(path)
        for result in value.get("results", []):
            self._observe(result)

    def new_conversation(self):
        with self._lock:
            self._check_stopping()
            if len(self.conversations) >= 50:
                raise ValueError("Conversation limit reached; export this demo first.")
            self.current = "c-" + uuid.uuid4().hex[:24]
            self.conversations.append({"id": self.current, "title": "New chat", "updatedAt": now(),
                                       "messages": [], "modelMessages": [{"role": "system", "content": SYSTEM}], "blocked": False})
            self.changes, self.events, self.error, self.notice = [], [], None, None
            self._save()
            return self.current

    def select_conversation(self, id):
        with self._lock:
            if id not in {c["id"] for c in self.conversations}:
                raise ValueError("Conversation not found.")
            self.current = id
            prior = next((t for t in reversed(self.turns) if t["conversationId"] == id), None)
            self.events = deepcopy(prior.get("events", [])) if prior else []
            self.changes = deepcopy(prior.get("changes", [])) if prior else []
            self.error = None
            self._save()

    def chat(self, message):
        with self._lock:
            self._check_stopping()
            if not isinstance(message, str) or not message.strip() or len(message.encode()) > 8000:
                raise ValueError("Send a nonempty message of at most 8000 UTF-8 bytes.")
            if not self.provider.ready:
                raise ValueError("Live chat requires a configured OpenRouter key and remaining demo allowance.")
            if len(self.turns) >= MAX_TURNS:
                raise ValueError("Demo turn limit reached; export the current run.")
            conversation = self.conversation
            if conversation.get("blocked"):
                raise ValueError("A memory write has an uncertain outcome. Start a new chat; saved memory and the allowance will be kept.")
            original_history = deepcopy(conversation["modelMessages"])
            self._turn_memory_failed = self._turn_memory_used = self._uncertain_write = False
            self._turn_deadline = time.monotonic() + 120
            self.events, self.changes, self.error, self.notice = [], [], None, None
            turn = {"id": uuid.uuid4().hex, "conversationId": self.current, "user": message,
                    "startedAt": now(), "status": "running", "before": deepcopy(self.files),
                    "events": self.events, "modelResponses": [], "assistant": None, "attemptedWritePaths": []}
            self.turns.append(turn)
            visible_user = {"id": uuid.uuid4().hex, "role": "user", "content": message, "createdAt": now(), "status": "running"}
            conversation["messages"].append(visible_user)
            if len(conversation["messages"]) == 1:
                conversation["title"] = message[:45]
            conversation["modelMessages"].append({"role": "user", "content": message})
            self._save()
            tools = self._MemoryTools(self._memory_access, self.scope, datetime.now(timezone.utc).date().isoformat())
            try:
                for _ in range(MAX_MODEL_STEPS):
                    self._check_stopping()
                    model_event = {"kind": "model", "label": "Model response", "status": "running", "detail": {"model": MODEL}}
                    self.events.append(model_event)
                    self._progress("Waiting for the model response")
                    try:
                        response, usage = self.provider.complete(conversation["modelMessages"], tools.definitions)
                    except Exception as error:
                        model_event["status"] = "failed"
                        model_event["detail"]["error"] = self._clean(str(error))[:3000]
                        raise
                    model_event["status"], model_event["detail"]["usage"] = "completed", usage
                    turn["modelResponses"].append({"message": deepcopy(response), "usage": usage, "observedAt": now()})
                    conversation["modelMessages"].append(response)
                    self._check_stopping()
                    if usage and usage.get("completion_truncated"):
                        self.notice = "The model reached its output limit. The displayed answer is its partial response."
                    calls = response.get("tool_calls") or []
                    if not calls:
                        reply = response.get("content")
                        if not isinstance(reply, str) or not reply.strip():
                            raise RuntimeError("The real model returned no final answer.")
                        conversation["messages"].append({"id": uuid.uuid4().hex, "role": "assistant", "content": reply, "createdAt": now()})
                        turn["assistant"], turn["status"] = reply, "completed"
                        visible_user["status"] = "completed"
                        conversation["blocked"] = self._uncertain_write
                        # Make the real answer visible before any optional
                        # inspector read, even if the Gateway stalls afterward.
                        self._publish()
                        return reply
                    if len(calls) > 8:
                        raise RuntimeError("The model requested too many tools in one response.")
                    for call in calls:
                        self._check_stopping()
                        name = call["function"]["name"]
                        event = {"kind": "tool", "label": name, "status": "running", "detail": {}}
                        self.events.append(event)
                        self._progress("Running " + name)
                        try:
                            arguments = json.loads(call["function"]["arguments"])
                            if name in {"memory_save", "memory_save_daily"}:
                                text = arguments.get("text", "") if isinstance(arguments, dict) else ""
                                if not isinstance(text, str) or not text.strip() or len(text.encode()) > 8000 or len(text.splitlines()) > 40:
                                    raise ValueError("Demo notes must be nonempty, at most 40 lines and 8000 UTF-8 bytes.")
                                target = "memory/preference.md" if name == "memory_save" else f"memory/{tools.day}.md"
                                self._baseline(target, turn)
                                if target not in turn["attemptedWritePaths"]:
                                    turn["attemptedWritePaths"].append(target)
                                self.memory_stale = True
                            result = tools.execute(name, arguments)
                            self._observe(result)
                            event["status"], event["detail"] = "completed", {"arguments": arguments, "result": result}
                        except TurnCancelled:
                            event["status"] = "cancelled"
                            raise
                        except Exception as error:
                            result = {"ok": False, "error": {"code": getattr(error, "code", "tool_error"), "message": self._clean(str(error))[:3000]}}
                            event["status"], event["detail"] = "failed", result
                        conversation["modelMessages"].append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result, ensure_ascii=False)})
                        self._save()
                raise RuntimeError("The model tool-loop limit was reached; no automatic retry was made.")
            except Exception as error:
                turn["status"] = "cancelled" if isinstance(error, TurnCancelled) else "failed"
                visible_user["status"] = turn["status"]
                conversation["blocked"] = self._uncertain_write
                if not self._uncertain_write:
                    conversation["modelMessages"] = original_history
                self.error = self._clean(str(error))[:12000]
                raise
            finally:
                self._turn_deadline = None
                conversation["updatedAt"], turn["finishedAt"] = now(), now()
                if self._turn_memory_used and not self._turn_memory_failed and not self._cancel.is_set() and not self._stopping.is_set():
                    try:
                        self._snapshot()
                    except Exception as error:
                        self.memory_available, self.memory_stale = False, bool(self.files)
                        self.memory_error = self._clean(str(error))[:12000]
                        turn["snapshotError"] = self.memory_error
                turn["after"] = deepcopy(self.files)
                turn["snapshotVerified"] = bool(self._turn_memory_used and self.memory_available is True and not self.memory_stale)
                self.changes = [c for c in source_changes(turn["before"], self.files) if c["path"] in turn["attemptedWritePaths"]] if turn["snapshotVerified"] else []
                turn["changes"] = deepcopy(self.changes)
                turn["uncertainWrite"] = self._uncertain_write
                self._save()

    def refresh_memory(self):
        with self._lock:
            self._check_stopping()
            self._turn_memory_failed = False
            self._turn_memory_used = False
            self.observed_paths.update({"memory/preference.md", f"memory/{datetime.now(timezone.utc).date().isoformat()}.md"})
            self._progress("Refreshing saved memory sources")
            try:
                self._snapshot()
            finally:
                self._save()

    def restart_memory(self):
        with self._lock:
            self._check_stopping()
            self._turn_memory_failed = False
            self._progress("Restarting the memory connection")
            if self.memory is not None and getattr(self.memory, "poisoned", False):
                self.memory.close()
                self.memory = None
            client = self._get_memory()
            receipt = client.restart(self.scope)
            client.close()
            self.memory = None
            self.memory_available, self.memory_stale, self.memory_error = None, bool(self.files), None
            self.new_conversation()
            self.events = [{"kind": "restart", "label": "Gateway and SDK reopened", "status": "completed", "detail": receipt}]
            self._save()

    def tour_next(self):
        with self._lock:
            step = self.tour_step
            if step >= len(TOUR):
                return
            if step == 0:
                self.chat("This is a demo: my project's code name is Atlas and its delivery day is Friday. Save both in persistent memory and preserve any other saved facts.")
            elif step == 1:
                self.chat("Change my demo project's current code name to Nova. Preserve its Friday delivery day and any other saved facts.")
            elif step in {2, 3}:
                if step == 2:
                    self.new_conversation()
                else:
                    self.restart_memory()
                self.chat("What are my demo project's current code name and delivery day? Search memory, read the actual source, and cite its path in your answer.")
                reply = (self.turns[-1].get("assistant") or "").casefold()
                names = {e["label"] for e in self.events if e["kind"] == "tool" and e["status"] == "completed"}
                if not ({"memory_search", "memory_get"} <= names and "nova" in reply and any(day in reply for day in ["friday", "cuma"])):
                    raise RuntimeError("Walkthrough recall was not verified. You can keep chatting normally; no step was automatically retried.")
            else:
                self.events.append({"kind": "capture", "label": "Run capture ready", "status": "completed", "detail": {"turns": len(self.turns), "export": "/api/export"}})
            if step in {0, 1}:
                text = "\n".join(f["text"] for f in self.files if f["path"] == "memory/preference.md").casefold()
                expected = "atlas" if step == 0 else "nova"
                saved = any(e["label"] == "memory_save" and e["status"] == "completed" and "index" in e.get("detail", {}).get("result", {}) for e in self.events if e["kind"] == "tool")
                if not saved or self.memory_available is not True or self.memory_stale or expected not in text or not any(day in text for day in ["friday", "cuma"]):
                    raise RuntimeError("Walkthrough memory save was not verified. Your model reply is kept; see the memory warning and keep chatting normally.")
            self.tour_step += 1
            self._save()

    def export(self):
        if not self._lock.acquire(blocking=False):
            raise BlockingIOError("Wait for the active request to finish before exporting.")
        try:
            with self._view_lock:
                if self.busy:
                    raise BlockingIOError("Wait for the active request to finish before exporting.")
            return self._export_capture()
        finally:
            self._lock.release()

    def _export_capture(self):
        with self._view_lock:
            public_state = deepcopy(self._published)
            public_state["busy"] = self.busy
            public_state["job"] = deepcopy(self._job)
        # Export is called only while idle by the HTTP layer.
        turns = deepcopy(self.turns)
        for turn in turns:
            for response in turn.get("modelResponses", []):
                for field in ["reasoning", "reasoning_details"]:
                    response.get("message", {}).pop(field, None)
        return {"schemaVersion": 1, "kind": "memory-chat-capture", "exportedAt": now(),
                "evidenceKind": getattr(self.provider, "evidence_kind", "live-provider"),
                "sourceContract": "Observed public SDK excerpts; stale/unavailable snapshots are explicitly marked.",
                "captureContract": "Provider-internal reasoning metadata is excluded from public export.",
                "state": public_state, "turns": turns,
                "conversations": [{k: deepcopy(v) for k, v in c.items() if k != "modelMessages"} for c in self.conversations]}

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.request_stop()
        try:
            if self.memory is not None:
                self.memory.close()
        finally:
            if getattr(self, "_lock_fd", None) is not None:
                os.close(self._lock_fd)
                self._lock_fd = None
                self._lock_path.unlink(missing_ok=True)

def native_text(content):
    """Only public text blocks, never thinking or provider continuation data."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(block["text"] for block in content
                         if isinstance(block, dict) and block.get("type") == "text"
                         and isinstance(block.get("text"), str))
    return ""


class NativeChatDemo(ChatDemo):
    """Production consumer: OpenClaw owns the actual conversation lifecycle.

    ChatDemo remains the independent tool-host example used by its controlled
    tests. This class never falls back to that model loop when native chat fails.
    """

    def __init__(self, foundation, root, provider, *, client_factory=None, broker_factory=None):
        self.broker = None
        self._native_configured = False
        self._native_turn = None
        super().__init__(foundation, root, provider, client_factory=client_factory)
        self._config = replace(self._config, timeout=180)
        try:
            if self.conversation["messages"] and "native" not in self.conversation:
                super().new_conversation()
                self.notice = "Opened a new chat. Earlier demo conversations and saved notes were preserved."
                self._save()
            if broker_factory is None:
                from native_provider import NativeProviderBroker
                broker_factory = NativeProviderBroker
            self.broker = broker_factory(provider, allow_request=self._native_allowed,
                                         on_completion=self._native_completion).start()
            self._publish()
        except BaseException:
            self.close()
            raise

    def _publish(self):
        super()._publish()
        if not self.conversations:
            return
        native = self.conversation.get("native", {})
        lifecycle = {"mode": "native-chat", "transcriptPersisted": bool(native.get("transcriptPersisted")),
                     "indexed": bool(native.get("indexed")),
                     "pendingIndex": any(c.get("native", {}).get("pendingIndex")
                                         or (c.get("native", {}).get("transcriptPersisted") and not c["native"].get("indexed"))
                                         for c in self.conversations),
                     "error": self.memory_error}
        with self._view_lock:
            self._published["memory"]["lifecycle"] = lifecycle
            self._published["conversation"]["readOnly"] = bool(self.conversation["messages"] and "native" not in self.conversation)
            self._published["tour"]["label"] = NATIVE_TOUR[min(self.tour_step, len(NATIVE_TOUR) - 1)]

    def _clean(self, value):
        value = super()._clean(value)
        url = getattr(self.broker, "base_url", None)
        if isinstance(value, str) and url:
            return value.replace(url, "<host-model-endpoint>")
        return value

    def _native_allowed(self):
        self._check_stopping()
        if self._native_turn is None:
            raise RuntimeError("No explicit chat request is active; no model request was admitted.")
        return True

    def _native_completion(self, response, usage):
        turn = self._native_turn
        if turn is None:
            return
        message = {key: deepcopy(response[key]) for key in ["role", "content", "tool_calls"] if key in response}
        turn["modelResponses"].append({"message": self._clean(message), "usage": usage, "observedAt": now()})
        self.events.append({"kind": "model", "label": "OpenClaw model response", "status": "completed",
                            "detail": {"model": MODEL, "usage": usage}})
        if usage and usage.get("completion_truncated"):
            self.notice = "The model reached its output limit. The displayed answer may be partial."
        self._progress("OpenClaw is completing the conversation")

    def _get_memory(self):
        previous = self.memory
        client = super()._get_memory()
        if client is not previous:
            self._native_configured = False
        if not self._native_configured:
            self._progress("Connecting the OpenClaw conversation")
            client.configure_chat(self.scope, model_url=self.broker.base_url)
            self._native_configured = True
        return client

    def _index_pending(self):
        pending = [c for c in self.conversations if c.get("native", {}).get("pendingIndex")
                   or (c.get("native", {}).get("transcriptPersisted") and not c["native"].get("indexed"))]
        if not pending:
            return
        self._check_stopping()
        self._progress("Preparing saved conversations for recall")
        if self.memory is not None and getattr(self.memory, "poisoned", False):
            self.memory.close()
            self.memory = None
            self._native_configured = False
        try:
            receipt = self._get_memory().index(self.scope)
        except Exception as error:
            self.memory_error = self._clean(str(error))[:12000]
            self._save()
            raise RuntimeError("The conversation is saved, but recall indexing failed. A new chat was not opened. " + self.memory_error) from error
        for conversation in pending:
            conversation["native"]["indexed"] = bool(conversation["native"].get("transcriptPersisted"))
            conversation["native"]["pendingIndex"] = False
        self.memory_error = None
        self.events.append({"kind": "index", "label": "Saved conversations indexed", "status": "completed",
                            "detail": self._clean(receipt)})
        self._save()

    def new_conversation(self):
        with self._lock:
            # Construction restores the page without starting native processes.
            if self.broker is not None:
                self._index_pending()
            return super().new_conversation()

    def _native_activity(self, history, turn):
        requests = {}
        for response in turn["modelResponses"]:
            for call in response.get("message", {}).get("tool_calls", []):
                function = call.get("function", {})
                try:
                    arguments = json.loads(function.get("arguments", "{}"))
                except (ValueError, TypeError):
                    arguments = {}
                requests[call.get("id")] = {"name": function.get("name"), "arguments": arguments}
        observed = {}
        for group in history.get("activity", []):
            for item in group.get("items", []):
                call_id = item.get("toolCallId")
                if item.get("kind") == "tool" and call_id in requests:
                    observed[call_id] = item
        for call_id, item in observed.items():
            requested = requests[call_id]
            status = item.get("status", "unknown")
            if status == "completed" and item.get("phase") != "end":
                status = "unknown"
            detail = {"nativeActivity": {k: self._clean(item[k]) for k in ["phase", "status", "title", "summary", "error"] if k in item},
                      "requestedArguments": self._clean(requested["arguments"])}
            name = item.get("name") or requested["name"] or "Native tool"
            self.events.append({"kind": "tool", "label": name, "status": status, "detail": detail})
            if status != "completed" or not isinstance(requested["arguments"], dict):
                continue
            arguments = requested["arguments"]
            path = arguments.get("path", arguments.get("file_path"))
            if not isinstance(path, str):
                continue
            path = Path(path)
            if path.is_absolute():
                try:
                    path = path.relative_to(self.root / "memory" / self.scope.routing_workspace / "workspace")
                except ValueError:
                    continue
            if ".." in path.parts:
                continue
            source = path.as_posix()
            self._observe({"path": source})
            if name in {"write", "edit"} and source in self.observed_paths:
                turn["attemptedWritePaths"].append(source)

    def chat(self, message):
        with self._lock:
            self._check_stopping()
            if not isinstance(message, str) or not message.strip() or len(message.encode()) > 8000:
                raise ValueError("Send a nonempty message of at most 8000 UTF-8 bytes.")
            if not self.provider.ready:
                raise ValueError("Live chat requires a configured OpenRouter key and remaining demo allowance.")
            if len(self.turns) >= MAX_TURNS:
                raise ValueError("Demo turn limit reached; export the current run.")
            conversation = self.conversation
            if conversation["messages"] and "native" not in conversation:
                raise ValueError("This earlier demo conversation is read-only. Start a new chat to use OpenClaw conversation memory.")
            if conversation.get("blocked"):
                raise ValueError("The previous native operation has an uncertain outcome. Start a new chat; saved memory and the allowance are preserved.")
            self._turn_memory_failed = self._uncertain_write = False
            self._turn_deadline = time.monotonic() + 120
            self.events, self.changes, self.error, self.notice = [], [], None, None
            turn = {"id": uuid.uuid4().hex, "conversationId": self.current, "user": message,
                    "startedAt": now(), "status": "running", "before": deepcopy(self.files),
                    "events": self.events, "modelResponses": [], "assistant": None, "attemptedWritePaths": []}
            self.turns.append(turn)
            visible_user = {"id": uuid.uuid4().hex, "role": "user", "content": message, "createdAt": now(), "status": "running"}
            conversation["messages"].append(visible_user)
            if len(conversation["messages"]) == 1:
                conversation["title"] = message[:45]
            self._native_turn = turn
            native = conversation.setdefault("native", {})
            native["pendingIndex"], native["indexed"] = True, False
            self._save()
            native_settled = False
            abort_confirmed = False
            dispatch_attempted = False
            run_id = None
            try:
                self._progress("Waiting for the OpenClaw conversation")
                client = self._get_memory()
                with self.broker.turn():
                    dispatch_attempted = True
                    accepted = client.start_chat(self.scope, message)
                    run_id = accepted.get("runId")
                    if not isinstance(run_id, str) or not run_id:
                        raise RuntimeError("OpenClaw did not acknowledge this conversation run.")
                    try:
                        while True:
                            self._check_stopping()
                            receipt = client.wait_chat(self.scope, run_id)
                            status = receipt.get("completion", {}).get("status")
                            if status in {"pending", "timeout"}:
                                continue
                            native_settled = True
                            receipt["accepted"] = accepted
                            break
                    finally:
                        if not native_settled:
                            try:
                                aborted = client.abort_chat(self.scope, run_id)
                                abort_confirmed = bool(aborted.get("aborted"))
                            except Exception:
                                pass
                self._check_stopping()
                if receipt.get("completion", {}).get("status") != "ok":
                    raise RuntimeError("OpenClaw did not confirm completion of this conversation turn.")
                history = receipt.get("history", {})
                messages = history.get("messages", [])
                user_index = next((i for i in range(len(messages) - 1, -1, -1)
                                   if messages[i].get("role") == "user"), None)
                if user_index is None or message not in native_text(messages[user_index].get("content")):
                    raise RuntimeError("OpenClaw did not return the submitted user turn in its saved history.")
                native = {"sessionId": history.get("sessionId") or receipt.get("state", {}).get("session", {}).get("sessionId"),
                          "sessionKey": history.get("sessionKey"), "transcriptPersisted": True,
                          "indexed": False, "pendingIndex": True}
                conversation["native"] = native
                turn["native"] = deepcopy(native)
                turn["nativeReceipt"] = self._clean({"accepted": receipt["accepted"], "completion": receipt["completion"],
                                                     "sessionId": native["sessionId"], "sessionKey": native["sessionKey"]})
                self.events.append({"kind": "conversation", "label": "Conversation saved by OpenClaw", "status": "completed",
                                    "detail": turn["nativeReceipt"]})
                new_messages = messages[user_index + 1:]
                self._native_activity(history, turn)
                # Tool receipts are observed native results; the host does not
                # execute its own save/extraction loop or invent successful writes.
                for entry in new_messages:
                    if entry.get("role") in {"toolResult", "tool"}:
                        name = entry.get("toolName", entry.get("name", "Native tool"))
                        text = native_text(entry.get("content"))
                        failed = bool(entry.get("isError"))
                        self.events.append({"kind": "tool", "label": name,
                                            "status": "failed" if failed else "completed",
                                            "detail": {"result": self._clean(text)}})
                        details = entry.get("details")
                        if isinstance(details, dict):
                            self._observe(details)
                reply = next((native_text(entry.get("content")) for entry in reversed(new_messages)
                              if entry.get("role") == "assistant" and native_text(entry.get("content")).strip()), None)
                if not reply:
                    raise RuntimeError("The native conversation completed without a visible model answer.")
                conversation["messages"].append({"id": uuid.uuid4().hex, "role": "assistant", "content": reply, "createdAt": now()})
                visible_user["status"] = turn["status"] = "completed"
                turn["assistant"] = reply
                self.memory_available, self.memory_error = True, None
                self._publish()
                return reply
            except Exception as error:
                turn["status"] = "cancelled" if isinstance(error, TurnCancelled) else "failed"
                visible_user["status"] = turn["status"]
                # A lost native receipt can include writes; never silently
                # replay the user request into a new session.
                conversation["blocked"] = bool(getattr(self.memory, "poisoned", False)) or (dispatch_attempted and not native_settled and not abort_confirmed)
                self.error = self._clean(str(error))[:12000]
                if not isinstance(error, TurnCancelled):
                    self.memory_error = self.error
                raise
            finally:
                self._native_turn = None
                self._turn_deadline = None
                conversation["updatedAt"], turn["finishedAt"] = now(), now()
                if turn["status"] == "completed" and not self._cancel.is_set() and not self._stopping.is_set():
                    try:
                        self._snapshot()
                    except Exception as error:
                        self.memory_available = False
                        self.memory_stale = bool(self.files)
                        self.memory_error = self._clean(str(error))[:12000]
                        turn["snapshotError"] = self.memory_error
                turn["after"] = deepcopy(self.files)
                turn["snapshotVerified"] = self.memory_available is True and not self.memory_stale and not turn.get("snapshotError")
                known_before = {source["path"] for source in turn["before"]}
                self.changes = [change for change in source_changes(turn["before"], self.files)
                                if change["path"] in turn["attemptedWritePaths"] and change["path"] in known_before]
                turn["changes"] = deepcopy(self.changes)
                self._save()

    def restart_memory(self):
        with self._lock:
            self._check_stopping()
            self._index_pending()
            self._progress("Restarting the OpenClaw conversation connection")
            if self.memory is not None and getattr(self.memory, "poisoned", False):
                self.memory.close()
                self.memory = None
            client = self._get_memory()
            receipt = client.restart(self.scope)
            client.close()
            self.memory = None
            self._native_configured = False
            self.memory_available, self.memory_stale, self.memory_error = None, bool(self.files), None
            super().new_conversation()
            self.events = [{"kind": "restart", "label": "OpenClaw connection restarted", "status": "completed", "detail": self._clean(receipt)}]
            self._save()

    def tour_next(self):
        with self._lock:
            step = self.tour_step
            if step >= len(TOUR):
                return
            if step == 0:
                self.chat("I take my coffee without sugar, and my demo project's code name is Atlas.")
                if not self.conversation.get("native", {}).get("transcriptPersisted"):
                    raise RuntimeError("OpenClaw did not confirm the saved conversation.")
            elif step == 1:
                self.chat("My demo project's code name has changed to Nova. My coffee preference is unchanged.")
            elif step in {2, 3}:
                if step == 2:
                    self.new_conversation()
                else:
                    self.restart_memory()
                self.chat("How do I take my coffee, and what is my demo project's current code name?")
                reply = (self.turns[-1].get("assistant") or "").casefold()
                if "nova" not in reply or not any(word in reply for word in ["without sugar", "no sugar", "unsweetened", "şekersiz"]):
                    raise RuntimeError("Recall was not verified. Your actual reply is kept; no step was automatically retried.")
            else:
                self.events.append({"kind": "capture", "label": "Run capture ready", "status": "completed", "detail": {"turns": len(self.turns), "export": "/api/export"}})
            self.tour_step += 1
            self._save()

    def close(self):
        try:
            super().close()
        finally:
            if self.broker is not None:
                self.broker.close()


class ReplayDemo:
    """Read-only viewing of an exported run; no SDK or provider is constructed."""
    def __init__(self, path: Path):
        self.capture = read_json(path)
        if self.capture.get("schemaVersion") != 1 or self.capture.get("kind") != "memory-chat-capture":
            raise ValueError("Choose a memory-chat capture JSON exported by this demo.")
        self._state = deepcopy(self.capture["state"])
        if not isinstance(self._state.get("conversation", {}).get("messages"), list):
            raise ValueError("The capture has no valid conversation.")
        self._lock, self.busy = threading.RLock(), False

    def state(self, **_) -> dict:
        result = deepcopy(self._state)
        result["mode"], result["busy"], result["model"]["ready"] = "replay", False, False
        return result

    def select_conversation(self, id: str) -> None:
        selected = next((c for c in self.capture["conversations"] if c["id"] == id), None)
        if not selected:
            raise ValueError("Conversation not found.")
        self._state["conversation"] = {k: deepcopy(selected[k]) for k in ["id", "messages"]}
        turn = next((t for t in reversed(self.capture["turns"]) if t["conversationId"] == id), None)
        if turn:
            self._state["memory"]["files"] = deepcopy(turn.get("after", turn.get("before", [])))
            verified = turn.get("snapshotVerified", turn.get("status") == "completed" and not turn.get("snapshotError") and "after" in turn)
            self._state["memory"]["available"] = bool(verified)
            self._state["memory"]["stale"] = bool(self._state["memory"]["files"]) and not verified
            self._state["memory"]["error"] = turn.get("snapshotError")
            self._state["memory"]["revision"] = hashlib.sha256(json.dumps(self._state["memory"]["files"], sort_keys=True).encode()).hexdigest()
            self._state["events"] = deepcopy(turn.get("events", []))
            self._state["changes"] = deepcopy(turn.get("changes", []))
        if self._state["memory"].get("lifecycle", {}).get("mode") == "native-chat":
            native = selected.get("native", {})
            self._state["memory"]["lifecycle"] = {
                "mode": "native-chat", "transcriptPersisted": bool(native.get("transcriptPersisted")),
                "indexed": bool(native.get("indexed")), "pendingIndex": bool(native.get("pendingIndex")),
                "error": turn.get("snapshotError") if turn else None,
            }

    def export(self) -> dict:
        return deepcopy(self.capture)

    def close(self) -> None:
        pass

    def request_stop(self) -> None:
        pass


class DemoJobs:
    """One bounded mutation worker; cached state remains readable while it runs."""
    def __init__(self, demo):
        self.demo = demo
        self.worker = None

    def submit(self, method, args):
        demo = self.demo
        with demo._view_lock:
            if demo.busy:
                raise BlockingIOError("A request is already running. Stop it or wait for it to finish.")
            demo._cancel.clear()
            demo.busy = True
            demo._job = {"id": uuid.uuid4().hex, "status": "running", "label": "Starting request", "startedAt": now(), "error": None}
        self.worker = threading.Thread(target=self._run, args=(method, args), daemon=True)
        self.worker.start()
        return demo.state()

    def _run(self, method, args):
        demo = self.demo
        outcome, error = "completed", None
        with demo._lock:
            try:
                demo.error = None
                demo._check_stopping()
                getattr(demo, method)(**args)
            except TurnCancelled as failure:
                outcome, error = "cancelled", demo._clean(str(failure))[:12000]
            except Exception as failure:
                outcome, error = "failed", demo._clean(str(failure))[:12000]
            finally:
                demo._turn_deadline = None
                demo.error = error
                try:
                    demo._publish()
                except Exception as failure:
                    outcome, error = "failed", "The result could not be published: " + demo._clean(str(failure))[:1000]
                finally:
                    with demo._view_lock:
                        demo.busy = False
                        demo._job.update(status=outcome, error=error, finishedAt=now(),
                                         label={"completed": "Request completed", "cancelled": "Request stopped", "failed": "Request failed"}[outcome])

    def control(self, method, args):
        demo = self.demo
        with demo._view_lock:
            if demo.busy:
                raise BlockingIOError("A request is already running. Stop it or wait for it to finish.")
            demo.busy = True
            demo._cancel.clear()
        try:
            with demo._lock:
                getattr(demo, method)(**args)
        finally:
            with demo._view_lock:
                demo.busy = False
                demo._job = None
        return demo.state()

    def cancel(self):
        demo = self.demo
        with demo._view_lock:
            if demo.busy and demo._job:
                demo.request_cancel()
                demo._job.update(status="cancelling", label="Stopping after the current operation")
        return demo.state()


def create_server(demo, host: str = "127.0.0.1", port: int = 8765) -> ThreadingHTTPServer:
    if host not in {"127.0.0.1", "localhost"}:
        raise ValueError("This trusted-local demo only binds to loopback.")
    jobs = DemoJobs(demo) if isinstance(demo, ChatDemo) else None

    class Handler(BaseHTTPRequestHandler):
        server_version = "MemoryChat/2"

        def log_message(self, *_):
            pass

        def _send(self, status, body, *, content_type="application/json; charset=utf-8", download=False):
            payload = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            if download:
                self.send_header("Content-Disposition", 'attachment; filename="memory-chat-capture.json"')
            self.end_headers()
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def _local(self):
            expected = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}
            if self.headers.get("Host") not in expected:
                self._send(403, {"error": "This demo accepts only its local origin."})
                return False
            origin = self.headers.get("Origin")
            if origin and origin not in {"http://" + h for h in expected}:
                self._send(403, {"error": "Cross-origin requests are not allowed."})
                return False
            return True

        def do_GET(self):
            if not self._local():
                return
            path = urlsplit(self.path).path
            try:
                if path == "/api/state":
                    return self._send(200, demo.state())
                if path == "/api/export":
                    if isinstance(demo, ChatDemo) and demo.state()["busy"]:
                        return self._send(409, {"error": "Wait for the active request to finish before exporting."})
                    return self._send(200, demo.export(), download=True)
                static = {"/": ("index.html", "text/html; charset=utf-8"),
                          "/static/app.css": ("app.css", "text/css; charset=utf-8"),
                          "/static/app.js": ("app.js", "text/javascript; charset=utf-8")}
                if path in static:
                    name, content_type = static[path]
                    return self._send(200, (HERE / "static" / name).read_bytes(), content_type=content_type)
                self._send(404, {"error": "Not found."})
            except BlockingIOError as error:
                self._send(409, {"error": str(error)})
            except Exception as error:
                self._send(500, {"error": "The demo state could not be read: " + str(error)[:300]})

        def do_POST(self):
            if not self._local():
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 12000 or self.headers.get_content_type() != "application/json":
                    raise ValueError("Send a JSON request of at most 12000 bytes.")
                args = json.loads(self.rfile.read(length).decode("utf-8"))
                if not isinstance(args, dict):
                    raise ValueError("Send a JSON object.")
                path = urlsplit(self.path).path
                routes = {"/api/chat": ("chat", {"message"}), "/api/conversations": ("new_conversation", set()),
                          "/api/conversations/select": ("select_conversation", {"id"}),
                          "/api/restart": ("restart_memory", set()), "/api/tour/next": ("tour_next", set()),
                          "/api/memory/refresh": ("refresh_memory", set()), "/api/cancel": ("cancel", set())}
                if path not in routes:
                    return self._send(404, {"error": "Not found."})
                method, keys = routes[path]
                if set(args) != keys:
                    raise ValueError("Unexpected request arguments.")
                if isinstance(demo, ReplayDemo):
                    if method != "select_conversation":
                        return self._send(409, {"error": "Recorded runs are read-only; no model calls are made."})
                    demo.select_conversation(**args)
                    return self._send(200, demo.state())
                if method == "cancel":
                    return self._send(200, jobs.cancel())
                if method in {"new_conversation", "select_conversation"} and not (isinstance(demo, NativeChatDemo) and method == "new_conversation"):
                    return self._send(200, jobs.control(method, args))
                return self._send(202, jobs.submit(method, args))
            except BlockingIOError as error:
                self._send(409, {"error": str(error), "state": demo.state()})
            except (ValueError, UnicodeError) as error:
                self._send(400, {"error": str(error)[:300]})
            except Exception as error:
                message = demo._clean(str(error)) if isinstance(demo, ChatDemo) else str(error)
                self._send(502, {"error": message[:12000], "state": demo.state()})

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.jobs = jobs
    return server

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--foundation", type=Path, default=HERE.parents[1])
    parser.add_argument("--root", type=Path, default=HERE.parents[1] / ".lab" / "memory-chat")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--budget-usd", type=float, default=0,
                        help="Explicit retained estimated allowance for real model requests; zero disables chat.")
    parser.add_argument("--replay", type=Path, help="View an exported run without constructing the SDK or provider.")
    args = parser.parse_args()
    demo = None
    server = None
    try:
        if args.replay:
            demo = ReplayDemo(args.replay)
        else:
            private_directory(args.root)
            provider = Provider(args.root / "provider-ledger.json", args.budget_usd)
            demo = NativeChatDemo(args.foundation, args.root, provider)
        server = create_server(demo, args.host, args.port)
        def stop(*_):
            demo.request_stop()
            raise KeyboardInterrupt
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        print(f"Memory Chat: http://127.0.0.1:{server.server_port}", flush=True)
        print("Keys stay on the server. New conversations preserve memory and the retained estimated allowance.", flush=True)
        if not args.replay and not demo.provider.ready:
            print("Chat is disabled. Set OPENROUTER_API_KEY and explicitly choose --budget-usd to enable the real model.", flush=True)
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    except Exception as error:
        parser.exit(1, f"Memory Chat could not start: {error}\n")
    finally:
        if demo is not None:
            demo.request_stop()
        if server is not None:
            server.server_close()
        if demo is not None:
            with demo._lock:
                demo.close()


if __name__ == "__main__":
    main()

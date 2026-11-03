"""Standalone demo consumer. Memory access uses only the installed public SDK."""
from __future__ import annotations

import argparse
from copy import deepcopy
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
from typing import Any
from urllib.parse import urlsplit
import uuid

from provider import MODEL, Provider

HERE = Path(__file__).resolve().parent
MAX_STATE_BYTES = 8 * 1024 * 1024
MAX_TURNS = 100
MAX_MODEL_STEPS = 6
SYSTEM = """You are a helpful memory-enabled assistant. Reply in the user's language.
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


class ChatDemo:
    """Host/model loop plus public MemoryClient/MemoryTools; no engine internals."""

    def __init__(self, foundation: Path, root: Path, provider: Any, *, client_factory=None):
        from openclaw_memory_bridge import BridgeConfig, MemoryClient, MemoryScope, MemoryTools

        self.foundation, self.root = Path(foundation).resolve(), Path(root).absolute()
        private_directory(self.root)
        self._lock = threading.RLock()
        self._stopping = threading.Event()
        self.busy = False
        self._record = self.root / "app-state.json"
        self._lock_path = self.root / "chat.lock"
        self._lock_fd = os.open(self._lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
        os.write(self._lock_fd, str(os.getpid()).encode())
        self.memory = None
        self.closed = False
        self.provider = provider
        self._MemoryScope, self._MemoryTools = MemoryScope, MemoryTools
        self._config = BridgeConfig(self.foundation, self.root / "memory")
        self._client_factory = client_factory or MemoryClient
        self.conversations: list[dict] = []
        self.turns: list[dict] = []
        self.observed_paths: set[str] = set()
        self.files: list[dict] = []
        self.changes: list[dict] = []
        self.events: list[dict] = []
        self.error = None
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
                for turn in self.turns:
                    if turn.get("status") == "running":
                        turn["status"] = "interrupted"
                        for conversation in self.conversations:
                            if conversation["id"] == turn["conversationId"]:
                                conversation["blocked"] = True
                if not self.conversations or self.current not in {c["id"] for c in self.conversations}:
                    raise ValueError("Invalid saved conversation state.")
            self.memory = self._client_factory(self._config)
            if not self.conversations:
                self.new_conversation()
            self._snapshot()
            self._save()
        except BaseException:
            self.close()
            raise

    @property
    def conversation(self) -> dict:
        return next(c for c in self.conversations if c["id"] == self.current)

    @property
    def scope(self):
        return self._MemoryScope("memory-chat", "demo", self.current)

    def _save(self) -> None:
        save_json(self._record, {"schemaVersion": 1, "kind": "memory-chat-state",
                                "conversations": self.conversations, "current": self.current,
                                "turns": self.turns, "observedPaths": sorted(self.observed_paths),
                                "tourStep": self.tour_step})

    def _clean(self, value: Any) -> Any:
        if isinstance(value, str):
            return value.replace(str(self.root), "<demo-data>").replace(str(self.foundation), "<foundation>")
        if isinstance(value, list):
            return [self._clean(item) for item in value]
        if isinstance(value, dict):
            return {key: self._clean(item) for key, item in value.items()}
        return value

    def request_stop(self) -> None:
        self._stopping.set()

    def _check_stopping(self) -> None:
        if self._stopping.is_set():
            raise RuntimeError("The demo is shutting down; no further model or write operation was started.")

    def _snapshot(self) -> list[dict]:
        """Read observed sources through SDK get, never a native workspace/DB."""
        files = []
        if len(self.observed_paths) > 30:
            raise RuntimeError("The demo inspector supports at most 30 observed sources.")
        for path in sorted(self.observed_paths):
            source = self.memory.get(self.scope, path, start=1, lines=200)
            if source.get("status") == "not_found":
                continue
            text = source.get("text")
            if not isinstance(text, str):
                raise RuntimeError("SDK did not return a readable source excerpt.")
            files.append({"path": path, "text": text,
                          "sha256": hashlib.sha256(text.encode()).hexdigest(),
                          "excerpt": True, "maxLines": 200})
        self.files = files
        return deepcopy(files)

    def _observe(self, value: Any) -> None:
        if not isinstance(value, dict):
            return
        path = value.get("path")
        if isinstance(path, str) and (path.startswith("memory/") or path in {"USER.md", "MEMORY.md", "DREAMS.md"}):
            self.observed_paths.add(path)
        for result in value.get("results", []):
            self._observe(result)

    def state(self, *, refresh: bool = False) -> dict:
        with self._lock:
            if refresh:
                self._snapshot()
            revision = hashlib.sha256(json.dumps(self.files, sort_keys=True).encode()).hexdigest()
            conversation = self.conversation
            result = {"mode": "live", "model": {"name": MODEL, "ready": bool(self.provider.ready)},
                      "conversation": {"id": conversation["id"], "messages": conversation["messages"],
                                       "blocked": bool(conversation.get("blocked"))},
                      "conversations": [{"id": c["id"], "title": c["title"] if c["messages"] else "New chat",
                                         "updatedAt": c["updatedAt"]} for c in reversed(self.conversations)],
                      "memory": {"files": self.files, "revision": revision}, "changes": self.changes,
                      "events": self.events, "budget": self.provider.state(), "busy": self.busy,
                      "error": self.error, "tour": {"step": self.tour_step, "total": len(TOUR),
                      "label": TOUR[min(self.tour_step, len(TOUR) - 1)], "done": self.tour_step >= len(TOUR)}}
            # Source text and its digest must describe the same SDK excerpt.
            # Do not redact or otherwise rewrite actual user/source content.
            return deepcopy(result)

    def new_conversation(self) -> str:
        with self._lock:
            self._check_stopping()
            if len(self.conversations) >= 50:
                raise ValueError("Conversation limit reached; export this demo first.")
            self.current = "c-" + uuid.uuid4().hex[:24]
            self.conversations.append({"id": self.current, "title": "New chat", "updatedAt": now(),
                                       "messages": [], "modelMessages": [{"role": "system", "content": SYSTEM}],
                                       "blocked": False})
            self.changes, self.events, self.error = [], [], None
            self._save()
            return self.current

    def select_conversation(self, id: str) -> None:
        with self._lock:
            if id not in {c["id"] for c in self.conversations}:
                raise ValueError("Conversation not found.")
            self.current = id
            prior = next((t for t in reversed(self.turns) if t["conversationId"] == id), None)
            self.events = deepcopy(prior.get("events", [])) if prior else []
            self.changes = deepcopy(prior.get("changes", [])) if prior else []
            self.error = None
            self._save()

    def chat(self, message: str) -> str:
        with self._lock:
            self._check_stopping()
            if not isinstance(message, str) or not message.strip() or len(message.encode()) > 8000:
                raise ValueError("Send a nonempty message of at most 8000 UTF-8 bytes.")
            if not self.provider.ready:
                raise ValueError("Live chat requires OPENROUTER_API_KEY and a positive --budget-usd allowance on the server.")
            if len(self.turns) >= MAX_TURNS:
                raise ValueError("Demo turn limit reached; export the current run.")
            conversation = self.conversation
            if conversation.get("blocked"):
                raise ValueError("This conversation stopped with an uncertain operation. Start a new chat to keep using the saved memory.")
            tools = self._MemoryTools(self.memory, self.scope, datetime.now(timezone.utc).date().isoformat())
            # These are the two public adapter write targets. Read them before
            # mutation even when this app has not observed the source before.
            self.observed_paths.update({"memory/preference.md", f"memory/{tools.day}.md"})
            before = self._snapshot()
            self.events, self.changes, self.error = [], [], None
            turn = {"id": uuid.uuid4().hex, "conversationId": self.current, "user": message,
                    "startedAt": now(), "status": "running", "before": before,
                    "events": self.events, "modelResponses": [], "assistant": None,
                    "attemptedWritePaths": []}
            self.turns.append(turn)
            conversation["messages"].append({"id": uuid.uuid4().hex, "role": "user", "content": message, "createdAt": now()})
            if len(conversation["messages"]) == 1:
                conversation["title"] = message[:45]
            conversation["modelMessages"].append({"role": "user", "content": message})
            self._save()  # An interrupted turn cannot silently become an unused turn.
            try:
                for _ in range(MAX_MODEL_STEPS):
                    self._check_stopping()
                    response, usage = self.provider.complete(conversation["modelMessages"], tools.definitions)
                    turn["modelResponses"].append({"message": deepcopy(response), "usage": usage, "observedAt": now()})
                    conversation["modelMessages"].append(response)
                    self.events.append({"kind": "model", "label": "Model response", "status": "completed",
                                        "detail": {"model": MODEL, "usage": usage}})
                    self._check_stopping()
                    calls = response.get("tool_calls") or []
                    if not calls:
                        reply = response.get("content")
                        if not isinstance(reply, str) or not reply.strip():
                            raise RuntimeError("The real model returned no final answer.")
                        conversation["messages"].append({"id": uuid.uuid4().hex, "role": "assistant", "content": reply, "createdAt": now()})
                        turn["assistant"], turn["status"] = reply, "completed"
                        return reply
                    if len(calls) > 8:
                        raise RuntimeError("The model requested too many tools in one response.")
                    for call in calls:
                        self._check_stopping()
                        name = call["function"]["name"]
                        event = {"kind": "tool", "label": name, "status": "running", "detail": {}}
                        self.events.append(event)
                        try:
                            arguments = json.loads(call["function"]["arguments"])
                            if name in {"memory_save", "memory_save_daily"}:
                                text = arguments.get("text", "") if isinstance(arguments, dict) else ""
                                if not isinstance(text, str) or len(text.encode()) > 8000 or len(text.splitlines()) > 40:
                                    raise ValueError("Demo notes must be at most 40 lines and 8000 UTF-8 bytes.")
                                target = "memory/preference.md" if name == "memory_save" else f"memory/{tools.day}.md"
                                if target not in turn["attemptedWritePaths"]:
                                    turn["attemptedWritePaths"].append(target)
                            result = tools.execute(name, arguments)
                            self._observe(result)
                            event["status"], event["detail"] = "completed", {"arguments": arguments, "result": result}
                        except Exception as error:
                            # A file write may precede a failed index. Observe its
                            # known public path and show the actual persisted text.
                            if name in {"memory_save", "memory_save_daily"}:
                                self.observed_paths.add("memory/preference.md" if name == "memory_save" else f"memory/{tools.day}.md")
                            result = {"ok": False, "error": {"code": getattr(error, "code", "tool_error"),
                                                              "message": self._clean(str(error))[:1000]}}
                            event["status"], event["detail"] = "failed", result
                        conversation["modelMessages"].append({"role": "tool", "tool_call_id": call["id"],
                                                               "content": json.dumps(result, ensure_ascii=False)})
                        self._save()
                raise RuntimeError("The model tool-loop limit was reached; no automatic retry was made.")
            except Exception as error:
                turn["status"] = "failed"
                conversation["blocked"] = True
                self.error = self._clean(str(error))[:1000]
                raise
            finally:
                conversation["updatedAt"] = now()
                turn["finishedAt"] = now()
                try:
                    after = self._snapshot()
                    # Discovering an existing source through search/get is a
                    # read, not evidence of a newly created file.
                    self.changes = [change for change in source_changes(before, after)
                                    if change["path"] in turn["attemptedWritePaths"]]
                    turn["after"], turn["changes"] = after, self.changes
                except Exception as error:
                    turn["snapshotError"] = self._clean(str(error))[:1000]
                    turn["status"] = "failed"
                    conversation["blocked"] = True
                    self.error = "The source snapshot could not be verified; this step was not accepted as successful."
                    raise RuntimeError(self.error) from error
                finally:
                    self._save()

    def restart_memory(self) -> None:
        with self._lock:
            self._check_stopping()
            # An explicit restart may recover a poisoned transport. It never
            # replays the operation whose acknowledgement was uncertain.
            if self.memory is None or getattr(self.memory, "poisoned", False):
                if self.memory is not None:
                    self.memory.close()
                self.memory = None
                self.memory = self._client_factory(self._config)
            receipt = self.memory.restart(self.scope)
            self.memory.close()
            self.memory = None
            self.memory = self._client_factory(self._config)
            self.new_conversation()
            self._snapshot()
            self.events = [{"kind": "restart", "label": "Gateway and SDK reopened", "status": "completed", "detail": receipt}]
            self._save()

    def tour_next(self) -> None:
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
                    raise RuntimeError("Walkthrough validation failed: recall must use the current facts and observed source tools.")
            else:
                self.events.append({"kind": "capture", "label": "Run capture ready", "status": "completed",
                                    "detail": {"turns": len(self.turns), "export": "/api/export"}})
            if step in {0, 1}:
                text = "\n".join(f["text"] for f in self.files if f["path"] == "memory/preference.md").casefold()
                expected = "atlas" if step == 0 else "nova"
                saved_and_indexed = any(
                    event["label"] == "memory_save" and event["status"] == "completed"
                    and "index" in event.get("detail", {}).get("result", {})
                    for event in self.events if event["kind"] == "tool"
                )
                if not saved_and_indexed or expected not in text or not any(day in text for day in ["friday", "cuma"]):
                    raise RuntimeError("Walkthrough validation failed: a successful SDK save/index receipt and both expected facts are required.")
            self.tour_step += 1
            self._save()

    def export(self) -> dict:
        with self._lock:
            turns = deepcopy(self.turns)
            for turn in turns:
                for response in turn.get("modelResponses", []):
                    for field in ["reasoning", "reasoning_details"]:
                        response.get("message", {}).pop(field, None)
            return {"schemaVersion": 1, "kind": "memory-chat-capture", "exportedAt": now(),
                                "evidenceKind": getattr(self.provider, "evidence_kind", "live-provider"),
                                "sourceContract": "Observed source excerpts returned by public SDK get (up to 200 lines).",
                                "captureContract": "Provider-internal reasoning metadata is excluded from public export.",
                                "state": self.state(), "turns": turns,
                                "conversations": [{k: deepcopy(v) for k, v in c.items() if k != "modelMessages"} for c in self.conversations]}

    def close(self) -> None:
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
            self._state["events"] = deepcopy(turn.get("events", []))
            self._state["changes"] = deepcopy(turn.get("changes", []))

    def export(self) -> dict:
        return deepcopy(self.capture)

    def close(self) -> None:
        pass

    def request_stop(self) -> None:
        pass


def create_server(demo, host: str = "127.0.0.1", port: int = 8765) -> ThreadingHTTPServer:
    if host not in {"127.0.0.1", "localhost"}:
        raise ValueError("This trusted-local demo only binds to loopback.")

    class Handler(BaseHTTPRequestHandler):
        server_version = "MemoryChat/1"

        def log_message(self, *_):
            pass

        def _send(self, status: int, body: Any, *, content_type: str = "application/json; charset=utf-8", download: bool = False):
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
            self.wfile.write(payload)

        def _local(self) -> bool:
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
                    return self._send(200, demo.state(refresh=True))
                if path == "/api/export":
                    return self._send(200, demo.export(), download=True)
                static = {"/": ("index.html", "text/html; charset=utf-8"),
                          "/static/app.css": ("app.css", "text/css; charset=utf-8"),
                          "/static/app.js": ("app.js", "text/javascript; charset=utf-8")}
                if path in static:
                    name, content_type = static[path]
                    return self._send(200, (HERE / "static" / name).read_bytes(), content_type=content_type)
                self._send(404, {"error": "Not found."})
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
                          "/api/restart": ("restart_memory", set()), "/api/tour/next": ("tour_next", set())}
                if path not in routes:
                    return self._send(404, {"error": "Not found."})
                method, keys = routes[path]
                if set(args) != keys:
                    raise ValueError("Unexpected request arguments.")
                if isinstance(demo, ReplayDemo) and method != "select_conversation":
                    return self._send(409, {"error": "Recorded runs are read-only; no model calls are made."})
                if not demo._lock.acquire(blocking=False):
                    return self._send(409, {"error": "An operation is already in progress. Wait for it to finish."})
                try:
                    demo.busy = True
                    getattr(demo, method)(**args)
                except Exception as error:
                    demo.busy = False
                    message = demo._clean(str(error)) if isinstance(demo, ChatDemo) else str(error)
                    return self._send(400 if isinstance(error, ValueError) else 502,
                                      {"error": message[:1000], "state": demo.state()})
                finally:
                    demo.busy = False
                    demo._lock.release()
                self._send(200, demo.state())
            except (ValueError, UnicodeError) as error:
                self._send(400, {"error": str(error)[:300]})

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
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
            demo = ChatDemo(args.foundation, args.root, provider)
        server = create_server(demo, args.host, args.port)
        def stop(*_):
            demo.request_stop()
            raise KeyboardInterrupt
        signal.signal(signal.SIGTERM, stop)
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
        if server is not None:
            server.server_close()
        if demo is not None:
            with demo._lock:
                demo.close()


if __name__ == "__main__":
    main()

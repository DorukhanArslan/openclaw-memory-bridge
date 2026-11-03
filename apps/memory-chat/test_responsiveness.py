"""Host responsiveness regressions with labelled protocol fixtures, no paid calls."""
from __future__ import annotations

from copy import deepcopy
from contextlib import contextmanager
import hashlib
import http.client
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from openclaw_memory_bridge import FoundationError

from server import ChatDemo, ReplayDemo, create_server, save_json


FOUNDATION = Path(__file__).resolve().parents[2]


class ReplyFixture:
    evidence_kind = "protocol-fixture"
    ready = True

    def __init__(self):
        self.requests = 0
        self.inputs = []

    def state(self):
        return {"limitUsd": 1, "reservedUsd": 0, "remainingUsd": 1,
                "requests": self.requests}

    def complete(self, messages, tools):
        self.requests += 1
        self.inputs.append(deepcopy(messages))
        return {"role": "assistant", "content": "Protocol fixture reply: four."}, {"fixture": True}

    def call(self, name, **arguments):
        return {"role": "assistant", "content": None, "tool_calls": [{
            "id": f"fixture-{self.requests}", "type": "function",
            "function": {"name": name, "arguments": json.dumps(arguments)},
        }]}


@contextmanager
def running_server(demo):
    server = create_server(demo, port=0)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield server
    finally:
        demo.request_stop()
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)


def request(server, method, path, body=None, timeout=2):
    connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=timeout)
    try:
        payload = json.dumps(body) if body is not None else None
        headers = {"Content-Type": "application/json"} if body is not None else {}
        connection.request(method, path, payload, headers)
        response = connection.getresponse()
        return response.status, json.loads(response.read())
    finally:
        connection.close()


class LazyMemoryChat(unittest.TestCase):
    def test_uncertain_write_is_not_replayed_and_keeps_the_specific_mutation_guard(self):
        operations = []

        class UncertainMemory:
            poisoned = False

            def __init__(self, _):
                pass

            def get(self, scope, path, **_):
                return {"status": "not_found", "path": path}

            def write(self, scope, note_id, text):
                operations.append("write")
                self.poisoned = True
                raise FoundationError("Fixture write acknowledgement was lost.", "timeout")

            def index(self, _):
                raise AssertionError("An uncertain write cannot be followed by indexing.")

            def close(self):
                operations.append("close")

        class RetryingToolFixture(ReplyFixture):
            def complete(self, messages, tools):
                self.requests += 1
                if self.requests <= 2:
                    return self.call("memory_save", text="Fixture unknown write outcome."), {"fixture": True}
                result = json.loads(messages[-1]["content"])
                assert result["ok"] is False
                return {"role": "assistant", "content": "Protocol fixture: the write could not be confirmed."}, {"fixture": True}

        with tempfile.TemporaryDirectory(prefix="chat-uncertain-write-") as temporary:
            provider = RetryingToolFixture()
            demo = ChatDemo(FOUNDATION, Path(temporary), provider, client_factory=UncertainMemory)
            try:
                reply = demo.chat("Save one fact through this controlled uncertain write.")
                self.assertIn("could not be confirmed", reply)
                self.assertEqual(operations.count("write"), 1)
                self.assertEqual(provider.requests, 3)
                self.assertTrue(demo.state()["conversation"]["blocked"])
                self.assertEqual(demo.turns[-1]["attemptedWritePaths"], ["memory/preference.md"])
                self.assertTrue(demo.turns[-1]["uncertainWrite"])
                self.assertEqual(demo.changes, [])
                with self.assertRaisesRegex(ValueError, "uncertain"):
                    demo.chat("This must not dispatch against uncertain prior history.")
                self.assertEqual(provider.requests, 3)
                demo.new_conversation()
                self.assertFalse(demo.state()["conversation"]["blocked"])
            finally:
                demo.close()

    def test_legacy_blocked_startup_opens_fresh_context_without_touching_memory_or_allowance(self):
        source = {"path": "memory/preference.md", "text": "Fixture last-read code name: Nova.\n"}
        source["sha256"] = hashlib.sha256(source["text"].encode()).hexdigest()
        old_messages = [{"id": "fixture-user", "role": "user", "content": "Keep this failed historical request.",
                         "createdAt": "2026-01-01T00:00:00+00:00"}]
        old = {"id": "c-legacy", "title": "Fixture interrupted conversation", "messages": old_messages,
               "updatedAt": "2026-01-01T00:00:00+00:00", "blocked": True,
               "modelMessages": [{"role": "system", "content": "Fixture prior host history."},
                                 {"role": "user", "content": old_messages[0]["content"]}]}
        prior_turn = {"id": "fixture-prior-turn", "conversationId": old["id"], "status": "failed",
                      "user": old_messages[0]["content"], "assistant": None, "events": [],
                      "attemptedWritePaths": [source["path"]], "before": [], "after": [source], "changes": []}

        def forbidden_memory(_):
            raise AssertionError("Reading persisted UI state must not start a Gateway.")

        with tempfile.TemporaryDirectory(prefix="chat-legacy-recovery-") as temporary:
            root = Path(temporary)
            save_json(root / "app-state.json", {"schemaVersion": 1, "kind": "memory-chat-state",
                                                "conversations": [old], "current": old["id"],
                                                "turns": [prior_turn], "observedPaths": [source["path"]], "tourStep": 0})
            provider = ReplyFixture()
            provider.requests = 7
            demo = ChatDemo(FOUNDATION, root, provider, client_factory=forbidden_memory)
            try:
                self.assertNotEqual(demo.current, old["id"])
                self.assertEqual(demo.conversation["messages"], [])
                preserved = next(c for c in demo.conversations if c["id"] == old["id"])
                self.assertEqual(preserved["messages"], old_messages)
                self.assertTrue(preserved["blocked"])
                self.assertEqual(demo.turns[0], prior_turn)
                self.assertEqual(demo.observed_paths, {source["path"]})
                self.assertEqual(provider.requests, 7)
                self.assertEqual(demo.state()["memory"]["files"][0]["text"], source["text"])
                self.assertTrue(demo.state()["memory"]["stale"])
            finally:
                demo.close()

    def test_plain_reply_never_starts_the_sdk_even_if_the_gateway_is_unavailable(self):
        factory_calls = []

        def unavailable(config):
            factory_calls.append(config)
            raise RuntimeError("Fixture Gateway is unavailable.")

        with tempfile.TemporaryDirectory(prefix="chat-lazy-sdk-") as temporary:
            provider = ReplyFixture()
            demo = ChatDemo(FOUNDATION, Path(temporary), provider, client_factory=unavailable)
            try:
                self.assertEqual(factory_calls, [])
                self.assertEqual(demo.state()["conversation"]["messages"], [])
                self.assertEqual(factory_calls, [])
                self.assertEqual(demo.chat("What is two plus two?"), "Protocol fixture reply: four.")
                self.assertEqual(factory_calls, [])
                self.assertEqual(provider.requests, 1)
                self.assertEqual([m["role"] for m in demo.state()["conversation"]["messages"]], ["user", "assistant"])
                self.assertFalse(demo.state()["conversation"]["blocked"])
            finally:
                demo.close()

    def test_a_memory_connection_failure_is_returned_to_the_model_without_faking_a_save(self):
        factory_calls = []

        def unavailable(config):
            factory_calls.append(config)
            raise RuntimeError("Fixture Gateway connection refused.")

        class MemoryFailureFixture(ReplyFixture):
            def complete(self, messages, tools):
                self.requests += 1
                if messages[-1]["role"] == "user":
                    return self.call("memory_search", query="project"), {"fixture": True}
                observed = json.loads(messages[-1]["content"])
                assert observed["ok"] is False, observed
                return {"role": "assistant", "content": "Protocol fixture: I can chat, but saved memory is unavailable."}, {"fixture": True}

        with tempfile.TemporaryDirectory(prefix="chat-offline-memory-") as temporary:
            provider = MemoryFailureFixture()
            demo = ChatDemo(FOUNDATION, Path(temporary), provider, client_factory=unavailable)
            try:
                reply = demo.chat("What was my project's code name?")
                self.assertIn("memory is unavailable", reply)
                self.assertEqual(provider.requests, 2)
                self.assertEqual(len(factory_calls), 1)
                self.assertFalse(demo.state()["memory"]["available"])
                self.assertTrue(demo.state()["memory"]["error"])
                self.assertFalse(demo.state()["conversation"]["blocked"])
                self.assertEqual(demo.turns[-1]["status"], "completed")
                self.assertEqual(demo.turns[-1]["attemptedWritePaths"], [])
                tools = [e for e in demo.events if e["kind"] == "tool"]
                self.assertEqual(len(tools), 1)
                self.assertEqual(tools[0]["status"], "failed")
                self.assertEqual(demo.changes, [])
            finally:
                demo.close()

    def test_post_reply_source_inspection_failure_does_not_discard_the_model_reply(self):
        class ReadableMemory:
            def __init__(self, _):
                pass

            def get(self, scope, path, **_):
                return {"status": "ok", "path": path, "text": "Code name: Nova.\n"}

            def close(self):
                pass

        class ReadFixture(ReplyFixture):
            def complete(self, messages, tools):
                self.requests += 1
                if messages[-1]["role"] == "user":
                    return self.call("memory_get", path="memory/preference.md"), {"fixture": True}
                return {"role": "assistant", "content": "Protocol fixture: the code name is Nova."}, {"fixture": True}

        with tempfile.TemporaryDirectory(prefix="chat-inspector-failure-") as temporary:
            provider = ReadFixture()
            demo = ChatDemo(FOUNDATION, Path(temporary), provider, client_factory=ReadableMemory)
            try:
                # A previously observed source must remain explicitly stale if
                # the optional post-answer inspector cannot refresh it.
                cached = "Fixture prior source excerpt.\n"
                demo.files = [{"path": "memory/preference.md", "text": cached,
                               "sha256": hashlib.sha256(cached.encode()).hexdigest()}]
                with patch.object(demo, "_snapshot", side_effect=RuntimeError("Fixture inspector read failed.")):
                    reply = demo.chat("Read my saved code name.")
                self.assertEqual(reply, "Protocol fixture: the code name is Nova.")
                self.assertEqual(demo.conversation["messages"][-1]["content"], reply)
                self.assertEqual(demo.turns[-1]["status"], "completed")
                self.assertFalse(demo.state()["memory"]["available"])
                self.assertTrue(demo.state()["memory"]["stale"])
                self.assertTrue(demo.state()["memory"]["error"])
                self.assertFalse(demo.state()["conversation"]["blocked"])
            finally:
                demo.close()

    def test_model_reply_is_visible_before_optional_source_inspection_finishes(self):
        inspecting, release = threading.Event(), threading.Event()
        result, failures = [], []

        class ReadableMemory:
            def __init__(self, _):
                pass

            def get(self, scope, path, **_):
                return {"status": "ok", "path": path, "text": "Fixture code name: Nova.\n"}

            def close(self):
                pass

        class ReadFixture(ReplyFixture):
            def complete(self, messages, tools):
                self.requests += 1
                if messages[-1]["role"] == "user":
                    return self.call("memory_get", path="memory/preference.md"), {"fixture": True}
                return {"role": "assistant", "content": "Protocol fixture: the code name is Nova."}, {"fixture": True}

        with tempfile.TemporaryDirectory(prefix="chat-delayed-inspector-") as temporary:
            demo = ChatDemo(FOUNDATION, Path(temporary), ReadFixture(), client_factory=ReadableMemory)
            original_snapshot = demo._snapshot

            def delayed_snapshot():
                inspecting.set()
                if not release.wait(5):
                    raise AssertionError("The fixture inspector was not released.")
                return original_snapshot()

            def chat():
                try:
                    result.append(demo.chat("Read my saved code name."))
                except Exception as error:
                    failures.append(error)

            worker = threading.Thread(target=chat, daemon=True)
            try:
                with patch.object(demo, "_snapshot", side_effect=delayed_snapshot):
                    worker.start()
                    self.assertTrue(inspecting.wait(2))
                    self.assertTrue(worker.is_alive())
                    started = time.monotonic()
                    state = demo.state()
                    self.assertLess(time.monotonic() - started, 1)
                    self.assertEqual(state["conversation"]["messages"][-1]["role"], "assistant")
                    self.assertEqual(state["conversation"]["messages"][-1]["content"], "Protocol fixture: the code name is Nova.")
                    self.assertEqual(demo.turns[-1]["status"], "completed")
                    self.assertEqual(result, [])
                    release.set()
                    worker.join(timeout=5)
                self.assertFalse(worker.is_alive())
                self.assertEqual(failures, [])
                self.assertEqual(result, ["Protocol fixture: the code name is Nova."])
            finally:
                release.set()
                worker.join(timeout=5)
                demo.close()

    def test_provider_failure_is_recoverable_without_implicitly_replaying_the_failed_prompt(self):
        class FailOnceFixture(ReplyFixture):
            def complete(self, messages, tools):
                self.requests += 1
                self.inputs.append(deepcopy(messages))
                if self.requests == 1:
                    raise RuntimeError("Fixture provider timed out.")
                return {"role": "assistant", "content": "Protocol fixture: next explicit message answered."}, {"fixture": True}

        def no_memory(_):
            raise AssertionError("Ordinary chat does not need a memory process.")

        with tempfile.TemporaryDirectory(prefix="chat-provider-recovery-") as temporary:
            provider = FailOnceFixture()
            demo = ChatDemo(FOUNDATION, Path(temporary), provider, client_factory=no_memory)
            try:
                with self.assertRaisesRegex(RuntimeError, "timed out"):
                    demo.chat("This failed prompt must not be retried automatically.")
                self.assertEqual(provider.requests, 1)
                self.assertFalse(demo.state()["conversation"]["blocked"])
                self.assertEqual([m["role"] for m in demo.conversation["modelMessages"]], ["system"])
                reply = demo.chat("This is a different, explicit next message.")
                self.assertIn("answered", reply)
                self.assertEqual(provider.requests, 2)
                self.assertEqual([m["role"] for m in provider.inputs[-1]], ["system", "user"])
                self.assertNotIn("failed prompt", json.dumps(provider.inputs[-1]))
                self.assertEqual([t["status"] for t in demo.turns], ["failed", "completed"])
                self.assertEqual([m["role"] for m in demo.conversation["messages"]], ["user", "user", "assistant"])
            finally:
                demo.close()


class AsyncHTTPChat(unittest.TestCase):
    def test_export_rejects_a_busy_operation_lock_without_waiting(self):
        entered, release = threading.Event(), threading.Event()

        with tempfile.TemporaryDirectory(prefix="chat-export-contention-") as temporary:
            provider = ReplyFixture()
            demo = ChatDemo(FOUNDATION, Path(temporary), provider,
                            client_factory=lambda _: self.fail("Export must not start memory."))

            def hold_operation():
                with demo._lock:
                    entered.set()
                    release.wait(5)

            worker = threading.Thread(target=hold_operation, daemon=True)
            try:
                with running_server(demo) as server:
                    worker.start()
                    self.assertTrue(entered.wait(1))
                    self.assertFalse(demo.state()["busy"])
                    started = time.monotonic()
                    code, payload = request(server, "GET", "/api/export", timeout=1)
                    self.assertEqual(code, 409)
                    self.assertLess(time.monotonic() - started, 1)
                    self.assertIn("finish before exporting", payload["error"])
                    self.assertEqual(provider.requests, 0)
                    release.set()
                    worker.join(timeout=5)
                    self.assertEqual(request(server, "GET", "/api/export")[0], 200)
            finally:
                release.set()
                worker.join(timeout=5)
                demo.close()

    def test_pending_model_request_does_not_block_state_and_can_be_cancelled(self):
        entered, release = threading.Event(), threading.Event()
        writes = []

        class DelayedFixture(ReplyFixture):
            def complete(self, messages, tools):
                self.requests += 1
                entered.set()
                if self.requests == 1:
                    assert release.wait(5), "The HTTP test did not release its pending response."
                    return self.call("memory_save", text="This must not be written after cancellation."), {"fixture": True}
                return {"role": "assistant", "content": "Protocol fixture: recovered explicit chat."}, {"fixture": True}

        def forbidden_memory(_):
            writes.append("constructed")
            raise AssertionError("Cancelled model results must not start memory tools.")

        with tempfile.TemporaryDirectory(prefix="chat-async-http-") as temporary:
            provider = DelayedFixture()
            demo = ChatDemo(FOUNDATION, Path(temporary), provider, client_factory=forbidden_memory)
            try:
                with running_server(demo) as server:
                    started = time.monotonic()
                    code, accepted = request(server, "POST", "/api/chat", {"message": "Wait for this controlled provider."})
                    self.assertEqual(code, 202)
                    self.assertLess(time.monotonic() - started, 1)
                    self.assertTrue(entered.wait(1))
                    job_id = accepted["job"]["id"]
                    started = time.monotonic()
                    code, current = request(server, "GET", "/api/state", timeout=1)
                    self.assertEqual(code, 200)
                    self.assertLess(time.monotonic() - started, 1)
                    self.assertTrue(current["busy"])
                    self.assertEqual(current["job"]["id"], job_id)
                    self.assertEqual(request(server, "POST", "/api/conversations", {})[0], 409)
                    started = time.monotonic()
                    self.assertEqual(request(server, "GET", "/api/export", timeout=1)[0], 409)
                    self.assertLess(time.monotonic() - started, 1)

                    started = time.monotonic()
                    code, cancelling = request(server, "POST", "/api/cancel", {})
                    self.assertIn(code, [200, 202])
                    self.assertLess(time.monotonic() - started, 1)
                    self.assertIn(cancelling["job"]["status"], ["cancelling", "cancelled"])
                    release.set()
                    deadline = time.monotonic() + 5
                    while time.monotonic() < deadline:
                        _, final = request(server, "GET", "/api/state")
                        if not final["busy"]:
                            break
                        time.sleep(0.02)
                    self.assertFalse(final["busy"])
                    self.assertIn(final["job"]["status"], ["cancelled", "failed"])
                    self.assertEqual(provider.requests, 1)
                    self.assertEqual(writes, [])
                    self.assertFalse(any(m["role"] == "assistant" for m in final["conversation"]["messages"]))
                    self.assertEqual(request(server, "POST", "/api/conversations", {})[0], 200)
            finally:
                release.set()
                demo.close()


class ReplayEvidence(unittest.TestCase):
    def test_selecting_a_failed_source_snapshot_keeps_its_excerpt_explicitly_stale(self):
        verified_source = {"path": "memory/preference.md", "text": "Fixture verified excerpt."}
        stale_source = {"path": "memory/preference.md", "text": "Fixture older cached excerpt."}
        capture = {
            "schemaVersion": 1, "kind": "memory-chat-capture", "evidenceKind": "protocol-fixture",
            "state": {"model": {"ready": False}, "conversation": {"id": "verified", "messages": []},
                      "memory": {"files": [verified_source], "available": True, "stale": False,
                                 "error": None, "revision": "fixture-original"}, "events": [], "changes": []},
            "conversations": [{"id": "verified", "messages": []}, {"id": "failed", "messages": []}],
            "turns": [
                {"conversationId": "verified", "status": "completed", "snapshotVerified": True,
                 "after": [verified_source]},
                {"conversationId": "failed", "status": "completed", "snapshotVerified": False,
                 "snapshotError": "Fixture source refresh failed.", "after": [stale_source]},
            ],
        }
        with tempfile.TemporaryDirectory(prefix="chat-replay-stale-") as temporary:
            path = Path(temporary) / "capture.json"
            save_json(path, capture)
            with patch("openclaw_memory_bridge.MemoryClient", side_effect=AssertionError("Replay must not start memory.")):
                demo = ReplayDemo(path)
                try:
                    demo.select_conversation("failed")
                    failed = demo.state()["memory"]
                    self.assertEqual(failed["files"], [stale_source])
                    self.assertFalse(failed["available"])
                    self.assertTrue(failed["stale"])
                    self.assertEqual(failed["error"], "Fixture source refresh failed.")
                    demo.select_conversation("verified")
                    verified = demo.state()["memory"]
                    self.assertEqual(verified["files"], [verified_source])
                    self.assertTrue(verified["available"])
                    self.assertFalse(verified["stale"])
                    self.assertIsNone(verified["error"])
                    self.assertNotEqual(failed["revision"], verified["revision"])
                    self.assertEqual(demo.export(), capture)
                finally:
                    demo.close()

"""Native-chat host contract regressions using labelled public-SDK fixtures.

These checks make no provider request and do not establish native model recall.
The fixture only lets the host's ordering, persistence claims and HTTP behavior
be inspected independently of the genuine native acceptance run.
"""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
import http.client
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from server import NativeChatDemo, ReplayDemo, create_server, save_json


FOUNDATION = Path(__file__).resolve().parents[2]
PRIVATE_REASONING = "NATIVE_FIXTURE_PRIVATE_REASONING_MUST_NOT_BE_EXPORTED"


class RetainedProviderFixture:
    evidence_kind = "protocol-fixture"
    ready = True

    def status(self):
        return {"ready": True, "reason": None}

    def state(self):
        return {"limitUsd": 1, "reservedUsd": 0.5, "remainingUsd": 0.5, "requests": 7}

    def complete(self, *args, **kwargs):
        raise AssertionError("The native host must not start an independent model/tool loop.")


class BrokerFixture:
    base_url = "http://127.0.0.1:19001/fixture-native-provider/v1"

    def __init__(self, provider, *, allow_request=None, on_completion=None):
        self.provider = provider
        self.allow_request = allow_request
        self.on_completion = on_completion
        self.windows = 0
        self.closed = False

    def start(self):
        return self

    @contextmanager
    def turn(self):
        self.windows += 1
        yield self

    def close(self):
        self.closed = True


class PublicNativeFixture:
    """Controlled SDK protocol peer, not a fake implementation of OpenClaw."""

    def __init__(self):
        self.clients = []
        self.operations = []
        self.transcripts = {}
        self.index_error = None
        self.chat_error = None
        self.entered = None
        self.release = None
        self.runs = {}

    def client(self, config):
        owner = self

        class Client:
            poisoned = False

            def __init__(self):
                self.config = config
                self.closed = False

            def configure_chat(self, scope, *, model_url):
                owner.operations.append(("configure_chat", scope, model_url))
                return {"configured": True, "mode": "native-chat"}

            def start_chat(self, scope, message):
                owner.operations.append(("chat", scope, message))
                if owner.chat_error:
                    raise RuntimeError(owner.chat_error)
                run_id = "fixture-run-" + str(len(owner.operations))
                messages = owner.transcripts.setdefault(scope.session, [])
                messages.append({"role": "user", "content": [{"type": "text", "text": message}]})
                owner.runs[run_id] = {"scope": scope, "completed": False, "aborted": False}
                return {"runId": run_id}

            def wait_chat(self, scope, run_id):
                owner.operations.append(("wait_chat", scope, run_id))
                run = owner.runs[run_id]
                assert run["scope"] == scope
                assert not run["aborted"], "An aborted run must not be polled again."
                if owner.entered is not None:
                    owner.entered.set()
                    if not owner.release.wait(0.02):
                        return {"completion": {"status": "pending"}}
                messages = owner.transcripts[scope.session]
                reply = "Protocol fixture native reply: conversation received."
                if not run["completed"]:
                    messages.append({"role": "assistant", "content": [
                        {"type": "thinking", "thinking": PRIVATE_REASONING},
                        {"type": "text", "text": reply},
                    ]})
                    run["completed"] = True
                session_id = "fixture-" + scope.session
                return {
                    "completion": {"status": "ok"},
                    "history": {"sessionKey": "agent:main:explicit:" + scope.session,
                                "sessionId": session_id, "messages": deepcopy(messages)},
                    "state": {"session": {"sessionId": session_id}},
                }

            def abort_chat(self, scope, run_id):
                owner.operations.append(("abort_chat", scope, run_id))
                run = owner.runs[run_id]
                assert run["scope"] == scope
                run["aborted"] = True
                return {"aborted": True}

            def chat(self, *args):
                raise AssertionError("The responsive host must use start/wait/abort, not blocking chat.")

            def index(self, scope):
                owner.operations.append(("index", scope))
                if owner.index_error:
                    raise RuntimeError(owner.index_error)
                return {"indexed": True, "fixture": True}

            def get(self, scope, path, **kwargs):
                owner.operations.append(("get", scope, path))
                return {"status": "not_found", "path": path}

            def restart(self, scope):
                owner.operations.append(("restart", scope))
                return {"restarted": True, "runtime": "Protocol fixture, not a native engine run"}

            def close(self):
                self.closed = True
                owner.operations.append(("close",))

        result = Client()
        self.clients.append(result)
        return result


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
        data = json.dumps(body) if body is not None else None
        headers = {"Content-Type": "application/json"} if body is not None else {}
        connection.request(method, path, data, headers)
        response = connection.getresponse()
        return response.status, json.loads(response.read())
    finally:
        connection.close()


class NativeChatHostTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="native-chat-host-fixture-")
        self.native = PublicNativeFixture()
        self.provider = RetainedProviderFixture()
        self.demo = NativeChatDemo(FOUNDATION, Path(self.temporary.name), self.provider,
                                   client_factory=self.native.client, broker_factory=BrokerFixture)

    def tearDown(self):
        self.demo.close()
        self.temporary.cleanup()

    def test_opening_page_does_not_create_native_session_or_spend_allowance(self):
        before = self.provider.state()
        self.assertEqual(self.native.clients, [])
        self.assertEqual(self.native.operations, [])
        state = self.demo.state()
        self.assertEqual(state["conversation"]["messages"], [])
        self.assertEqual(state["memory"]["lifecycle"]["mode"], "native-chat")
        self.assertFalse(state["memory"]["lifecycle"]["transcriptPersisted"])
        self.assertEqual(self.provider.state(), before)

    def test_legacy_chat_opens_fresh_context_without_fabricating_native_history(self):
        root = Path(self.temporary.name)
        old_id = self.demo.current
        self.demo.close()
        path = root / "app-state.json"
        record = json.loads(path.read_text())
        old_messages = [{"id": "fixture-old-user", "role": "user", "content": "Earlier independent-host conversation."},
                        {"id": "fixture-old-assistant", "role": "assistant", "content": "Earlier fixture reply."}]
        old = next(c for c in record["conversations"] if c["id"] == old_id)
        old["messages"] = deepcopy(old_messages)
        save_json(path, record)
        budget = self.provider.state()
        self.demo = NativeChatDemo(FOUNDATION, root, self.provider,
                                   client_factory=self.native.client, broker_factory=BrokerFixture)
        self.assertNotEqual(self.demo.current, old_id)
        self.assertEqual(self.demo.state()["conversation"]["messages"], [])
        self.assertEqual(self.native.clients, [])
        self.assertEqual(self.native.operations, [])
        self.assertEqual(next(c for c in self.demo.conversations if c["id"] == old_id)["messages"], old_messages)
        self.demo.select_conversation(old_id)
        self.assertTrue(self.demo.state()["conversation"]["readOnly"])
        with self.assertRaisesRegex(ValueError, "read-only"):
            self.demo.chat("Continue this historical conversation.")
        self.assertEqual(self.native.operations, [])
        self.demo.new_conversation()
        self.assertFalse(self.demo.state()["conversation"]["readOnly"])
        self.assertEqual(self.provider.state(), budget)

    def test_natural_fact_goes_unchanged_to_native_chat_and_next_turn_uses_same_session(self):
        first = "I take my coffee without sugar."
        second = "How do I take my coffee?"
        self.demo.chat(first)
        first_scope = self.demo.scope
        self.demo.chat(second)
        calls = [op for op in self.native.operations if op[0] == "chat"]
        self.assertEqual([op[2] for op in calls], [first, second])
        self.assertEqual([op[1] for op in calls], [first_scope, first_scope])
        self.assertEqual([m["content"][0]["text"] for m in self.native.transcripts[first_scope.session]
                          if m["role"] == "user"], [first, second])
        self.assertEqual(len(self.native.clients), 1)
        self.assertTrue(self.demo.state()["memory"]["lifecycle"]["transcriptPersisted"])

    def test_new_context_waits_for_index_barrier_and_keeps_native_corpus(self):
        self.demo.chat("I take my coffee without sugar.")
        old_scope = self.demo.scope
        root = self.native.clients[0].config.root
        self.demo.new_conversation()
        self.assertNotEqual(self.demo.scope.session, old_scope.session)
        self.assertEqual(self.demo.scope.routing_workspace, old_scope.routing_workspace)
        self.assertEqual(self.demo.conversation["messages"], [])
        self.assertTrue(any(op[0] == "index" and op[1] == old_scope for op in self.native.operations))
        self.demo.chat("How do I take my coffee?")
        self.assertEqual(self.native.clients[0].config.root, root)
        self.assertEqual(len(self.native.clients), 1)
        self.assertEqual(len(self.native.transcripts[self.demo.scope.session]), 2)
        self.assertEqual(len(self.native.transcripts[old_scope.session]), 2)

    def test_failed_index_does_not_silently_open_fresh_context(self):
        self.demo.chat("I take my coffee without sugar.")
        previous = self.demo.current
        count = len(self.demo.conversations)
        self.native.index_error = "Controlled native session indexing failed."
        with self.assertRaisesRegex(Exception, "index"):
            self.demo.new_conversation()
        self.assertEqual(self.demo.current, previous)
        self.assertEqual(len(self.demo.conversations), count)
        self.assertFalse(self.demo.state()["memory"]["lifecycle"]["indexed"])

    def test_source_inspection_failure_keeps_completed_native_answer(self):
        with patch.object(self.demo, "_snapshot", side_effect=RuntimeError("Controlled inspector failure.")):
            reply = self.demo.chat("I take my coffee without sugar.")
        state = self.demo.state()
        self.assertEqual(state["conversation"]["messages"][-1]["content"], reply)
        self.assertIn("Protocol fixture native reply", reply)
        self.assertEqual(self.demo.turns[-1]["status"], "completed")
        self.assertFalse(state["memory"]["available"])
        self.assertIn("inspector", state["memory"]["error"])

    def test_native_gateway_failure_is_visible_without_independent_chat_fallback(self):
        self.native.chat_error = "Controlled native Gateway connection failed."
        budget = self.provider.state()
        with self.assertRaisesRegex(RuntimeError, "Gateway connection failed"):
            self.demo.chat("I take my coffee without sugar.")
        state = self.demo.state()
        self.assertEqual([m["role"] for m in state["conversation"]["messages"]], ["user"])
        self.assertEqual(self.demo.turns[-1]["status"], "failed")
        self.assertIsNone(self.demo.turns[-1]["assistant"])
        self.assertIn("Gateway connection failed", state["memory"]["error"])
        self.assertFalse(state["memory"]["lifecycle"]["transcriptPersisted"])
        self.assertEqual(len([op for op in self.native.operations if op[0] == "chat"]), 1)
        self.assertEqual(self.provider.state(), budget)
        # An unacknowledged attempt might already have changed native history.
        # New chat must still execute the indexing barrier rather than treating
        # a missing success receipt as proof that there is nothing to save.
        self.assertTrue(state["memory"]["lifecycle"]["pendingIndex"])
        previous = self.demo.current
        self.native.index_error = "Controlled indexing after an unknown native attempt failed."
        with self.assertRaisesRegex(RuntimeError, "indexing"):
            self.demo.new_conversation()
        self.assertEqual(self.demo.current, previous)
        self.assertTrue(self.demo.state()["memory"]["lifecycle"]["pendingIndex"])

    def test_restart_indexes_before_closing_sdk_and_preserves_allowance(self):
        self.demo.chat("I take my coffee without sugar.")
        old_scope = self.demo.scope
        budget = self.provider.state()
        self.demo.restart_memory()
        names = [op[0] for op in self.native.operations]
        self.assertLess(names.index("index"), names.index("restart"))
        self.assertTrue(self.native.clients[0].closed)
        self.assertNotEqual(self.demo.scope.session, old_scope.session)
        self.assertEqual(self.demo.scope.routing_workspace, old_scope.routing_workspace)
        self.assertEqual(self.provider.state(), budget)

    def test_export_retains_visible_native_reply_but_omits_private_reasoning(self):
        self.demo.chat("I take my coffee without sugar.")
        capture = self.demo.export()
        serialized = json.dumps(capture)
        self.assertIn("Protocol fixture native reply", serialized)
        self.assertNotIn(PRIVATE_REASONING, serialized)
        self.assertEqual(capture["evidenceKind"], "protocol-fixture")

    def test_replay_uses_selected_conversation_indexing_state(self):
        self.demo.chat("I take my coffee without sugar.")
        first = self.demo.current
        self.demo.new_conversation()
        self.demo.chat("How do I take my coffee?")
        second = self.demo.current
        path = Path(self.temporary.name) / "fixture-replay.json"
        save_json(path, self.demo.export())
        operations = deepcopy(self.native.operations)
        replay = ReplayDemo(path)
        try:
            replay.select_conversation(first)
            state = replay.state()
            self.assertEqual(state["mode"], "replay")
            self.assertFalse(state["model"]["ready"])
            self.assertTrue(state["memory"]["lifecycle"]["transcriptPersisted"])
            self.assertTrue(state["memory"]["lifecycle"]["indexed"])
            self.assertFalse(state["memory"]["lifecycle"]["pendingIndex"])
            replay.select_conversation(second)
            state = replay.state()
            self.assertTrue(state["memory"]["lifecycle"]["transcriptPersisted"])
            self.assertFalse(state["memory"]["lifecycle"]["indexed"])
            self.assertTrue(state["memory"]["lifecycle"]["pendingIndex"])
            replay.select_conversation(first)
            self.assertTrue(replay.state()["memory"]["lifecycle"]["indexed"])
            self.assertEqual(self.native.operations, operations)
        finally:
            replay.close()

    def test_pending_native_turn_keeps_state_responsive_and_rejects_overlapping_message(self):
        self.native.entered, self.native.release = threading.Event(), threading.Event()
        try:
            with running_server(self.demo) as server:
                code, state = request(server, "POST", "/api/chat", {"message": "I take my coffee without sugar."})
                self.assertEqual(code, 202)
                self.assertTrue(self.native.entered.wait(1))
                started = time.monotonic()
                code, state = request(server, "GET", "/api/state", timeout=1)
                self.assertEqual(code, 200)
                self.assertLess(time.monotonic() - started, 1)
                self.assertTrue(state["busy"])
                code, _ = request(server, "POST", "/api/chat", {"message": "How do I take my coffee?"})
                self.assertEqual(code, 409)
                self.assertEqual(len([op for op in self.native.operations if op[0] == "chat"]), 1)
                self.native.release.set()
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    _, state = request(server, "GET", "/api/state")
                    if not state["busy"]:
                        break
                    time.sleep(0.01)
                self.assertFalse(state["busy"])
                self.assertEqual(state["job"]["status"], "completed")
                self.assertEqual([m["role"] for m in state["conversation"]["messages"]], ["user", "assistant"])
        finally:
            self.native.release.set()

    def test_stop_aborts_exact_native_run_without_another_model_dispatch(self):
        self.native.entered, self.native.release = threading.Event(), threading.Event()
        budget = self.provider.state()
        try:
            with running_server(self.demo) as server:
                code, _ = request(server, "POST", "/api/chat", {"message": "I take my coffee without sugar."})
                self.assertEqual(code, 202)
                self.assertTrue(self.native.entered.wait(1))
                self.assertEqual(len(self.native.runs), 1)
                run_id, run = next(iter(self.native.runs.items()))
                code, _ = request(server, "POST", "/api/cancel", {})
                self.assertEqual(code, 200)
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline:
                    _, state = request(server, "GET", "/api/state")
                    if not state["busy"]:
                        break
                    time.sleep(0.01)
                self.assertFalse(state["busy"])
                self.assertEqual(state["job"]["status"], "cancelled")
                aborted = [op for op in self.native.operations if op[0] == "abort_chat"]
                self.assertEqual(aborted, [("abort_chat", run["scope"], run_id)])
                self.assertTrue(run["aborted"])
                self.assertFalse(run["completed"])
                self.assertEqual(len([op for op in self.native.operations if op[0] == "chat"]), 1)
                self.assertEqual([m["role"] for m in state["conversation"]["messages"]], ["user"])
                self.assertFalse(state["conversation"]["blocked"])
                self.assertTrue(state["memory"]["lifecycle"]["pendingIndex"])
                self.assertEqual(self.provider.state(), budget)
                with self.assertRaises(RuntimeError):
                    self.demo.broker.allow_request()
        finally:
            self.native.release.set()

    def test_activity_requires_correlated_call_and_completed_end_phase(self):
        turn = {"modelResponses": [{"message": {"tool_calls": [
            {"id": "fixture-write", "function": {"name": "write", "arguments": '{"path":"memory/preference.md"}'}},
            {"id": "fixture-search", "function": {"name": "memory_search", "arguments": '{"query":"coffee"}'}},
        ]}}], "attemptedWritePaths": []}
        history = {"activity": [{"items": [
            {"kind": "tool", "toolCallId": "fixture-write", "name": "write", "phase": "end", "status": "completed"},
            {"kind": "tool", "toolCallId": "fixture-search", "name": "memory_search", "phase": "start", "status": "completed"},
            {"kind": "tool", "toolCallId": "unrelated-call", "name": "write", "phase": "end", "status": "completed"},
        ]}]}
        self.demo._native_activity(history, turn)
        tools = [event for event in self.demo.events if event["kind"] == "tool"]
        self.assertEqual([(event["label"], event["status"]) for event in tools],
                         [("write", "completed"), ("memory_search", "unknown")])
        self.assertEqual(turn["attemptedWritePaths"], ["memory/preference.md"])


if __name__ == "__main__":
    unittest.main()

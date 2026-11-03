"""Real installed-SDK acceptance with an explicitly labelled model protocol fixture.

The fixture chooses tool calls; OpenClaw performs the actual writes, indexing,
source reads, search and persistence. No genuine model/provider request is made.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import http.client
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from openclaw_memory_bridge import MemoryClient

from server import ChatDemo, ReplayDemo, create_server, save_json


FOUNDATION = Path(os.environ.get("FOUNDATION_ROOT", Path(__file__).resolve().parents[2]))


class ProtocolFixtureProvider:
    """Model wire fixture only. All tool results come from the actual SDK."""

    evidence_kind = "protocol-fixture"
    ready = True

    def __init__(self):
        self.requests = 0
        self.turn_inputs = []

    def state(self):
        return {"limitUsd": 0, "reservedUsd": 0, "remainingUsd": 0, "requests": self.requests}

    def _call(self, name, **arguments):
        return {"role": "assistant", "content": None, "tool_calls": [{
            "id": f"fixture-{self.requests}", "type": "function",
            "function": {"name": name, "arguments": json.dumps(arguments, ensure_ascii=False)},
        }]}

    def complete(self, messages, tools):
        self.requests += 1
        assert {t["function"]["name"] for t in tools} >= {"memory_save", "memory_search", "memory_get"}
        user = next(m["content"] for m in reversed(messages) if m["role"] == "user")
        updating = "Nova olarak değiştir" in user
        recalling = "Hafızada ara" in user
        if messages[-1]["role"] == "user":
            self.turn_inputs.append(deepcopy(messages))
            if recalling:
                result = self._call("memory_search", query="Nova")
            elif updating:
                result = self._call("memory_get", path="memory/preference.md")
            else:
                result = self._call("memory_save", text="# Demo project\nKod adı: Atlas\nTeslim günü: cuma.\n")
        else:
            previous = next(m for m in reversed(messages) if m["role"] == "assistant")
            tool = previous["tool_calls"][0]["function"]["name"]
            observed = json.loads(messages[-1]["content"])
            if observed.get("ok") is False:
                raise AssertionError(f"The actual SDK tool failed: {observed}")
            if tool == "memory_search":
                hit = next(h for h in observed["results"] if h["path"] == "memory/preference.md")
                result = self._call("memory_get", path=hit["path"])
            elif tool == "memory_get" and updating:
                self.assert_source(observed, "Atlas", "cuma")
                result = self._call("memory_save", text=observed["text"].replace("Atlas", "Nova"))
            elif tool == "memory_get":
                self.assert_source(observed, "Nova", "cuma")
                result = {"role": "assistant", "content": "Kod adı Nova; teslim günü cuma. Kaynak: memory/preference.md"}
            elif tool == "memory_save":
                assert observed["path"] == "memory/preference.md" and "index" in observed
                result = {"role": "assistant", "content": "Protocol fixture: actual SDK write/index receipt observed."}
            else:
                raise AssertionError(f"Unexpected fixture tool: {tool}")
        return result, {"fixture": True, "genuineModel": False}

    @staticmethod
    def assert_source(source, *terms):
        assert source["status"] == "ok", source
        assert all(term in source["text"] for term in terms), source


class NativeDemoAcceptance(unittest.TestCase):
    def test_actual_sdk_guided_flow_restart_reopen_and_recorded_replay(self):
        """One real corpus; generated-model behavior is explicitly not claimed."""
        provider = ProtocolFixtureProvider()
        clients = []

        def installed_client(config):
            client = MemoryClient(config)
            clients.append(client)
            return client

        with tempfile.TemporaryDirectory(prefix=".lab-test-memory-chat-integration-", dir=FOUNDATION) as temporary:
            root = Path(temporary)
            demo = ChatDemo(FOUNDATION, root, provider, client_factory=installed_client)
            try:
                first_id = demo.current
                corpus = demo.scope.routing_workspace
                self.assertEqual(demo.state()["memory"]["files"], [])
                self.assertEqual(len(demo.conversation["modelMessages"]), 1)

                demo.tour_next()
                first = deepcopy(demo.state())
                self.assertEqual(first["tour"]["step"], 1)
                source = first["memory"]["files"][0]
                self.assertEqual(source["path"], "memory/preference.md")
                self.assertIn("Atlas", source["text"])
                self.assertIn("cuma", source["text"])
                self.assertEqual(source["sha256"], hashlib.sha256(source["text"].encode()).hexdigest())
                self.assertIsNone(first["changes"][0]["before"])
                self.assertEqual(first["changes"][0]["after"], source["text"])

                demo.tour_next()
                updated = deepcopy(demo.state())
                self.assertEqual(updated["tour"]["step"], 2)
                self.assertIn("Nova", updated["memory"]["files"][0]["text"])
                self.assertNotIn("Atlas", updated["memory"]["files"][0]["text"])
                self.assertIn("cuma", updated["memory"]["files"][0]["text"])
                self.assertEqual(updated["changes"][0]["before"], source["text"])
                self.assertEqual(updated["changes"][0]["removed"], 1)
                self.assertEqual(updated["changes"][0]["added"], 1)
                expected_text = updated["memory"]["files"][0]["text"]

                demo.tour_next()
                self.assertNotEqual(first_id, demo.current)
                self.assertEqual(demo.scope.routing_workspace, corpus)
                self.assertEqual([m["role"] for m in provider.turn_inputs[-1]], ["system", "user"])
                self.assertEqual(len(demo.conversation["messages"]), 2)
                self.assertIn("Nova", demo.conversation["messages"][-1]["content"])
                self.assertEqual({event["label"] for event in demo.events if event["kind"] == "tool"}, {"memory_search", "memory_get"})

                before_restart_id = demo.current
                demo.tour_next()
                self.assertEqual(len(clients), 2)
                self.assertIsNotNone(clients[0].process.poll())
                self.assertNotEqual(before_restart_id, demo.current)
                self.assertEqual(demo.scope.routing_workspace, corpus)
                self.assertEqual([m["role"] for m in provider.turn_inputs[-1]], ["system", "user"])
                self.assertEqual(demo.state()["memory"]["files"][0]["text"], expected_text)
                self.assertIn("Nova", demo.conversation["messages"][-1]["content"])

                requests_before_export = provider.requests
                demo.tour_next()
                self.assertTrue(demo.state()["tour"]["done"])
                self.assertEqual(provider.requests, requests_before_export)
                capture = demo.export()
                self.assertEqual(capture["evidenceKind"], "protocol-fixture")
                self.assertEqual(len(capture["turns"]), 4)
                self.assertTrue(all(turn["status"] == "completed" for turn in capture["turns"]))
                self.assertNotIn("modelMessages", capture["conversations"][0])
                capture_path = root / "fixture-capture.json"
                save_json(capture_path, capture)
            finally:
                demo.close()
            self.assertFalse((root / "chat.lock").exists())

            resumed = ChatDemo(FOUNDATION, root, provider, client_factory=installed_client)
            try:
                self.assertEqual(resumed.state()["memory"]["files"][0]["text"], expected_text)
                self.assertEqual(provider.requests, requests_before_export)
                self.assertTrue(resumed.state()["tour"]["done"])
                self.assertEqual(resumed.scope.routing_workspace, corpus)
            finally:
                resumed.close()

            with patch("openclaw_memory_bridge.MemoryClient", side_effect=AssertionError("Replay must not construct the SDK")):
                replay = ReplayDemo(capture_path)
                self.assertEqual(replay.state()["mode"], "replay")
                self.assertFalse(replay.state()["model"]["ready"])
                self.assertEqual(replay.state()["memory"]["files"][0]["text"], expected_text)
                replay.select_conversation(first_id)
                self.assertEqual(len(replay.state()["conversation"]["messages"]), 4)
                self.assertEqual(replay.export(), capture)
                replay.close()
            self.assertEqual(provider.requests, requests_before_export)


def replay_capture():
    return {"schemaVersion": 1, "kind": "memory-chat-capture", "evidenceKind": "protocol-fixture",
            "state": {"mode": "live", "model": {"name": "protocol-fixture", "ready": False},
                      "conversation": {"id": "c-first", "messages": []},
                      "conversations": [{"id": "c-first", "title": "Fixture", "updatedAt": "2026-01-01"}],
                      "memory": {"files": [], "revision": "fixture"}, "changes": [], "events": [],
                      "budget": {"limitUsd": 0, "reservedUsd": 0, "remainingUsd": 0, "requests": 0},
                      "busy": False, "tour": {"step": 0, "total": 5, "label": "Fixture", "done": False}},
            "conversations": [{"id": "c-first", "messages": []}], "turns": []}


class DemoHTTPBoundary(unittest.TestCase):
    def test_same_origin_static_api_and_read_only_export(self):
        with tempfile.TemporaryDirectory(prefix="memory-chat-http-") as temporary:
            capture = replay_capture()
            path = Path(temporary) / "capture.json"
            save_json(path, capture)
            replay = ReplayDemo(path)
            server = create_server(replay, port=0)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()

            def request(method, path, body=None, headers=None):
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=10)
                try:
                    connection.request(method, path, body=body, headers=headers or {})
                    response = connection.getresponse()
                    return response.status, dict(response.getheaders()), response.read()
                finally:
                    connection.close()

            try:
                with patch.dict(os.environ, {"OPENROUTER_API_KEY": "fixture-secret-must-not-be-exposed"}):
                    status, headers, page = request("GET", "/")
                    self.assertEqual(status, 200)
                    self.assertIn("text/html", headers["Content-Type"])
                    self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
                    self.assertIn(b"/static/app.js", page)
                    for asset, mime in [("/static/app.js", "javascript"), ("/static/app.css", "css")]:
                        status, headers, content = request("GET", asset)
                        self.assertEqual(status, 200)
                        self.assertIn(mime, headers["Content-Type"])
                        self.assertTrue(content)
                    status, _, body = request("GET", "/api/state")
                    self.assertEqual(status, 200)
                    self.assertEqual(json.loads(body)["mode"], "replay")
                    self.assertNotIn(b"fixture-secret-must-not-be-exposed", body)
                self.assertEqual(request("GET", "/api/state", headers={"Host": "attacker.invalid"})[0], 403)
                self.assertEqual(request("POST", "/api/chat", b"{}", {"Content-Type": "application/json", "Origin": "http://attacker.invalid"})[0], 403)
                self.assertEqual(request("POST", "/api/chat", b"not-json", {"Content-Type": "application/json"})[0], 400)
                self.assertEqual(request("POST", "/api/chat", b'{"message":"hello"}', {"Content-Type": "application/json"})[0], 409)
                self.assertEqual(request("GET", "/static/../../provider.py")[0], 404)
                status, headers, body = request("GET", "/api/export")
                self.assertEqual(status, 200)
                self.assertIn("attachment", headers["Content-Disposition"])
                self.assertEqual(json.loads(body), capture)
                self.assertEqual(replay.export(), capture)
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=5)


class FailureVisibility(unittest.TestCase):
    def test_read_only_discovery_is_not_a_creation_and_preserves_literal_source_text(self):
        with tempfile.TemporaryDirectory(prefix="memory-chat-read-discovery-") as temporary:
            root = Path(temporary)
            path = "memory/existing.md"
            text = f"Existing source literally names {root} and {FOUNDATION}.\n"

            class ReadOnlyMemory:
                def __init__(self, _):
                    pass

                def search(self, scope, query):
                    return {"results": [{"path": path, "startLine": 1, "endLine": 1, "snippet": text}]}

                def get(self, scope, requested, **_):
                    return {"status": "ok", "path": path, "text": text} if requested == path else {"status": "not_found", "path": requested}

                def write(self, *_):
                    raise AssertionError("This is a read-only discovery.")

                def index(self, *_):
                    raise AssertionError("A read must not cause a write/index operation.")

                def close(self):
                    pass

            class ReadFixture(ProtocolFixtureProvider):
                def complete(self, messages, tools):
                    self.requests += 1
                    if messages[-1]["role"] == "user":
                        return self._call("memory_search", query="existing"), {"fixture": True}
                    previous = next(m for m in reversed(messages) if m["role"] == "assistant")
                    if previous["tool_calls"][0]["function"]["name"] == "memory_search":
                        return self._call("memory_get", path=path), {"fixture": True}
                    return {"role": "assistant", "content": "Protocol fixture: existing source read.",
                            "reasoning": "fixture-provider-internal", "reasoning_details": [{"text": "fixture-internal-details"}]}, {"fixture": True}

            demo = ChatDemo(FOUNDATION, root, ReadFixture(), client_factory=ReadOnlyMemory)
            try:
                demo.chat("Read an existing source; do not save anything.")
                self.assertEqual(demo.turns[-1]["before"], [])
                self.assertEqual(demo.turns[-1]["attemptedWritePaths"], [])
                self.assertEqual(demo.changes, [])
                observed = demo.state()["memory"]["files"][0]
                self.assertEqual(observed["text"], text)
                self.assertEqual(observed["sha256"], hashlib.sha256(text.encode()).hexdigest())
                capture = demo.export()
                self.assertEqual(capture["state"]["memory"]["files"][0]["text"], text)
                self.assertEqual(capture["turns"][-1]["after"][0]["text"], text)
                self.assertNotIn("fixture-provider-internal", json.dumps(capture))
                self.assertNotIn("fixture-internal-details", json.dumps(capture))
                self.assertEqual(demo.conversation["modelMessages"][-1]["reasoning"], "fixture-provider-internal")
            finally:
                demo.close()

    def test_first_update_baselines_an_existing_unobserved_preference(self):
        with tempfile.TemporaryDirectory(prefix="memory-chat-existing-baseline-") as temporary:
            root = Path(temporary)
            original = f"Kod adı: Atlas\nTeslim günü: cuma.\nLiteral source path: {root}\n"
            saved = {"memory/preference.md": original}

            class ExistingPreference:
                def __init__(self, _):
                    pass

                def get(self, scope, path, **_):
                    return {"status": "ok", "path": path, "text": saved[path]} if path in saved else {"status": "not_found", "path": path}

                def write(self, scope, note_id, text):
                    path = f"memory/{note_id}.md"
                    saved[path] = text
                    return {"path": path, "needsIndex": True}

                def index(self, scope):
                    return {"fixture": True, "indexed": True}

                def close(self):
                    pass

            demo = ChatDemo(FOUNDATION, root, ProtocolFixtureProvider(), client_factory=ExistingPreference)
            try:
                self.assertEqual(demo.observed_paths, set())
                demo.chat("Demo projemin güncel kod adını Nova olarak değiştir.")
                self.assertEqual(demo.changes[0]["before"], original)
                self.assertEqual(demo.changes[0]["after"], original.replace("Atlas", "Nova"))
                self.assertEqual(demo.changes[0]["removed"], 1)
                self.assertEqual(demo.changes[0]["added"], 1)
                self.assertEqual(demo.turns[-1]["before"][0]["text"], original)
                current = demo.state()["memory"]["files"][0]
                self.assertEqual(current["text"], saved["memory/preference.md"])
                self.assertEqual(current["sha256"], hashlib.sha256(current["text"].encode()).hexdigest())
            finally:
                demo.close()

    def test_tour_rejects_a_persisted_write_when_indexing_failed(self):
        """The installed MemoryTools adapter writes then indexes; no fake green."""
        saved = {}
        operations = []

        class SavedButUnindexed:
            def __init__(self, _):
                pass

            def write(self, scope, note_id, text):
                operations.append("write")
                path = f"memory/{note_id}.md"
                saved[path] = text
                return {"path": path, "needsIndex": True}

            def index(self, scope):
                operations.append("index")
                raise RuntimeError("Fixture index failure after the source was saved.")

            def get(self, scope, path, **_):
                operations.append("get")
                if path not in saved:
                    return {"status": "not_found", "path": path}
                return {"status": "ok", "path": path, "text": saved[path]}

            def close(self):
                pass

        class IndexFailureFixture(ProtocolFixtureProvider):
            def complete(self, messages, tools):
                self.requests += 1
                if messages[-1]["role"] == "user":
                    return self._call("memory_save", text="Kod adı: Atlas\nTeslim günü: cuma.\n"), {"fixture": True}
                error_result = json.loads(messages[-1]["content"])
                assert error_result["ok"] is False
                return {"role": "assistant", "content": "Protocol fixture: the source was saved but indexing failed."}, {"fixture": True}

        with tempfile.TemporaryDirectory(prefix="memory-chat-index-failure-") as temporary:
            provider = IndexFailureFixture()
            demo = ChatDemo(FOUNDATION, Path(temporary), provider, client_factory=SavedButUnindexed)
            try:
                with self.assertRaisesRegex(RuntimeError, "indeksleme"):
                    demo.tour_next()
                self.assertEqual(demo.state()["tour"]["step"], 0)
                self.assertFalse(demo.state()["tour"]["done"])
                self.assertEqual(provider.requests, 2)
                self.assertEqual(operations.count("write"), 1)
                self.assertEqual(operations.count("index"), 1)
                failed = next(e for e in demo.events if e["label"] == "memory_save")
                self.assertEqual(failed["status"], "failed")
                self.assertIn("index failure", failed["detail"]["error"]["message"])
                self.assertFalse(any(e["kind"] == "tool" and e["status"] == "completed" for e in demo.events))
                actual = saved["memory/preference.md"]
                self.assertEqual(demo.state()["memory"]["files"][0]["text"], actual)
                self.assertEqual(demo.changes[0]["after"], actual)
                self.assertIsNone(demo.changes[0]["before"])
                self.assertIn("indexing failed", demo.turns[-1]["assistant"])
            finally:
                demo.close()

    def test_explicit_restart_closes_poisoned_transport_without_replaying_write(self):
        operations = []
        clients = []

        class ControlledClient:
            def __init__(self, _):
                self.number = len(clients)
                self.poisoned = self.number == 0
                self.closed = False
                self.restarts = 0
                clients.append(self)
                operations.append(("open", self.number))

            def restart(self, scope):
                if self.poisoned:
                    raise AssertionError("The poisoned stream must be closed before restart.")
                self.restarts += 1
                operations.append(("restart", self.number))
                return {"restarted": True}

            def write(self, *_):
                raise AssertionError("An uncertain write must never be replayed automatically.")

            def index(self, *_):
                raise AssertionError("Restart must not invent an index/write retry.")

            def close(self):
                self.closed = True
                operations.append(("close", self.number))

        with tempfile.TemporaryDirectory(prefix="memory-chat-poisoned-restart-") as temporary:
            provider = ProtocolFixtureProvider()
            demo = ChatDemo(FOUNDATION, Path(temporary), provider, client_factory=ControlledClient)
            try:
                original_id = demo.current
                demo.restart_memory()
                self.assertEqual(operations, [("open", 0), ("close", 0), ("open", 1),
                                              ("restart", 1), ("close", 1), ("open", 2)])
                self.assertEqual(len(clients), 3)
                self.assertTrue(clients[0].closed)
                self.assertEqual(clients[0].restarts, 0)
                self.assertEqual(provider.requests, 0)
                self.assertEqual(demo.turns, [])
                self.assertNotEqual(demo.current, original_id)
                self.assertEqual(demo.conversation["messages"], [])
                self.assertEqual(len(demo.conversation["modelMessages"]), 1)
                self.assertEqual(demo.events[0]["status"], "completed")
            finally:
                demo.close()

    def test_stop_after_a_model_response_prevents_tool_and_followup_dispatch(self):
        operations = []

        class NoFurtherMemoryWork:
            def __init__(self, _):
                pass

            def write(self, *_):
                operations.append("write")
                raise AssertionError("A tool must not execute after stop was requested.")

            def index(self, *_):
                operations.append("index")
                raise AssertionError("No index operation is allowed after stop.")

            def get(self, scope, path, **_):
                return {"status": "not_found", "path": path}

            def close(self):
                pass

        class StopFixture(ProtocolFixtureProvider):
            on_response = None

            def complete(self, *_):
                self.requests += 1
                assert self.on_response is not None
                self.on_response()
                return self._call("memory_save", text="This must not be written."), {"fixture": True}

        with tempfile.TemporaryDirectory(prefix="memory-chat-stop-dispatch-") as temporary:
            provider = StopFixture()
            demo = ChatDemo(FOUNDATION, Path(temporary), provider, client_factory=NoFurtherMemoryWork)
            try:
                provider.on_response = demo.request_stop
                with self.assertRaises(RuntimeError):
                    demo.chat("This controlled fixture requests stop after its first response.")
                self.assertEqual(provider.requests, 1)
                self.assertEqual(operations, [])
                self.assertEqual(demo.turns[-1]["status"], "failed")
                self.assertIsNone(demo.turns[-1]["assistant"])
                self.assertTrue(demo.conversation["blocked"])
                self.assertEqual([m["role"] for m in demo.conversation["messages"]], ["user"])
            finally:
                demo.close()

    def test_failed_provider_turn_is_preserved_without_invented_assistant(self):
        class NoMemoryWork:
            def __init__(self, _):
                pass

            def close(self):
                pass

            def get(self, scope, path, **_):
                return {"status": "not_found", "path": path}

        class FailedFixture(ProtocolFixtureProvider):
            def complete(self, *_):
                self.requests += 1
                raise RuntimeError("Fixture provider failure; no real model called.")

        with tempfile.TemporaryDirectory(prefix="memory-chat-failure-") as temporary:
            provider = FailedFixture()
            demo = ChatDemo(FOUNDATION, Path(temporary), provider, client_factory=NoMemoryWork)
            try:
                with self.assertRaisesRegex(RuntimeError, "Fixture provider failure"):
                    demo.chat("This fixture request fails.")
                self.assertEqual([m["role"] for m in demo.conversation["messages"]], ["user"])
                self.assertEqual(demo.turns[-1]["status"], "failed")
                self.assertTrue(demo.conversation["blocked"])
                self.assertIsNone(demo.turns[-1]["assistant"])
                self.assertEqual(provider.requests, 1)
                with self.assertRaisesRegex(ValueError, "yeni sohbet"):
                    demo.chat("Do not automatically replay the failed request.")
                self.assertEqual(provider.requests, 1)
                demo.new_conversation()
                self.assertEqual(len(demo.conversation["modelMessages"]), 1)
                self.assertEqual(demo.conversation["messages"], [])
                self.assertEqual(demo.turns[-1]["status"], "failed")
            finally:
                demo.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)

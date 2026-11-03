"""Native transport and retained-budget regressions; no paid provider calls."""
from __future__ import annotations

from copy import deepcopy
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

from native_provider import NativeProviderBroker
from provider import MODEL, Provider


class ProviderFixture:
    """Explicit protocol fixture, not genuine model evidence."""
    def __init__(self, response=None):
        self.calls = []
        self.error = None
        self.response = response or {"role": "assistant", "content": "Native transport protocol fixture."}

    def complete(self, messages, tools):
        Provider._validate_input(messages, tools)
        self.calls.append((deepcopy(messages), deepcopy(tools)))
        if self.error:
            raise self.error
        return deepcopy(self.response), {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15}


def request(broker, payload=None, *, method="POST", suffix="/chat/completions", path=None, headers=None):
    url = urlsplit(broker.base_url)
    connection = http.client.HTTPConnection(url.hostname, url.port, timeout=3)
    try:
        body = json.dumps(payload) if payload is not None else None
        connection.request(method, path or url.path + suffix, body,
                           {"Content-Type": "application/json", **(headers or {})})
        response = connection.getresponse()
        content_type = response.getheader("Content-Type")
        raw = response.read()
        return response.status, (raw if content_type.startswith("text/event-stream") else json.loads(raw))
    finally:
        connection.close()


def payload(**overrides):
    return {"model": MODEL, "messages": [{"role": "user", "content": "Protocol fixture message."}],
            "max_completion_tokens": 512, **overrides}


class NativeProviderTransport(unittest.TestCase):
    def broker(self, provider=None, **options):
        broker = NativeProviderBroker(provider or ProviderFixture(), **options).start()
        self.addCleanup(broker.close)
        return broker

    def test_model_discovery_needs_no_admission_or_provider_request(self):
        fixture = ProviderFixture()
        broker = self.broker(fixture)
        status, listing = request(broker, method="GET", suffix="/models")
        self.assertEqual(status, 200)
        self.assertEqual(listing["data"][0]["id"], MODEL)
        self.assertEqual(fixture.calls, [])
        self.assertEqual(request(broker, method="GET", path="/v1/models")[0], 404)
        self.assertEqual(request(broker, method="GET", suffix="/models?extra=true")[0], 404)
        self.assertEqual(request(broker, method="GET", suffix="/models",
                                 headers={"Host": "example.test"})[0], 404)
        self.assertEqual(request(broker, method="GET", suffix="/models",
                                 headers={"Origin": "http://127.0.0.1"})[0], 404)
        self.assertEqual(fixture.calls, [])

    def test_late_completion_cannot_enter_a_new_operation_window(self):
        entered, release = threading.Event(), threading.Event()
        outcomes, captures = [], []

        class DelayedProvider(ProviderFixture):
            def complete(self, messages, tools):
                if not self.calls:
                    entered.set()
                    if not release.wait(2):
                        raise AssertionError("The test did not release its response.")
                return super().complete(messages, tools)

        provider = DelayedProvider()
        broker = self.broker(provider, allow_request=lambda: True,
                             on_completion=lambda *response: captures.append(response))
        worker = threading.Thread(target=lambda: outcomes.append(request(broker, payload())), daemon=True)
        try:
            with broker.turn():
                worker.start()
                self.assertTrue(entered.wait(1))
            with broker.turn():
                release.set()
                worker.join(timeout=2)
                self.assertFalse(worker.is_alive())
                self.assertEqual(outcomes[0][0], 400)
                self.assertEqual(captures, [])
                self.assertEqual(len(provider.calls), 1)
                # Rejecting the old window must not poison the new one.
                self.assertEqual(request(broker, payload())[0], 200)
                self.assertEqual(len(provider.calls), 2)
                self.assertEqual(len(captures), 1)
        finally:
            release.set()
            worker.join(timeout=2)

    def test_only_explicit_operation_window_can_dispatch(self):
        fixture = ProviderFixture()
        broker = self.broker(fixture)
        self.assertEqual(request(broker, payload())[0], 400)
        self.assertEqual(fixture.calls, [])
        with broker.turn():
            status, completion = request(broker, payload())
            self.assertEqual(status, 200)
            self.assertEqual(completion["choices"][0]["message"], fixture.response)
            self.assertEqual(completion["choices"][0]["finish_reason"], "stop")
            with self.assertRaisesRegex(RuntimeError, "active"):
                with broker.turn():
                    self.fail("Nested model admission must be rejected.")
        self.assertEqual(request(broker, payload())[0], 400)
        self.assertEqual(len(fixture.calls), 1)

    def test_stream_preserves_actual_tool_calls_and_private_continuation(self):
        private = [{"type": "reasoning.encrypted", "data": "fixture-private-continuation"}]
        response = {"role": "assistant", "content": None, "reasoning_details": private,
                    "tool_calls": [{"id": "fixture-call", "type": "function", "function": {
                        "name": "memory_search", "arguments": '{"query":"fixture project"}',
                    }}]}
        fixture = ProviderFixture(response)
        captured = []
        broker = self.broker(fixture, on_completion=lambda message, usage: captured.append((message, usage)))
        tool = {"type": "function", "function": {"name": "memory_search", "description": "Fixture tool.",
                 "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}}}
        original = payload(stream=True, stream_options={"include_usage": True}, store=False,
                           messages=[{"role": "developer", "content": "Fixture instruction."},
                                     {"role": "user", "content": [{"type": "text", "text": "First part."},
                                                                    {"type": "text", "text": "Second part."}]},
                                     {"role": "assistant", "content": None, "reasoning_details": private,
                                      "tool_calls": response["tool_calls"]},
                                     {"role": "tool", "content": "Fixture result.", "tool_call_id": "fixture-call"}],
                           tools=[tool])
        with broker.turn():
            status, stream = request(broker, original)
        self.assertEqual(status, 200)
        self.assertTrue(stream.endswith(b"data: [DONE]\n\n"))
        chunks = [json.loads(line[6:]) for line in stream.decode().splitlines()
                  if line.startswith("data: ") and line != "data: [DONE]"]
        delta = chunks[1]["choices"][0]["delta"]
        self.assertEqual(delta["reasoning_details"], private)
        self.assertEqual(delta["tool_calls"][0]["index"], 0)
        self.assertEqual(delta["tool_calls"][0]["function"], response["tool_calls"][0]["function"])
        self.assertEqual(chunks[2]["choices"][0]["finish_reason"], "tool_calls")
        self.assertEqual(chunks[3]["usage"]["total_tokens"], 15)
        sent_messages, sent_tools = fixture.calls[0]
        self.assertEqual(sent_messages[0]["role"], "system")
        self.assertEqual(sent_messages[1]["content"], "First part.\nSecond part.")
        self.assertEqual(sent_messages[2]["reasoning_details"], private)
        self.assertEqual(sent_tools, [tool])
        self.assertNotIn("reasoning_details", captured[0][0])
        self.assertNotIn("fixture-private-continuation", json.dumps(captured))
        self.assertEqual(original["messages"][0]["role"], "developer")

    def test_provider_failure_blocks_native_retries_until_a_new_explicit_operation(self):
        fixture = ProviderFixture()
        fixture.error = RuntimeError("Fixture uncertain provider failure.")
        broker = self.broker(fixture)
        with broker.turn():
            self.assertEqual(request(broker, payload())[0], 400)
            fixture.error = None
            self.assertEqual(request(broker, payload())[0], 400)
        self.assertEqual(len(fixture.calls), 1)
        with broker.turn():
            self.assertEqual(request(broker, payload())[0], 200)
        self.assertEqual(len(fixture.calls), 2)

    def test_stop_denies_dispatch_before_the_provider_reserves(self):
        fixture = ProviderFixture()
        allowed = False
        broker = self.broker(fixture, allow_request=lambda: allowed)
        with broker.turn():
            self.assertEqual(request(broker, payload())[0], 400)
            allowed = True
            self.assertEqual(request(broker, payload())[0], 400)
        self.assertEqual(fixture.calls, [])
        with broker.turn():
            self.assertEqual(request(broker, payload())[0], 200)
        self.assertEqual(len(fixture.calls), 1)

    def test_unsupported_requests_never_reach_provider(self):
        fixture = ProviderFixture()
        broker = self.broker(fixture)
        variants = [payload(model="arbitrary/provider"), payload(max_completion_tokens=1024),
                    payload(max_completion_tokens=256), payload(max_tokens=512),
                    payload(temperature=0.8), payload(provider={"only": ["other"]}),
                    payload(store=True), payload(stream="yes"), payload(reasoning_effort="high"),
                    payload(tool_choice="required"), payload(parallel_tool_calls=False),
                    payload(stream_options={"include_usage": "yes"}),
                    payload(messages=[{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "data:fixture"}}]}])]
        with broker.turn():
            for body in variants:
                with self.subTest(body=body):
                    self.assertEqual(request(broker, body)[0], 400)
        self.assertEqual(fixture.calls, [])

    def test_stop_during_upstream_request_withholds_tools_and_preserves_reservation(self):
        with tempfile.TemporaryDirectory(prefix="native-cancel-ledger-fixture-") as temporary:
            provider = Provider(Path(temporary)/"provider-ledger.json", 1,
                                key="fixture-never-sent-key")
            provider._prices_checked = True
            allowed = True
            captured = []
            broker = self.broker(provider, allow_request=lambda: allowed,
                                 on_completion=lambda *result: captured.append(result))
            result = {"choices": [{"finish_reason": "tool_calls", "message": {
                "role": "assistant", "content": None, "tool_calls": [{
                    "id": "fixture-late-write", "type": "function", "function": {
                        "name": "write", "arguments": '{"path":"memory/fixture.md","content":"Must not execute after Stop."}'},
                }]}}], "usage": {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15}}
            tool = {"type": "function", "function": {"name": "write", "description": "Fixture tool.",
                    "parameters": {"type": "object", "properties": {}}}}

            def stopped_response(*_):
                nonlocal allowed
                allowed = False
                return result

            with patch.object(provider, "_response_json", side_effect=stopped_response) as remote:
                with broker.turn():
                    status, denied = request(broker, payload(tools=[tool], stream=True))
                    self.assertEqual(status, 400)
                    self.assertIn("stopped", denied["error"]["message"])
                    self.assertNotIn("fixture-late-write", json.dumps(denied))
                    retained = provider.state()
                    self.assertEqual(retained["requests"], 1)
                    self.assertGreater(retained["reservedUsd"], 0)
                    allowed = True
                    self.assertEqual(request(broker, payload(tools=[tool]))[0], 400)
                    self.assertEqual(provider.state(), retained)
                self.assertEqual(remote.call_count, 1)
            self.assertEqual(captured, [])

    def test_optional_capture_failure_does_not_discard_a_paid_completion(self):
        fixture = ProviderFixture()

        def unavailable_capture(*_):
            raise RuntimeError("Fixture UI capture failed.")

        broker = self.broker(fixture, on_completion=unavailable_capture)
        with broker.turn():
            status, completion = request(broker, payload(stream=True, stream_options=None))
            self.assertEqual(status, 200)
            self.assertIn(b"Native transport protocol fixture.", completion)
        self.assertEqual(len(fixture.calls), 1)

    def test_same_durable_provider_ledger_keeps_success_and_unknown_attempts(self):
        with tempfile.TemporaryDirectory(prefix="native-transport-ledger-fixture-") as temporary:
            ledger = Path(temporary)/"provider-ledger.json"
            provider = Provider(ledger, 1, key="fixture-never-sent-key")
            provider._prices_checked = True
            broker = self.broker(provider)
            result = {"choices": [{"finish_reason": "stop", "message": {
                "role": "assistant", "content": "Durable ledger protocol fixture."}}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15}}
            # Actual loopback HTTP + real durable Provider admission, with a
            # labelled remote-response fixture instead of any paid request.
            with patch.object(provider, "_response_json", side_effect=[result, RuntimeError("Fixture lost remote response.")]) as remote:
                with broker.turn():
                    self.assertEqual(request(broker, payload())[0], 200)
                first = provider.state()
                self.assertEqual(first["requests"], 1)
                with broker.turn():
                    self.assertEqual(request(broker, payload())[0], 400)
                    failed = provider.state()
                    self.assertEqual(failed["requests"], 2)
                    self.assertGreater(failed["reservedUsd"], first["reservedUsd"])
                    self.assertEqual(request(broker, payload())[0], 400)
                    self.assertEqual(provider.state(), failed)
                self.assertEqual(remote.call_count, 2)
            reopened = Provider(ledger, 1, key="fixture-never-sent-key")
            self.assertEqual(reopened.state(), failed)


if __name__ == "__main__":
    unittest.main()

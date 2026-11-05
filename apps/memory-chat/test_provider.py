"""Provider transport fixtures, not genuine-model acceptance. Zero network calls."""
from __future__ import annotations

import json
from copy import deepcopy
import os
from pathlib import Path
import ssl
import stat
import tempfile
from threading import Event, Thread
import unittest
from unittest.mock import MagicMock, patch
import urllib.error

from provider import MODEL, Provider


def metadata(**pricing):
    return {"data": [{"id": MODEL, "pricing": {
        "prompt": "0.000003", "completion": "0.000015",
        "input_cache_write": "0.000003", "input_cache_read": "0.0000003",
        **pricing}}]}


def reply(content="A genuine transport fixture, not an actual model reply."):
    return {"choices": [{"finish_reason": "stop", "message": {
        "role": "assistant", "content": content}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5,
                  "total_tokens": 15, "cost": 0.0001, "unknown": "not exposed"}}


class Response:
    status = 200

    def __init__(self, value):
        self.raw = json.dumps(value).encode() if not isinstance(value, bytes) else value

    def read(self, limit):
        return self.raw[:limit]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class Transport:
    def __init__(self, *, prices=None, completion=None, failure=None):
        self.prices = metadata() if prices is None else prices
        self.completion = reply() if completion is None else completion
        self.failure = failure
        self.calls = []
        self.timeouts = []

    def open(self, request, timeout):
        self.calls.append(request)
        self.timeouts.append(timeout)
        if request.full_url.endswith("/models"):
            return Response(self.prices)
        if self.failure:
            raise self.failure
        return Response(self.completion)


MESSAGES = [{"role": "user", "content": "Say hello."}]
TOOLS = [{"type": "function", "function": {"name": "memory_search",
          "description": "Search saved sources.", "parameters": {"type": "object"}}}]


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="chat-provider-fixture-")
        self.root = Path(self.temporary.name)
        self.path = self.root / "allowance.json"

    def tearDown(self):
        self.temporary.cleanup()

    def provider(self, budget=1, *, transport=None, **kwargs):
        value = Provider(self.path, budget, key="test-fixture-only", **kwargs)
        value._http = transport or Transport()
        return value

    def test_zero_allowance_is_inspection_only_and_does_not_consume_admission(self):
        provider = self.provider(0)
        self.assertFalse(provider.ready)
        self.assertEqual(provider.state(), {
            "limitUsd": 0, "reservedUsd": 0, "remainingUsd": 0, "requests": 0})
        self.assertFalse(self.path.exists())
        with self.assertRaisesRegex(RuntimeError, "positive demo budget"):
            provider.complete(MESSAGES, [])
        self.assertEqual(provider._http.calls, [])
        self.assertTrue(self.provider(1).ready)

    def test_reservation_survives_failure_and_restart_without_refund_or_retry(self):
        provider = self.provider(transport=Transport(failure=urllib.error.URLError("secret-value")))
        with self.assertRaisesRegex(RuntimeError, "connection failed") as caught:
            provider.complete(MESSAGES, [])
        self.assertNotIn("secret-value", str(caught.exception))
        before = provider.state()
        self.assertEqual(before["requests"], 1)
        self.assertGreater(before["reservedUsd"], 0)
        self.assertEqual(len(provider._http.calls), 2)  # Public metadata + one dispatch.
        resumed = self.provider()
        self.assertEqual(resumed.state(), before)
        message, usage = resumed.complete(MESSAGES, [])
        self.assertEqual(message["role"], "assistant")
        self.assertEqual(resumed.state()["requests"], 2)
        self.assertGreater(resumed.state()["reservedUsd"], before["reservedUsd"])
        self.assertNotIn("unknown", usage)
        body = json.loads(resumed._http.calls[-1].data)
        self.assertEqual(body["model"], MODEL)
        self.assertEqual(body["max_completion_tokens"], 512)
        self.assertEqual(body["reasoning"], {"effort": "low"})
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(resumed.admission.stat().st_mode), 0o600)

    def test_exhaustion_denies_before_model_dispatch_and_preserves_counters(self):
        provider = self.provider(0.000001)
        with self.assertRaisesRegex(RuntimeError, "allowance is exhausted"):
            provider.complete(MESSAGES, [])
        self.assertEqual(provider.state()["requests"], 0)
        self.assertEqual(provider.state()["reservedUsd"], 0)
        self.assertEqual(len(provider._http.calls), 1)
        self.assertTrue(provider._http.calls[0].full_url.endswith("/models"))

    def test_changed_policy_missing_record_symlinks_and_corruption_cannot_reset(self):
        provider = self.provider()
        provider.complete(MESSAGES, [])
        reserved = self.path.read_bytes()
        for kwargs in [{"budget": 2}, {"max_output_tokens": 128}]:
            with self.subTest(kwargs=kwargs):
                with self.assertRaisesRegex(RuntimeError, "different budget or policy"):
                    self.provider(**kwargs)
                self.assertEqual(self.path.read_bytes(), reserved)
        self.path.unlink()
        with self.assertRaisesRegex(RuntimeError, "no reset"):
            self.provider()
        self.path.symlink_to(provider.admission)
        with self.assertRaisesRegex(RuntimeError, "unsafe"):
            self.provider()
        self.path.unlink()
        self.path.write_bytes(reserved)
        self.path.chmod(0o600)
        data = json.loads(reserved)
        data["requests"] = True
        self.path.write_text(json.dumps(data))
        with self.assertRaisesRegex(RuntimeError, "invalid"):
            self.provider()

    def test_price_tiers_and_per_request_fees_fail_before_admission(self):
        for prices in [metadata(prompt="0.001"), metadata(request="0.01"),
                       metadata(overrides=[{"min_prompt_tokens": 200000, "completion": "0.001"}]),
                       {"data": []}, metadata(prompt="NaN")]:
            with self.subTest(prices=prices):
                provider = self.provider(transport=Transport(prices=prices))
                with self.assertRaises(RuntimeError):
                    provider.complete(MESSAGES, [])
                self.assertEqual(provider.state()["requests"], 0)
                self.assertEqual(len(provider._http.calls), 1)

    def test_malformed_and_oversized_response_remain_charged(self):
        invalid = [b"not-json", b"\xff", b"x" * (1024 * 1024 + 1),
                   {"choices": []}, {"choices": [{"finish_reason": []}]},
                   {"choices": [{"finish_reason": "length", "message": {
                       "role": "assistant", "content": None}}]}, reply("")]
        for value in invalid:
            with self.subTest(valueType=type(value).__name__):
                provider = self.provider(transport=Transport(completion=value))
                before = provider.state()["requests"]
                with self.assertRaises(RuntimeError):
                    provider.complete(MESSAGES, [])
                self.assertEqual(provider.state()["requests"], before + 1)

    def test_tool_calls_are_restricted_to_declared_local_functions(self):
        call = {"id": "call-1", "type": "function", "function": {
            "name": "memory_search", "arguments": '{"query":"Atlas"}'}}
        value = {"choices": [{"finish_reason": "tool_calls", "message": {
            "role": "assistant", "content": None, "tool_calls": [call]}}]}
        provider = self.provider(transport=Transport(completion=value))
        message, _ = provider.complete(MESSAGES, TOOLS)
        self.assertEqual(message["tool_calls"], [call])
        for mutated in [dict(call, id=""), {**call, "function": {"name": "undeclared", "arguments": "{}"}},
                        {**call, "function": {"name": "memory_search", "arguments": "[]"}}]:
            provider._http = Transport(completion={"choices": [{"finish_reason": "tool_calls", "message": {
                "role": "assistant", "content": None, "tool_calls": [mutated]}}]})
            with self.assertRaises(RuntimeError):
                provider.complete(MESSAGES, TOOLS)

    def test_invalid_request_and_missing_key_never_dispatch(self):
        provider = self.provider()
        for messages, tools in [([], []), ([{"role": [], "content": "x"}], []),
                                ([{"role": "user", "content": None}], []),
                                ([{"role": "user", "content": [{"type": "image_url"}]}], []),
                                (MESSAGES, [None]),
                                ([{"role": "user", "content": "x" * (96 * 1024)}], [])]:
            with self.subTest(messagesType=type(messages).__name__):
                with self.assertRaises(RuntimeError):
                    provider.complete(messages, tools)
        self.assertEqual(provider._http.calls, [])
        provider._key = None
        with self.assertRaisesRegex(RuntimeError, "server-side OpenRouter key"):
            provider.complete(MESSAGES, [])
        self.assertEqual(provider.state()["requests"], 0)

    def test_opaque_reasoning_and_tool_identity_survive_the_next_request_unchanged(self):
        call = {"id": "call-reasoning-1", "type": "function", "function": {
            "name": "memory_search", "arguments": '{"query":"Atlas"}'}}
        reasoning = [{"type": "reasoning.encrypted", "id": "rs-opaque",
                      "data": "opaque-fixture-signature-+/=", "format": "provider-owned",
                      "unknown_future_field": {"sequence": [2, 1, 2]}},
                     {"type": "reasoning.summary", "summary": "Private fixture summary."}]
        source = {"role": "assistant", "content": None, "tool_calls": [call],
                  "reasoning": "Private fixture reasoning text.", "reasoning_details": reasoning}
        expected = deepcopy(source)
        transport = Transport(completion={"choices": [{"finish_reason": "tool_calls", "message": source}]})
        provider = self.provider(transport=transport)
        assistant, _ = provider.complete(MESSAGES, TOOLS)
        self.assertEqual(assistant, expected)
        history = [*deepcopy(MESSAGES), assistant, {"role": "tool", "tool_call_id": call["id"],
                   "content": '{"results":[]}'}]
        unchanged_history = deepcopy(history)
        transport.completion = reply("No saved source was found.")
        provider.complete(history, TOOLS)
        sent = json.loads(transport.calls[-1].data)
        self.assertEqual(sent["messages"][1], expected)
        self.assertEqual(sent["messages"][2]["tool_call_id"], call["id"])
        self.assertEqual(history, unchanged_history)
        self.assertEqual(source, expected)
        self.assertEqual(provider.state()["requests"], 2)

    def test_reasoning_is_assistant_only_and_bounded_before_another_dispatch(self):
        provider = self.provider()
        for message in [
            {"role": "user", "content": "Hello", "reasoning": "injected"},
            {"role": "tool", "content": "{}", "reasoning_details": []},
            {"role": "assistant", "content": "Hello", "reasoning": []},
            {"role": "assistant", "content": "Hello", "reasoning_details": ["not a block"]},
            {"role": "assistant", "content": "Hello", "reasoning_details": [{"data": "x" * (1024 * 1024)}]},
        ]:
            with self.subTest(role=message["role"]):
                with self.assertRaises(RuntimeError):
                    provider.complete([message], TOOLS)
        self.assertEqual(provider._http.calls, [])
        self.assertEqual(provider.state()["requests"], 0)
        invalid_source = reply()["choices"][0]["message"]
        invalid_source["reasoning_details"] = {"not": "a list"}
        provider._http = Transport(completion={"choices": [{"finish_reason": "stop", "message": invalid_source}]})
        with self.assertRaisesRegex(RuntimeError, "continuation metadata is invalid"):
            provider.complete(MESSAGES, [])
        self.assertEqual(provider.state()["requests"], 1)

    def test_transport_inherits_proxies_and_keeps_tls_verification(self):
        context = MagicMock(spec=ssl.SSLContext)
        opener = object()
        with patch("provider.create_tls_context", return_value=context) as trust, \
             patch("provider.urllib.request.ProxyHandler") as proxy, \
             patch("provider.urllib.request.HTTPSHandler") as https, \
             patch("provider.urllib.request.build_opener", return_value=opener):
            provider = Provider(self.path, 0, key="fixture-only")
        proxy.assert_called_once_with()
        trust.assert_called_once_with()
        https.assert_called_once_with(context=context)
        self.assertIs(provider._http, opener)

    def test_missing_chat_https_support_does_not_create_an_allowance(self):
        with patch.dict("sys.modules", {"certifi": None, "truststore": None}):
            with self.assertRaisesRegex(RuntimeError, r"python\[chat\]"):
                Provider(self.path, 1, key="fixture-only")
        self.assertFalse(self.path.exists())
        self.assertFalse(self.path.with_name(self.path.name + ".admission").exists())

    def test_tls_preflight_keeps_the_safe_certificate_reason_and_does_not_charge(self):
        certificate_error = ssl.SSLCertVerificationError(1, "private raw certificate detail")
        certificate_error.verify_message = "unable to get local issuer certificate"
        provider = self.provider()
        provider._http.open = MagicMock(side_effect=urllib.error.URLError(certificate_error))
        with self.assertRaisesRegex(RuntimeError, "unable to get local issuer certificate") as failure:
            provider.complete(MESSAGES, [])
        self.assertNotIn("private raw certificate detail", str(failure.exception))
        self.assertIn("No completion request was sent", str(failure.exception))
        self.assertEqual(provider.state()["requests"], 0)
        self.assertEqual(provider.state()["reservedUsd"], 0)
        provider._http.open.assert_called_once()

    def test_http_errors_redact_bodies_and_do_not_retry(self):
        failure = urllib.error.HTTPError("https://openrouter.ai", 429, "secret-body", {}, None)
        provider = self.provider(transport=Transport(failure=failure))
        with self.assertRaisesRegex(RuntimeError, "HTTP 429") as caught:
            provider.complete(MESSAGES, [])
        self.assertNotIn("secret-body", str(caught.exception))
        self.assertEqual(provider.state()["requests"], 1)
        self.assertEqual(len(provider._http.calls), 2)

    def test_finite_transport_timeout_survives_restart_without_changing_allowance(self):
        transport = Transport(failure=TimeoutError("private timeout detail"))
        provider = self.provider(transport=transport)
        with self.assertRaisesRegex(RuntimeError, "timed out after 30 seconds") as caught:
            provider.complete(MESSAGES, [])
        self.assertNotIn("private timeout detail", str(caught.exception))
        self.assertEqual(transport.timeouts, [30, 30])
        retained = provider.state()
        self.assertEqual(retained["requests"], 1)
        resumed_transport = Transport()
        resumed = self.provider(transport=resumed_transport, timeout_seconds=1.5)
        self.assertEqual(resumed.state(), retained)
        resumed.complete(MESSAGES, [])
        self.assertEqual(resumed_transport.timeouts, [1.5, 1.5])
        self.assertEqual(resumed.state()["requests"], 2)
        for invalid in [0, -1, True, float("nan"), float("inf"), 121]:
            with self.subTest(timeout=invalid):
                with self.assertRaisesRegex(ValueError, "Provider timeout"):
                    self.provider(timeout_seconds=invalid)

    def test_status_is_actionable_and_does_not_wait_on_the_network_lock(self):
        disabled = self.provider(0)
        self.assertEqual(disabled.status(), {"ready": False, "reason": "budget_disabled"})
        disabled._key = None
        self.assertEqual(disabled.status(), {"ready": False, "reason": "missing_api_key"})

        entered, release, status_returned = Event(), Event(), Event()

        class PendingTransport(Transport):
            def open(self, request, timeout):
                if not request.full_url.endswith("/models"):
                    entered.set()
                    release.wait(3)
                return super().open(request, timeout)

        provider = self.provider(transport=PendingTransport())
        outcome = {}

        def complete():
            outcome["reply"] = provider.complete(MESSAGES, [])

        def inspect():
            outcome["status"] = provider.status()
            status_returned.set()

        pending = Thread(target=complete)
        inspection = Thread(target=inspect)
        pending.start()
        try:
            self.assertTrue(entered.wait(2))
            inspection.start()
            self.assertTrue(status_returned.wait(1), "Status must remain available while a model request is pending.")
            self.assertEqual(outcome["status"], {"ready": True, "reason": None})
            self.assertTrue(pending.is_alive())
        finally:
            release.set()
            pending.join(5)
            if inspection.ident is not None:
                inspection.join(5)
        self.assertFalse(pending.is_alive())
        self.assertIn("reply", outcome)

        # Labelled retained-allowance fixture, not an actual provider charge.
        exhausted = json.loads(self.path.read_text())
        exhausted["reservedNanos"] = 1_000_000_000
        self.path.write_text(json.dumps(exhausted))
        provider.state()
        self.assertEqual(provider.status(), {"ready": False, "reason": "allowance_exhausted"})
        count = len(provider._http.calls)
        with self.assertRaisesRegex(RuntimeError, "allowance is exhausted"):
            provider.complete(MESSAGES, [])
        self.assertEqual(len(provider._http.calls), count)

    def test_pricing_failure_explains_that_no_completion_was_sent(self):
        provider = self.provider(transport=Transport(prices={"data": []}))
        with self.assertRaisesRegex(RuntimeError, "pricing preflight failed.*No completion request was sent"):
            provider.complete(MESSAGES, [])
        self.assertEqual(provider.state()["requests"], 0)
        self.assertEqual(len(provider._http.calls), 1)

    def test_visible_truncated_text_is_preserved_without_auto_continuation(self):
        value = {"choices": [{"finish_reason": "length", "message": {
            "role": "assistant", "content": "Actual partial model text."}}]}
        provider = self.provider(transport=Transport(completion=value))
        message, usage = provider.complete(MESSAGES, [])
        self.assertEqual(message, {"role": "assistant", "content": "Actual partial model text."})
        self.assertTrue(usage["completion_truncated"])
        self.assertEqual(provider.state()["requests"], 1)
        self.assertEqual(len(provider._http.calls), 2)
        self.assertEqual(json.loads(provider._http.calls[-1].data)["max_completion_tokens"], 512)

    def test_truncated_tools_or_invisible_reasoning_never_become_an_answer(self):
        call = {"id": "partial-call", "type": "function", "function": {
            "name": "memory_search", "arguments": '{"query":"Atlas"}'}}
        values = [
            ({"role": "assistant", "content": "Partial", "tool_calls": [call]}, "truncated tool"),
            ({"role": "assistant", "content": "", "reasoning": "Private reasoning."}, "without producing a visible answer"),
        ]
        for message, reason in values:
            with self.subTest(reason=reason):
                provider = self.provider(transport=Transport(completion={
                    "choices": [{"finish_reason": "length", "message": message}]}))
                count = provider.state()["requests"]
                with self.assertRaisesRegex(RuntimeError, reason) as caught:
                    provider.complete(MESSAGES, TOOLS)
                self.assertNotIn("Private reasoning", str(caught.exception))
                self.assertEqual(provider.state()["requests"], count + 1)
                self.assertEqual(len(provider._http.calls), 2)


if __name__ == "__main__":
    unittest.main()

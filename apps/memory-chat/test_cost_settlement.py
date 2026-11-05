"""Actual-cost accounting regression tests using a labelled local transport fixture.

No provider, pricing endpoint, or model is contacted by these tests.
"""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

from provider import Provider
from test_provider import MESSAGES, Transport, reply


class ProviderCostSettlement(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="chat-cost-settlement-fixture-")
        self.root = Path(self.temporary.name)
        self.path = self.root / "allowance.json"

    def tearDown(self):
        self.temporary.cleanup()

    def provider(self, budget=0.05, *, transport=None, path=None):
        value = Provider(path or self.path, budget, key="cost-fixture-only")
        value._http = transport or Transport()
        return value

    def ledger(self):
        return json.loads(self.path.read_text())

    def test_successes_use_reported_cost_after_historical_estimates_exceed_limit(self):
        provider = self.provider()
        original_admission = provider.admission.read_bytes()
        original_hash = self.ledger()["policySha256"]
        previous_reserved = 0
        for request in range(1, 21):
            message, usage = provider.complete(MESSAGES, [])
            self.assertEqual(message["role"], "assistant")
            self.assertEqual(usage["cost"], 0.0001)
            state = provider.state()
            self.assertEqual(state["requests"], request)
            self.assertGreater(state["reservedUsd"], previous_reserved)
            previous_reserved = state["reservedUsd"]
            self.assertAlmostEqual(state["providerReportedCostUsd"], request * 0.0001, places=9)
            self.assertEqual(state["unsettledEstimateUsd"], 0)
            self.assertAlmostEqual(state["remainingUsd"], 0.05 - request * 0.0001, places=9)

        self.assertGreater(state["reservedUsd"], state["limitUsd"])
        self.assertTrue(provider.ready)
        self.assertEqual(provider.admission.read_bytes(), original_admission)
        self.assertEqual(self.ledger()["policySha256"], original_hash)
        restarted = self.provider()
        self.assertEqual(restarted.state(), state)
        self.assertEqual(restarted._http.calls, [])

    def test_unknown_failure_keeps_its_estimate_alongside_settled_success(self):
        provider = self.provider()
        provider.complete(MESSAGES, [])
        before = provider.state()
        provider._http.failure = urllib.error.URLError("unknown remote outcome")
        with self.assertRaisesRegex(RuntimeError, "connection failed"):
            provider.complete(MESSAGES, [])

        after = provider.state()
        failed_estimate = after["reservedUsd"] - before["reservedUsd"]
        self.assertGreater(failed_estimate, 0)
        self.assertEqual(after["requests"], 2)
        self.assertAlmostEqual(after["providerReportedCostUsd"], 0.0001, places=9)
        self.assertAlmostEqual(after["unsettledEstimateUsd"], failed_estimate, places=9)
        self.assertAlmostEqual(after["remainingUsd"], 0.05 - 0.0001 - failed_estimate, places=9)
        self.assertEqual(len(self.ledger()["attempts"]), 2)
        self.assertIn("actualNanos", self.ledger()["attempts"][0])
        self.assertNotIn("actualNanos", self.ledger()["attempts"][1])
        self.assertEqual(self.provider().state(), after)
        provider._http.failure = None
        provider.complete(MESSAGES, [])
        following = provider.state()
        self.assertEqual(following["requests"], 3)
        self.assertAlmostEqual(following["providerReportedCostUsd"], 0.0002, places=9)
        self.assertAlmostEqual(following["unsettledEstimateUsd"], failed_estimate, places=9)
        self.assertNotIn("actualNanos", self.ledger()["attempts"][1])
        self.assertIn("actualNanos", self.ledger()["attempts"][2])

    def test_success_without_valid_cost_retains_full_estimate(self):
        absent = object()
        invalid_costs = (absent, None, True, False, "0.0001", -0.0001,
                         float("nan"), float("inf"), -float("inf"), 1e15)
        for index, cost in enumerate(invalid_costs):
            with self.subTest(cost=repr(cost)):
                completion = reply()
                if cost is absent:
                    del completion["usage"]["cost"]
                else:
                    completion["usage"]["cost"] = cost
                path = self.root / str(index) / "allowance.json"
                provider = self.provider(transport=Transport(completion=completion), path=path)
                message, usage = provider.complete(MESSAGES, [])
                self.assertEqual(message["role"], "assistant")
                self.assertNotIn("cost", usage or {})
                state = provider.state()
                self.assertEqual(state["requests"], 1)
                self.assertEqual(state["providerReportedCostUsd"], 0)
                self.assertEqual(state["unsettledEstimateUsd"], state["reservedUsd"])
                self.assertAlmostEqual(state["remainingUsd"], 0.05 - state["reservedUsd"], places=9)
                self.assertNotIn("actualNanos", json.loads(path.read_text())["attempts"][0])

    def test_cost_above_validated_estimate_cannot_create_a_credit(self):
        completion = reply()
        completion["usage"]["cost"] = 1
        provider = self.provider(transport=Transport(completion=completion))
        message, usage = provider.complete(MESSAGES, [])
        self.assertEqual(message["role"], "assistant")
        self.assertEqual(usage["cost"], 1)
        self.assertTrue(usage["cost_settlement_pending"])
        state = provider.state()
        self.assertEqual(state["requests"], 1)
        self.assertGreater(state["reservedUsd"], 0)
        self.assertEqual(state["providerReportedCostUsd"], 0)
        self.assertEqual(state["unsettledEstimateUsd"], state["reservedUsd"])
        self.assertAlmostEqual(state["remainingUsd"], 0.05 - state["reservedUsd"], places=9)
        self.assertNotIn("actualNanos", self.ledger()["attempts"][0])
        self.assertIn("overageNanos", self.ledger()["attempts"][0])
        self.assertFalse(provider.ready)
        dispatched = len(provider._http.calls)
        with self.assertRaises(RuntimeError):
            provider.complete(MESSAGES, [])
        self.assertEqual(len(provider._http.calls), dispatched)
        resumed = self.provider()
        self.assertEqual(resumed.state(), state)
        self.assertFalse(resumed.ready)
        with self.assertRaises(RuntimeError):
            resumed.complete(MESSAGES, [])
        self.assertEqual(resumed._http.calls, [])

    def test_zero_provider_cost_is_a_valid_settlement(self):
        completion = reply()
        completion["usage"]["cost"] = 0
        provider = self.provider(transport=Transport(completion=completion))
        provider.complete(MESSAGES, [])
        state = provider.state()
        self.assertGreater(state["reservedUsd"], 0)
        self.assertEqual(state["remainingUsd"], 0.05)
        self.assertEqual(state["providerReportedCostUsd"], 0)
        self.assertEqual(state["unsettledEstimateUsd"], 0)
        self.assertEqual(self.ledger()["attempts"][0]["actualNanos"], 0)

    def test_reported_subnanodollar_cost_rounds_up(self):
        for index, (reported, nanos) in enumerate(((0.0000000001, 1), (0.0000000011, 2),
                                                  (0.0001000000001, 100001))):
            with self.subTest(reported=reported):
                completion = reply()
                completion["usage"]["cost"] = reported
                path = self.root / str(index) / "allowance.json"
                provider = self.provider(transport=Transport(completion=completion), path=path)
                provider.complete(MESSAGES, [])
                state = provider.state()
                self.assertEqual(state["providerReportedCostUsd"], nanos / 1_000_000_000)
                self.assertAlmostEqual(state["remainingUsd"], 0.05 - nanos / 1_000_000_000, places=9)
                self.assertEqual(json.loads(path.read_text())["attempts"][0]["actualNanos"], nanos)

    def test_malformed_completion_with_reported_cost_does_not_release_estimate(self):
        completion = reply()
        completion["choices"] = []
        provider = self.provider(transport=Transport(completion=completion))
        with self.assertRaisesRegex(RuntimeError, "completion"):
            provider.complete(MESSAGES, [])
        state = provider.state()
        self.assertEqual(state["requests"], 1)
        self.assertGreater(state["reservedUsd"], 0)
        self.assertEqual(state["providerReportedCostUsd"], 0)
        self.assertEqual(state["unsettledEstimateUsd"], state["reservedUsd"])
        self.assertAlmostEqual(state["remainingUsd"], 0.05 - state["reservedUsd"], places=9)
        self.assertNotIn("actualNanos", self.ledger()["attempts"][0])

    def test_corrupt_attempt_journals_fail_closed_without_repair_or_dispatch(self):
        provider = self.provider()
        provider.complete(MESSAGES, [])
        valid = self.ledger()
        original_admission = provider.admission.read_bytes()
        attempt = valid["attempts"][0]
        corruptions = {
            "duplicate attempt": {"attempts": [attempt, attempt]},
            "negative estimate": {"attempts": [{**attempt, "estimateNanos": -1}]},
            "boolean estimate": {"attempts": [{**attempt, "estimateNanos": True}]},
            "negative actual": {"attempts": [{**attempt, "actualNanos": -1}]},
            "boolean actual": {"attempts": [{**attempt, "actualNanos": False}]},
            "actual exceeds estimate": {"attempts": [{**attempt, "actualNanos": attempt["estimateNanos"] + 1}]},
            "estimates exceed historical total": {"attempts": [{**attempt, "estimateNanos": valid["reservedNanos"] + 1}]},
            "unknown attempt field": {"attempts": [{**attempt, "unexpected": 1}]},
            "attempts not a list": {"attempts": {"estimateNanos": 1}},
            "missing attempt": {"attempts": []},
            "legacy count exceeds total": {"legacy": {"requests": 2, "reservedNanos": 0}},
            "legacy estimate exceeds total": {"legacy": {"requests": 0, "reservedNanos": valid["reservedNanos"] + 1}},
            "boolean legacy count": {"legacy": {"requests": False, "reservedNanos": 0}},
            "negative legacy estimate": {"legacy": {"requests": 0, "reservedNanos": -1}},
        }
        for name, fields in corruptions.items():
            with self.subTest(corruption=name):
                corrupt = {**deepcopy(valid), **deepcopy(fields)}
                self.path.write_text(json.dumps(corrupt))
                retained = self.path.read_bytes()
                with self.assertRaises(RuntimeError):
                    self.provider()
                provider._http.calls.clear()
                with self.assertRaises(RuntimeError):
                    provider.complete(MESSAGES, [])
                self.assertFalse(any(call.full_url.endswith("/chat/completions")
                                     for call in provider._http.calls))
                self.assertEqual(self.path.read_bytes(), retained)
                self.assertEqual(provider.admission.read_bytes(), original_admission)
        self.path.write_text(json.dumps(valid))

    def test_legacy_reservations_are_not_retroactively_settled(self):
        provider = self.provider(budget=1)
        legacy = self.ledger()
        legacy.update(reservedNanos=200_000_000, requests=3)
        legacy.pop("attempts", None)
        legacy.pop("legacy", None)
        self.path.write_text(json.dumps(legacy))
        retained = self.path.read_bytes()
        original_admission = provider.admission.read_bytes()

        resumed = self.provider(budget=1)
        state = resumed.state()
        self.assertEqual(state["requests"], 3)
        self.assertEqual(state["reservedUsd"], 0.2)
        self.assertEqual(state["remainingUsd"], 0.8)
        self.assertEqual(state["providerReportedCostUsd"], 0)
        self.assertEqual(state["unsettledEstimateUsd"], 0.2)
        self.assertEqual(self.path.read_bytes(), retained)
        self.assertEqual(resumed._http.calls, [])

        resumed.complete(MESSAGES, [])
        state = resumed.state()
        self.assertEqual(state["requests"], 4)
        self.assertGreater(state["reservedUsd"], 0.2)
        self.assertEqual(state["unsettledEstimateUsd"], 0.2)
        self.assertAlmostEqual(state["providerReportedCostUsd"], 0.0001, places=9)
        self.assertAlmostEqual(state["remainingUsd"], 0.8 - 0.0001, places=9)
        self.assertEqual(self.ledger()["legacy"], {"requests": 3, "reservedNanos": 200_000_000})
        self.assertEqual(len(self.ledger()["attempts"]), 1)
        self.assertEqual(self.ledger()["attempts"][0]["actualNanos"], 100_000)
        self.assertEqual(resumed.admission.read_bytes(), original_admission)

    def test_failed_settlement_persistence_preserves_answer_and_estimated_hold(self):
        provider = self.provider()
        original_write = provider._write
        writes = 0

        def fail_settlement(value):
            nonlocal writes
            writes += 1
            if writes == 2:
                raise RuntimeError("Synthetic failure while retaining settlement.")
            return original_write(value)

        with patch.object(provider, "_write", side_effect=fail_settlement):
            message, usage = provider.complete(MESSAGES, [])

        self.assertEqual(message["content"], reply()["choices"][0]["message"]["content"])
        self.assertTrue(usage["cost_settlement_pending"])
        self.assertEqual(usage["cost"], 0.0001)
        self.assertEqual(writes, 2)
        state = provider.state()
        self.assertEqual(state["requests"], 1)
        self.assertGreater(state["reservedUsd"], 0)
        self.assertEqual(state["providerReportedCostUsd"], 0)
        self.assertEqual(state["unsettledEstimateUsd"], state["reservedUsd"])
        self.assertAlmostEqual(state["remainingUsd"], 0.05 - state["reservedUsd"], places=9)
        self.assertNotIn("actualNanos", self.ledger()["attempts"][0])
        self.assertFalse(provider.ready)
        dispatched = len(provider._http.calls)
        with self.assertRaises(RuntimeError):
            provider.complete(MESSAGES, [])
        self.assertEqual(len(provider._http.calls), dispatched)
        resumed = self.provider()
        self.assertEqual(resumed.state(), state)
        self.assertTrue(resumed.ready)
        self.assertEqual(resumed._http.calls, [])

    def test_history_cannot_be_rebased_or_reprice_an_earlier_request(self):
        provider = self.provider(budget=1)
        provider.complete(MESSAGES, [])
        provider.complete(MESSAGES, [])
        current = self.ledger()
        retained = self.path.read_bytes()
        original_admission = provider.admission.read_bytes()

        changed_actual = deepcopy(current)
        changed_actual["attempts"][0]["actualNanos"] = 0
        changed_estimate = deepcopy(current)
        changed_estimate["attempts"][0]["estimateNanos"] += 1
        changed_estimate["reservedNanos"] += 1
        rebased = deepcopy(current)
        first = rebased["attempts"].pop(0)
        rebased["legacy"]["requests"] += 1
        rebased["legacy"]["reservedNanos"] += first["estimateNanos"]

        for name, changed in (("settled cost", changed_actual),
                              ("historical estimate", changed_estimate),
                              ("legacy baseline", rebased)):
            with self.subTest(changed=name):
                with self.assertRaises(RuntimeError):
                    provider._write(changed)
                self.assertEqual(self.path.read_bytes(), retained)
                self.assertEqual(provider.admission.read_bytes(), original_admission)
        self.assertEqual(provider.state()["requests"], 2)
        self.assertAlmostEqual(provider.state()["providerReportedCostUsd"], 0.0002, places=9)

    def test_stale_completion_snapshot_cannot_erase_a_later_reservation(self):
        provider = self.provider(budget=1, transport=Transport(
            failure=urllib.error.URLError("first outcome unknown")))
        with self.assertRaises(RuntimeError):
            provider.complete(MESSAGES, [])
        stale = self.ledger()
        provider._http.failure = None
        provider.complete(MESSAGES, [])
        retained = self.path.read_bytes()
        state = provider.state()
        stale["attempts"][0]["actualNanos"] = 0

        with self.assertRaises(RuntimeError):
            provider._write(stale)

        self.assertEqual(self.path.read_bytes(), retained)
        self.assertEqual(provider.state(), state)
        self.assertEqual(state["requests"], 2)
        self.assertGreater(state["unsettledEstimateUsd"], 0)

    def test_completion_settles_its_own_request_without_clobbering_later_hold(self):
        provider = self.provider(budget=1)
        transport = provider._http
        original_open = transport.open

        def reserve_another_attempt(request, timeout):
            if request.full_url.endswith("/chat/completions"):
                retained = self.ledger()
                estimate = retained["attempts"][-1]["estimateNanos"]
                retained["attempts"].append({"estimateNanos": estimate})
                retained["requests"] += 1
                retained["reservedNanos"] += estimate
                provider._write(retained)
            return original_open(request, timeout)

        with patch.object(transport, "open", side_effect=reserve_another_attempt):
            message, usage = provider.complete(MESSAGES, [])

        self.assertEqual(message["role"], "assistant")
        self.assertNotIn("cost_settlement_pending", usage)
        attempts = self.ledger()["attempts"]
        self.assertEqual(len(attempts), 2)
        self.assertEqual(attempts[0]["actualNanos"], 100_000)
        self.assertNotIn("actualNanos", attempts[1])
        state = provider.state()
        self.assertEqual(state["requests"], 2)
        self.assertAlmostEqual(state["unsettledEstimateUsd"], attempts[1]["estimateNanos"] / 1_000_000_000,
                               places=9)
        self.assertAlmostEqual(state["remainingUsd"], 1 - 0.0001 - state["unsettledEstimateUsd"], places=9)

    def test_full_journal_denies_before_dispatch_and_keeps_readable_history(self):
        provider = self.provider()
        provider.complete(MESSAGES, [])
        retained = self.path.read_bytes()
        original_admission = provider.admission.read_bytes()
        state = provider.state()
        calls = len(provider._http.calls)
        size_limit = max(len(retained), len(original_admission)) + 1

        with patch("provider._MAX_LEDGER", size_limit):
            with self.assertRaisesRegex(RuntimeError, "history is full"):
                provider.complete(MESSAGES, [])
            self.assertEqual(provider.state(), state)

        self.assertEqual(len(provider._http.calls), calls)
        self.assertEqual(self.path.read_bytes(), retained)
        self.assertEqual(provider.admission.read_bytes(), original_admission)
        self.assertEqual(self.provider().state(), state)


if __name__ == "__main__":
    unittest.main()

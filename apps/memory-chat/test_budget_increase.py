"""Retained total-ceiling changes; model transport is a labelled fixture."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import tempfile
from threading import Barrier
import unittest
import urllib.error

from provider import Provider
from test_provider import MESSAGES, Transport


class RetainedBudgetIncrease(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="chat-budget-increase-fixture-")
        self.root = Path(self.temporary.name)
        self.path = self.root / "allowance.json"

    def tearDown(self):
        self.temporary.cleanup()

    def provider(self, limit, *, transport=None, **kwargs):
        provider = Provider(self.path, limit, key="budget-fixture-only", **kwargs)
        provider._http = transport or Transport()
        return provider

    def file_bytes(self):
        return {str(path.relative_to(self.root)): path.read_bytes()
                for path in self.root.rglob("*") if path.is_file()}

    def test_raising_total_ceiling_preserves_consumption_admission_and_saved_data(self):
        first = self.provider(1)
        first.complete(MESSAGES, [])
        before = first.state()
        original_admission = first.admission.read_bytes()
        original_ledger = self.path.read_bytes()
        original_hash = json.loads(self.path.read_text())["policySha256"]
        memory = self.root / "memory" / "preference.md"
        memory.parent.mkdir()
        memory.write_text("Synthetic saved mug: Zephyr-472.\n")
        saved_memory = memory.read_bytes()

        raised = self.provider(10)

        self.assertEqual(raised.state()["limitUsd"], 10)
        self.assertEqual(raised.state()["requests"], before["requests"])
        self.assertEqual(raised.state()["reservedUsd"], before["reservedUsd"])
        self.assertAlmostEqual(raised.state()["remainingUsd"], before["remainingUsd"] + 9, places=9)
        self.assertEqual(raised.admission.read_bytes(), original_admission)
        self.assertEqual(self.path.read_bytes(), original_ledger)
        self.assertEqual(json.loads(self.path.read_text())["policySha256"], original_hash)
        grant = json.loads(self.path.with_name(self.path.name + ".limit-10000000000.json").read_text())
        self.assertEqual(grant, {"version": 1, "basePolicySha256": original_hash,
                                 "limitNanos": 10_000_000_000})
        self.assertEqual(memory.read_bytes(), saved_memory)
        self.assertEqual(raised._http.calls, [], "Changing a ceiling must not call a model or pricing endpoint.")

    def test_restarting_at_same_total_ceiling_does_not_add_another_grant(self):
        first = self.provider(1)
        first.complete(MESSAGES, [])
        raised = self.provider(10)
        raised.complete(MESSAGES, [])
        expected = raised.state()
        retained_files = self.file_bytes()

        restarted = self.provider(10)

        self.assertEqual(restarted.state(), expected)
        self.assertEqual(restarted.state()["limitUsd"], 10)
        self.assertEqual(self.file_bytes(), retained_files)
        self.assertEqual(restarted._http.calls, [])

    def test_simultaneous_same_ceiling_raises_retain_one_total_grant(self):
        first = self.provider(1)
        first.complete(MESSAGES, [])
        original_ledger = self.path.read_bytes()
        original_admission = first.admission.read_bytes()
        start = Barrier(2)

        def raise_ceiling():
            start.wait(timeout=5)
            return self.provider(10).state()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(raise_ceiling) for _ in range(2)]
            states = [future.result(timeout=10) for future in futures]

        self.assertEqual(states[0], states[1])
        self.assertEqual(states[0]["limitUsd"], 10)
        self.assertEqual(self.path.read_bytes(), original_ledger)
        self.assertEqual(first.admission.read_bytes(), original_admission)
        grants = list(self.root.glob(self.path.name + ".limit-*.json"))
        self.assertEqual([grant.name for grant in grants], [self.path.name + ".limit-10000000000.json"])

    def test_unknown_attempt_stays_reserved_after_raise_and_an_explicit_new_message(self):
        failed_transport = Transport(failure=urllib.error.URLError("private failed response"))
        first = self.provider(1, transport=failed_transport)
        with self.assertRaisesRegex(RuntimeError, "connection failed"):
            first.complete(MESSAGES, [])
        consumed = first.state()
        self.assertEqual(consumed["requests"], 1)
        self.assertGreater(consumed["reservedUsd"], 0)
        original_calls = len(failed_transport.calls)

        raised = self.provider(10)

        self.assertEqual(raised.state()["requests"], 1)
        self.assertEqual(raised.state()["reservedUsd"], consumed["reservedUsd"])
        self.assertEqual(raised._http.calls, [])
        raised.complete([{"role": "user", "content": "An explicit different message."}], [])
        self.assertEqual(raised.state()["requests"], 2)
        self.assertGreater(raised.state()["reservedUsd"], consumed["reservedUsd"])
        self.assertEqual(len(failed_transport.calls), original_calls)

    def test_exhausted_allowance_can_be_raised_without_refunding_prior_attempt(self):
        first = self.provider(0.03, transport=Transport(failure=urllib.error.URLError("unknown outcome")))
        with self.assertRaisesRegex(RuntimeError, "connection failed"):
            first.complete(MESSAGES, [])
        with self.assertRaisesRegex(RuntimeError, "allowance is exhausted"):
            first.complete(MESSAGES, [])
        consumed = first.state()

        raised = self.provider(10)

        self.assertEqual(raised.state()["requests"], consumed["requests"])
        self.assertEqual(raised.state()["reservedUsd"], consumed["reservedUsd"])
        raised.complete([{"role": "user", "content": "Continue only after explicit funding."}], [])
        self.assertEqual(raised.state()["requests"], consumed["requests"] + 1)

    def test_non_limit_policy_change_is_rejected_before_any_budget_mutation(self):
        first = self.provider(1)
        first.complete(MESSAGES, [])
        before = self.file_bytes()

        with self.assertRaisesRegex(RuntimeError, "policy"):
            self.provider(10, max_output_tokens=128)

        self.assertEqual(self.file_bytes(), before)
        self.assertEqual(json.loads(self.path.read_text())["requests"], 1)

    def test_grants_are_total_ceilings_and_not_added_together(self):
        first = self.provider(1)
        first.complete(MESSAGES, [])
        before = first.state()
        self.provider(2)
        raised = self.provider(10)
        self.assertEqual(raised.state()["limitUsd"], 10)
        self.assertEqual(raised.state()["reservedUsd"], before["reservedUsd"])
        self.assertAlmostEqual(raised.state()["remainingUsd"], before["remainingUsd"] + 9, places=9)

    def test_lower_ceiling_is_rejected_without_changing_prior_records(self):
        first = self.provider(1)
        first.complete(MESSAGES, [])
        self.provider(10)
        before = self.file_bytes()
        with self.assertRaisesRegex(RuntimeError, "lower|smaller|limit|budget|ceiling"):
            self.provider(1)
        self.assertEqual(self.file_bytes(), before)

    def test_active_chat_prevents_raising_its_ceiling(self):
        first = self.provider(1)
        first.complete(MESSAGES, [])
        (self.root / "chat.lock").write_text(str(os.getpid()))
        before = self.file_bytes()
        with self.assertRaisesRegex(RuntimeError, "[Ss]top|running|locked|active"):
            self.provider(10)
        self.assertEqual(self.file_bytes(), before)

    def test_corrupt_grant_is_rejected_without_changing_consumption(self):
        first = self.provider(1)
        first.complete(MESSAGES, [])
        self.provider(10)
        grant = self.path.with_name(self.path.name + ".limit-10000000000.json")
        self.assertTrue(grant.is_file())
        grant.write_text("{invalid grant")
        retained_ledger = self.path.read_bytes()
        retained_admission = first.admission.read_bytes()
        with self.assertRaises(RuntimeError):
            self.provider(10)
        self.assertEqual(self.path.read_bytes(), retained_ledger)
        self.assertEqual(first.admission.read_bytes(), retained_admission)

    def test_unsafe_grant_shapes_cannot_authorize_or_rewrite_the_allowance(self):
        first = self.provider(1)
        first.complete(MESSAGES, [])
        base_hash = json.loads(self.path.read_text())["policySha256"]
        grant = self.path.with_name(self.path.name + ".limit-10000000000.json")
        allowed = {"version": 1, "basePolicySha256": base_hash, "limitNanos": 10_000_000_000}
        invalid = [
            {**allowed, "basePolicySha256": "0" * 64},
            {**allowed, "version": 2},
            {**allowed, "limitNanos": True},
            {**allowed, "limitNanos": 9_000_000_000},
            {**allowed, "extra": "unexpected"},
        ]
        for value in invalid:
            with self.subTest(grant=value):
                grant.write_text(json.dumps(value))
                grant.chmod(0o600)
                retained = self.file_bytes()
                with self.assertRaises(RuntimeError):
                    self.provider(10)
                self.assertEqual(self.file_bytes(), retained)

    def test_symlinked_grant_cannot_authorize_a_raise(self):
        first = self.provider(1)
        first.complete(MESSAGES, [])
        base_hash = json.loads(self.path.read_text())["policySha256"]
        target = self.root / "untrusted-grant.json"
        target.write_text(json.dumps({"version": 1, "basePolicySha256": base_hash,
                                      "limitNanos": 10_000_000_000}))
        target.chmod(0o600)
        grant = self.path.with_name(self.path.name + ".limit-10000000000.json")
        grant.symlink_to(target)
        retained = self.path.read_bytes()

        with self.assertRaises(RuntimeError):
            self.provider(10)

        self.assertEqual(self.path.read_bytes(), retained)
        self.assertTrue(grant.is_symlink())

    def test_missing_grant_cannot_recover_a_counter_above_the_original_ceiling(self):
        first = self.provider(0.03, transport=Transport(failure=urllib.error.URLError("unknown outcome")))
        with self.assertRaises(RuntimeError):
            first.complete(MESSAGES, [])
        raised = self.provider(1, transport=Transport(failure=urllib.error.URLError("another unknown outcome")))
        with self.assertRaises(RuntimeError):
            raised.complete(MESSAGES, [])
        self.assertGreater(raised.state()["reservedUsd"], 0.03)
        grant = self.path.with_name(self.path.name + ".limit-1000000000.json")
        grant.unlink()
        retained = self.file_bytes()
        with self.assertRaises(RuntimeError):
            self.provider(1)
        self.assertEqual(self.file_bytes(), retained)

    def test_orphan_grant_cannot_initialize_a_fresh_allowance(self):
        first = self.provider(1)
        first.complete(MESSAGES, [])
        self.provider(10)
        self.path.unlink()
        first.admission.unlink()
        retained = self.file_bytes()
        with self.assertRaises(RuntimeError):
            self.provider(10)
        self.assertEqual(self.file_bytes(), retained)

    def test_known_cost_settlement_does_not_erase_cumulative_reservations(self):
        provider = self.provider(0.03)
        for _ in range(3):
            provider.complete(MESSAGES, [])
        state = provider.state()
        self.assertEqual(state["requests"], 3)
        self.assertGreater(state["reservedUsd"], 0.03)
        self.assertAlmostEqual(state["remainingUsd"], 0.03 - 3 * 0.0001, places=9)
        restarted = self.provider(0.03)
        self.assertEqual(restarted.state(), state)

    def test_legacy_counter_remains_fully_committed_during_raise_and_future_settlement(self):
        first = self.provider(1)
        first.complete(MESSAGES, [])
        record = json.loads(self.path.read_text())
        legacy = {key: record[key] for key in ["policySha256", "reservedNanos", "requests"]}
        self.path.write_text(json.dumps(legacy))
        retained = self.path.read_bytes()

        raised = self.provider(10)

        self.assertEqual(self.path.read_bytes(), retained)
        expected_remaining = 10 - legacy["reservedNanos"] / 1_000_000_000
        self.assertAlmostEqual(raised.state()["remainingUsd"], expected_remaining, places=9)
        raised.complete([{"role": "user", "content": "A newly settled explicit request."}], [])
        self.assertEqual(raised.state()["requests"], legacy["requests"] + 1)
        self.assertAlmostEqual(raised.state()["remainingUsd"], expected_remaining - 0.0001, places=9)

    def test_invalid_settlement_cannot_reopen_or_reset_the_allowance(self):
        provider = self.provider(1)
        provider.complete(MESSAGES, [])
        record = json.loads(self.path.read_text())
        self.assertTrue(record["attempts"])
        record["attempts"][-1]["actualNanos"] = -1
        self.path.write_text(json.dumps(record))
        retained = self.file_bytes()

        with self.assertRaises(RuntimeError):
            self.provider(10)

        self.assertEqual(self.file_bytes(), retained)


if __name__ == "__main__":
    unittest.main()

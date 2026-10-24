"""Labelled adapter fixtures. No engine or model acceptance claims."""
import sched
import sys
import threading
from pathlib import Path
import unittest
from unittest.mock import Mock

from openclaw_memory_bridge import FoundationError, MaintenanceJob, MemoryScope, MemoryTools

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "examples"))
from host_maintenance import schedule_runs
from host_agent import HostAgent


class ToolsTests(unittest.TestCase):
    def setUp(self):
        self.memory = Mock()
        self.memory.write.return_value = {"path": "memory/preference.md", "needsIndex": True}
        self.memory.index.return_value = {"indexed": True}
        self.scope = MemoryScope("lab", "maya", "first")
        self.tools = MemoryTools(self.memory, self.scope, "2026-10-17")

    def test_host_scope_cannot_be_selected_in_model_arguments(self):
        for args in [{"text": "Synthetic", "scope": "other"}, {"text": 3}, {}]:
            with self.assertRaises(ValueError):
                self.tools.execute("memory_save", args)
        self.assertEqual(self.memory.mock_calls, [])
        other = MemoryScope("lab", "noor", "first")
        self.tools.execute("memory_search", {"query": "Synthetic"})
        MemoryTools(self.memory, other, "2026-10-17").execute("memory_search", {"query": "Synthetic"})
        self.assertEqual([call.args[0] for call in self.memory.search.call_args_list], [self.scope, other])
        self.assertNotEqual(self.scope.routing_workspace, other.routing_workspace)
        definitions = self.tools.definitions
        definitions[0]["function"]["name"] = "modified"
        self.assertEqual(self.tools.definitions[0]["function"]["name"], "memory_search")

    def test_repeated_save_uses_one_canonical_target_and_indexes_each_success(self):
        for _ in range(2):
            result = self.tools.execute("memory_save", {"text": "Synthetic current fact"})
            self.assertTrue(result["index"]["indexed"])
        self.assertEqual(self.memory.write.call_count, 2)
        self.memory.write.assert_called_with(self.scope, "preference", "Synthetic current fact")
        self.assertEqual(self.memory.index.call_count, 2)

    def test_write_and_index_failures_are_not_success_receipts(self):
        self.memory.write.side_effect = FoundationError("write failed")
        with self.assertRaises(FoundationError):
            self.tools.execute("memory_save", {"text": "Synthetic"})
        self.memory.index.assert_not_called()
        self.memory.write.side_effect = None
        self.memory.index.side_effect = FoundationError("index failed")
        with self.assertRaises(FoundationError):
            self.tools.execute("memory_save", {"text": "Synthetic"})
        self.memory.index.side_effect = None
        self.assertTrue(self.tools.execute("memory_save", {"text": "Synthetic"})["index"]["indexed"])

    def test_host_returns_malformed_tool_arguments_as_failure_to_model(self):
        provider = Mock()
        provider.complete.side_effect = [
            ({"role": "assistant", "content": None, "tool_calls": [
                {"id": "fixture-call", "type": "function", "function": {
                    "name": "memory_save", "arguments": "{"}}]}, None),
            ({"role": "assistant", "content": "The write failed."}, None),
        ]
        agent = HostAgent(provider, self.memory, self.scope, "2026-10-17")
        self.assertEqual(agent.turn("Synthetic fixture"), "The write failed.")
        result = agent.trace[0]["calls"][0]["results"][0]["result"]
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "invalid_tool")
        self.assertEqual(self.memory.mock_calls, [])

    def test_job_releases_guard_on_failure_and_rejects_overlap(self):
        job = MaintenanceJob(self.memory, self.scope)
        self.memory.run_maintenance.side_effect = FoundationError("fixture failure")
        with self.assertRaises(FoundationError):
            job()
        entered, release = threading.Event(), threading.Event()
        def pending(scope):
            entered.set()
            if not release.wait(3):
                raise RuntimeError("test synchronization timeout")
            return {"native": "fixture"}
        self.memory.run_maintenance.side_effect = pending
        worker = threading.Thread(target=job)
        worker.start()
        try:
            self.assertTrue(entered.wait(3))
            with self.assertRaisesRegex(RuntimeError, "already running"):
                job()
        finally:
            release.set()
            worker.join(3)
        self.assertFalse(worker.is_alive())
        self.assertEqual(job(), {"native": "fixture"})

    def test_finite_host_schedule_and_no_automatic_retry(self):
        clock = [0.0]
        scheduler = sched.scheduler(lambda: clock[0], lambda delay: clock.__setitem__(0, clock[0] + delay))
        job = Mock(return_value={"native": "fixture"})
        self.assertEqual(len(schedule_runs(job, count=2, interval_seconds=10, scheduler=scheduler)), 2)
        self.assertEqual(clock[0], 10)
        job.side_effect = FoundationError("fixture failure")
        with self.assertRaises(FoundationError):
            schedule_runs(job, count=2, scheduler=scheduler)
        self.assertTrue(scheduler.empty())
        self.assertEqual(job.call_count, 3)
        for invalid in [0, float("nan"), float("inf")]:
            with self.assertRaises(ValueError):
                schedule_runs(job, interval_seconds=invalid)

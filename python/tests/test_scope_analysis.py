"""Evidence analysis controls using synthetic files only; no native/model calls."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


ROOT = Path(os.environ["FOUNDATION_ROOT"])
spec = importlib.util.spec_from_file_location("scope_analysis", ROOT / "examples/scope-diagnosis/analyze.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ScopeAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="scope-analysis-")
        self.addCleanup(self.temp.cleanup)
        self.case = Path(self.temp.name)
        self.manifest = {"workspace/memory/day.md": "a" * 64}
        self.result = {
            "beforeNative": dict(self.manifest), "beforeSdk": dict(self.manifest),
            "snapshotManifest": dict(self.manifest), "eligibility": {"passes": {"origin": True}},
        }

    def analyze(self, result=None, events=(), continuation=None):
        (self.case / "result.json").write_text(json.dumps(self.result if result is None else result))
        (self.case / "scope-events.jsonl").write_text("".join(json.dumps(event) + "\n" for event in events))
        if continuation is not None:
            (self.case / "continuation.json").write_text(json.dumps(continuation))
        return module.analyze(self.case)

    def events(self, route="sdk", rejected=True):
        kinds = ["create", "narrative-queue", "narrative-start", "narrative-completion-enter"]
        kinds += ["drain-start", "begin-close", "closed", "tracker-capture", "track-use", "reject-track", "narrative-completion-error"] if rejected else ["tracker-capture", "track-use", "drain-start", "begin-close", "closed"]
        events = []
        phase = "open"
        for sequence, kind in enumerate(kinds, 1):
            if kind == "closed":
                phase = "closed"
            event = {"run": route, "pid": 123, "threadId": 0, "sequence": sequence,
                     "scope": "123:0:1", "owner": "123:0:1", "phase": phase,
                     "kind": kind, "stack": "Error: scope diagnostic\n  at syntheticControl"}
            if kind.startswith("narrative"):
                event["narrativePhase"] = "deep"
            if kind in ("reject-track", "narrative-completion-error"):
                event["exceptionStack"] = "Error: Async work scope is closed\n  at syntheticControl"
            events.append(event)
        return events

    def test_absent_empty_and_invalid_manifests_fail_closed(self):
        for invalid in [None, {}, [], "not a manifest", {"day.md": "not a digest"}, {"": "a" * 64}]:
            with self.subTest(invalid=invalid):
                result = copy.deepcopy(self.result)
                for key in ("beforeNative", "beforeSdk", "snapshotManifest"):
                    result[key] = invalid
                self.assertFalse(self.analyze(result)["identicalSnapshotBytes"])
        self.assertFalse(self.analyze({})["identicalSnapshotBytes"])

    def test_one_invalid_or_mismatched_manifest_is_not_a_match(self):
        for changed in [{}, {"workspace/memory/day.md": "b" * 64}]:
            with self.subTest(changed=changed):
                result = copy.deepcopy(self.result)
                result["beforeSdk"] = changed
                analysis = self.analyze(result)
                self.assertFalse(analysis["identicalSnapshotBytes"])
                self.assertEqual(analysis["evidenceStatus"], "incomplete")

    def test_empty_eligibility_checks_are_not_success(self):
        for passes in [{}, {"origin": 1}, {"origin": False}]:
            with self.subTest(passes=passes):
                result = copy.deepcopy(self.result)
                result["eligibility"] = {"passes": passes}
                self.assertFalse(self.analyze(result)["eligibleBeforeDispatch"])

    def test_missing_files_and_empty_trace_are_explicitly_incomplete(self):
        missing = module.analyze(self.case)
        self.assertIsNone(missing["eventTraceSha256"])
        self.assertEqual(missing["evidenceStatus"], "incomplete")
        empty = self.analyze()
        self.assertTrue(empty["identicalSnapshotBytes"])
        self.assertEqual(empty["eventCount"], 0)
        self.assertEqual(empty["runs"]["sdk"]["status"], "missing-evidence")
        self.assertIn("scope-events.jsonl: no usable events", empty["missingEvidence"])

    def test_malformed_records_do_not_produce_a_complete_verdict(self):
        self.analyze()
        (self.case / "result.json").write_text("[]")
        (self.case / "scope-events.jsonl").write_text('not JSON\n{"run":"sdk"}\n')
        result = module.analyze(self.case)
        self.assertEqual(result["evidenceStatus"], "incomplete")
        self.assertFalse(result["identicalSnapshotBytes"])
        self.assertEqual(result["eventCount"], 0)

    def test_rejection_requires_the_exact_deep_completion_boundary(self):
        events = [event for event in self.events() if event["kind"] != "narrative-completion-enter"]
        sdk = self.analyze(events=events)["runs"]["sdk"]
        self.assertEqual(sdk["status"], "incomplete-rejection-evidence")
        self.assertIn("deep completion boundary owner", sdk["missingEvidence"])
        self.assertFalse(sdk["rejections"][0]["ownershipChainComplete"])

    def test_complete_synthetic_chain_does_not_resolve_original_cause(self):
        events = self.events("native") + self.events("sdk")
        result = self.analyze(events=events)
        self.assertEqual(result["evidenceStatus"], "available")
        self.assertEqual(result["runs"]["sdk"]["status"], "rejection-observed")
        self.assertTrue(result["runs"]["sdk"]["rejections"][0]["ownershipChainComplete"])
        self.assertFalse(result["originalCauseResolved"])
        self.assertIsNone(result["originalFailureNotOverwritten"])
        self.assertEqual(result["originalFailurePreservation"]["status"], "unverified")

    def test_missing_creation_or_drain_stack_is_incomplete(self):
        for kind in ("create", "drain-start"):
            with self.subTest(kind=kind):
                events = self.events()
                next(event for event in events if event["kind"] == kind).pop("stack")
                sdk = self.analyze(events=events)["runs"]["sdk"]
                self.assertFalse(sdk["rejections"][0]["ownershipChainComplete"])

    def test_cross_process_events_cannot_supply_missing_owner_anchors(self):
        events = self.events()
        next(event for event in events if event["kind"] == "create")["pid"] = 999
        result = self.analyze(events=events)
        self.assertIn("scope creation stack", result["runs"]["sdk"]["missingEvidence"])

    def test_formatted_error_message_is_not_a_rejection_stack(self):
        events = self.events()
        next(event for event in events if event["kind"] == "reject-track")["exceptionStack"] = "Error: Async work scope is closed"
        result = self.analyze(events=events)
        self.assertIn("native rejection stack", result["runs"]["sdk"]["missingEvidence"])

    def test_healthy_continuation_is_reported_separately(self):
        continuation = {"restoredSnapshot": dict(self.manifest), "runs": {"sdk": {"maintenance": {
            "sweep": {"completionStatus": "succeeded"},
            "publishers": {phase: "completed" for phase in ("light", "rem", "deep")},
        }}}}
        result = self.analyze(events=self.events("sdk-continuation", rejected=False), continuation=continuation)
        route = result["runs"]["sdk-continuation"]
        self.assertEqual(route["status"], "healthy-continuation-observed")
        self.assertEqual(route["eventCount"], 9)
        self.assertEqual(route["rejections"], [])
        self.assertFalse(result["originalCauseResolved"])

    def test_absent_publisher_receipts_are_not_a_healthy_continuation(self):
        result = self.analyze(events=self.events("sdk-continuation", rejected=False),
                              continuation={"restoredSnapshot": dict(self.manifest)})
        route = result["runs"]["sdk-continuation"]
        self.assertEqual(route["status"], "no-rejection-observed")
        self.assertIn("completed publisher receipts", route["missingEvidence"])

    def test_continuation_snapshot_must_match_the_native_baseline(self):
        continuation = {"restoredSnapshot": {"workspace/memory/day.md": "b" * 64}}
        route = self.analyze(events=self.events("sdk-continuation", rejected=False),
                             continuation=continuation)["runs"]["sdk-continuation"]
        self.assertEqual(route["status"], "missing-evidence")
        self.assertIn("continuation snapshot matches native baseline", route["missingEvidence"])

    def test_completion_error_prevents_a_healthy_continuation_verdict(self):
        continuation = {"restoredSnapshot": dict(self.manifest), "runs": {"sdk": {"maintenance": {
            "sweep": {"completionStatus": "succeeded"},
            "publishers": {phase: "completed" for phase in ("light", "rem", "deep")},
        }}}}
        events = self.events("sdk-continuation", rejected=False)
        events.append({**events[-1], "sequence": 10, "kind": "narrative-completion-error", "narrativePhase": "deep"})
        route = self.analyze(events=events, continuation=continuation)["runs"]["sdk-continuation"]
        self.assertEqual(route["status"], "missing-evidence")
        self.assertIn("deep completion error without a scope rejection", route["missingEvidence"])

    def test_out_of_order_trace_is_flagged_without_reordering_evidence(self):
        events = self.events()
        events[0], events[1] = events[1], events[0]
        result = self.analyze(events=events)
        self.assertEqual(result["evidenceStatus"], "incomplete")
        self.assertEqual(result["runs"]["sdk"]["narrativeEvents"][0]["sequence"], 2)
        self.assertTrue(any("non-increasing sequence" in issue for issue in result["missingEvidence"]))


if __name__ == "__main__":
    unittest.main()

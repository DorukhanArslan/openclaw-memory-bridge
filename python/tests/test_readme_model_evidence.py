"""MODEL cases audit retained genuine provider evidence. They send no model requests.
Missing records are skipped. An evidence audit is not a fresh model acceptance.
"""
import json
import os
from pathlib import Path
import unittest


class RecordedNativeModelCases(unittest.TestCase):
    def record(self, relative):
        path = Path(os.environ["FOUNDATION_ROOT"]) / relative
        if not path.is_file():
            self.skipTest("Historical genuine-model record is not available; do not substitute a mock.")
        return json.loads(path.read_text())

    def lifecycle(self):
        return self.record("evidence/lifecycle-acceptance/acceptance.json")

    def merge(self):
        return self.record("evidence/provenance-merge-acceptance/acceptance.json")

    def test_MODEL_01_recorded_semantic_recall(self):
        """MODEL-01: actual embeddings recalled a source without shared query words."""
        d = self.record("evidence/live-smoke/acceptance.json")
        self.assertEqual(d["embedding_model"], "openai/text-embedding-3-small")
        self.assertEqual(d["semantic_query"], "pedal-powered commuting")
        self.assertEqual(d["recall"]["path"], "memory/resident.md")
        self.assertGreater(d["recall"]["hits"], 0)
        self.assertTrue(d["source_get"]["passed"])
        self.assertIn("bicycle", d["source_get"]["verified_text"])
        self.assertEqual(d["smoke_exit_code"], 0)

    def test_MODEL_02_recorded_native_model_extraction(self):
        """MODEL-02: genuine conversation produced a daily note; app did not prewrite it."""
        d = self.lifecycle()
        self.assertEqual(d["mode"], "real-provider/native-lifecycle")
        self.assertEqual(d["beforeConversation"], {})
        self.assertEqual(d["afterFirstConversation"], {})
        self.assertEqual(d["stages"]["chat"], "pass")
        self.assertEqual(d["stages"]["extraction"], "pass")
        self.assertEqual(d["secondConversation"]["completion"]["status"], "ok")
        self.assertIn("indigo", d["dailySource"]["text"])
        self.assertIn(d["dailySource"]["path"], d["afterFlush"])

    def test_MODEL_03_recorded_successful_flush_and_source(self):
        """MODEL-03: flush marker + physical source + recall, not config alone."""
        d = self.lifecycle()
        self.assertEqual(d["stages"]["flush"], "pass")
        self.assertEqual(d["secondConversation"]["state"]["nativeMaintenance"]["memoryFlush"]["kind"], "succeeded")
        self.assertIn("indigo", d["afterFlush"][d["dailySource"]["path"]])
        for recall in d["recallBeforeDreaming"]:
            self.assertTrue(any(h["path"] == d["dailySource"]["path"] for h in recall["results"]))

    def test_MODEL_04_recorded_compaction_commit(self):
        """MODEL-04: committed native summary; no promise that the SDK compacts chats."""
        d = self.lifecycle()
        self.assertEqual(d["stages"]["compaction"], "pass")
        self.assertTrue(d["compaction"]["native"]["compacted"])
        self.assertTrue(d["compaction"]["native"]["result"]["summary"])
        self.assertGreaterEqual(d["compaction"]["state"]["nativeMaintenance"]["compactionCount"], 1)

    def test_MODEL_05_recorded_native_duplicate_merge(self):
        """MODEL-05: valid native rewrite, matching source and preserved session."""
        d = self.merge()
        self.assertTrue(all(v == "pass" for v in d["stages"].values()))
        before, after = d["before"]["MEMORY.md"], d["after"]["MEMORY.md"]
        self.assertNotEqual(before, after)
        fact = "Synthetic Project Vega uses amber filters every Friday"
        self.assertEqual(after.count(fact), 1)
        self.assertIn("Source: memory/2026-10-11.md#L1-L1", after)
        self.assertIn("openclaw-memory-promotion:", after)
        diary = d["after"]["DREAMS.md"]
        for field, count in [("Added", 0), ("Merged", 1), ("Superseded", 0)]:
            self.assertRegex(diary, field + r":\s+" + str(count))
        for fact in ["silver notebooks", "paper charts", "brass clocks", "white folders"]:
            self.assertIn(fact, before)
            self.assertIn(fact, after)
        self.assertEqual(d["sourceSession"]["session"]["sessionId"], d["sessionAfterRestart"]["session"]["sessionId"])
        self.assertTrue(any(h["path"] == "MEMORY.md" for h in d["recallAfterRestart"]["results"]))
        self.assertFalse(any("consolidation" in line and "fallback" in line for line in d["nativeDiagnostics"]))
        self.assertLess(d["afterBudget"]["usedUsd"], 5)

    def test_MODEL_06_recorded_complete_model_diary(self):
        """MODEL-06: all native diary publishers finished without fallback."""
        d = self.merge()
        self.assertEqual(d["stages"]["modelDiary"], "pass")
        for phase in ["light", "rem", "deep"]:
            self.assertTrue(any("dream diary entry written for " + phase + " phase" in line for line in d["nativeDiagnostics"]))
        self.assertFalse(any("narrative generation failed" in line or "narrative generation used fallback" in line for line in d["nativeDiagnostics"]))
        self.assertGreater(len(d["after"]["DREAMS.md"]), 100)
        self.assertLessEqual(d["requestLedger"]["requests"], d["limits"]["requests"])
        self.assertLessEqual(d["requestLedger"]["outputTokens"], d["limits"]["outputTokens"])

    def test_MODEL_07_changed_fact_supersession_not_verified(self):
        """MODEL-07: explicit coverage gap; never pass by replacing an app file."""
        self.skipTest("Changed-fact supersession requires matching native lineage. No accepted case or SDK trigger is verified.")


if __name__ == "__main__":
    unittest.main()

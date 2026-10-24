"""Report regression: later success must not erase the original failure."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "examples/parity"))
from report import render


class ParityReportTests(unittest.TestCase):
    def test_closeout_preserves_original_failure_and_escapes_check_text(self):
        root = Path(__file__).resolve().parents[2]
        record = json.loads((root / "reports/native-sdk-parity.json").read_text())
        self.assertFalse(record["ok"])
        self.assertFalse(record["runs"]["sdk"]["checks"]["allPublishersCompleted"])
        record["closeout"] = {
            "date": "2026-10-23", "usageUsd": 0.66064142,
            "checks": [{"name": "<script>fixture</script>", "result": "passed"}],
            "diaryAudit": {"controlledRuns": 36},
        }
        original = copy.deepcopy(record)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "report.html"
            render(record, path)
            result = path.read_text()
        self.assertEqual(record, original)
        self.assertIn("19 of 20 checks passed", result)
        self.assertIn("UNRESOLVED / observed failure", result)
        self.assertIn("It used no production SDK fix", result)
        self.assertIn("&lt;script&gt;fixture&lt;/script&gt;", result)
        self.assertNotIn("<script>fixture</script>", result)
        self.assertIn("Diary diagnosis and retained history", result)
        self.assertIn("Six deliberately closed-owner cases wrote native fallback", result)
        self.assertIn("It does not establish the original cause or an SDK defect", result)
        self.assertNotIn("<p><p>", result)


if __name__ == "__main__":
    unittest.main()

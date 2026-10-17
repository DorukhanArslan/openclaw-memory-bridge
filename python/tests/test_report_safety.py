"""Report serialization fixtures; no model or engine execution."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

class ReportSafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("host_report", Path(os.environ["FOUNDATION_ROOT"]) / "examples/host_agent.py")
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def test_nested_known_paths_preserve_source_citations_and_facts(self):
        raw = {"path": "/Users/test/work/data/space/memory/note.md", "nested": [{"text": "lemon; Source: memory/note.md#L1-L2", "trace": "/Users/test/work/foundation/src/lab.ts"}], "count": 4, "/Users/test/work/data/native.json": "diagnostic"}
        clean = self.module.sanitize_report(raw, foundation="/Users/test/work/foundation", state="/Users/test/work/data")
        self.assertEqual(clean["path"], "<state>/space/memory/note.md")
        self.assertEqual(clean["nested"][0]["trace"], "<foundation>/src/lab.ts")
        self.assertEqual(clean["nested"][0]["text"], raw["nested"][0]["text"])
        self.assertEqual(clean["count"], 4)
        self.assertEqual(clean["<state>/native.json"], "diagnostic")
        self.assertIn("/Users/", raw["path"])

    def test_renderer_redacts_legacy_metadata_and_escapes_model_text(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "report.html"
            self.module.render({"ok":False,"conversation":[{"user":"synthetic", "reply":"<script>bad</script>", "calls":[{"receipt":"/home/runner/work/example/state.json"}]}]}, output)
            html = output.read_text()
            self.assertNotIn("/home/runner", html)
            self.assertNotIn("<script>", html)
            self.assertIn("&lt;script&gt;", html)

    def test_main_failure_serializes_both_formats_after_redaction(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            foundation, state, report = root / "foundation", root / "state", root / "report.json"
            memory = MagicMock()
            memory.configure_maintenance.side_effect = RuntimeError(f"Synthetic failure at {foundation}/src/lab.ts and {state}/native.db")
            factory = MagicMock()
            factory.return_value.__enter__.return_value = memory
            argv = ["agent.py", "--foundation", str(foundation), "--root", str(state), "--report", str(report)]
            with patch.object(sys, "argv", argv), patch.object(self.module, "Provider"), patch.object(self.module, "MemoryClient", factory), patch("builtins.print"):
                self.assertEqual(self.module.main(), 2)
            result = json.loads(report.read_text())
            self.assertFalse(result["ok"])
            self.assertIn("<foundation>/src/lab.ts", result["error"])
            for output in [report, report.with_suffix(".html")]:
                self.assertNotIn(str(foundation), output.read_text())
                self.assertNotIn(str(state), output.read_text())

if __name__=="__main__": unittest.main()

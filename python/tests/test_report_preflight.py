"""Synthetic input-preflight controls, never genuine model-evidence fixtures."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(os.environ["FOUNDATION_ROOT"])
BUILDERS = {
    "build_maya_maintenance_report.py": ["maya-maintenance-2026-10-13/acceptance.json"],
    "build_conversation_report.py": [
        "e2e-conversation/conversation.json", "e2e-conversation/sdk-recall.json",
        "e2e-conversation/request-ledger.json",
    ],
    "build_memory_story.py": [
        "lifecycle-acceptance/acceptance.json", "provenance-merge-acceptance/acceptance.json",
        "live-smoke/acceptance.json",
    ],
}


class ReportPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="report-input-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.foundation = self.base / "checkout"
        for folder in ["scripts", "examples", "reports"]:
            (self.foundation / folder).mkdir(parents=True)
        shutil.copy2(ROOT / "scripts/evidence_status.py", self.foundation / "scripts")
        for name in BUILDERS:
            shutil.copy2(ROOT / "examples" / name, self.foundation / "examples")
        for name in [
            "maya-maintenance.json", "chatbot-memory-demo.json", "maya-app-cases.json",
            "memory-capabilities.json", "memory-case-coverage.json", "memory-story.json",
        ]:
            (self.foundation / "reports" / name).write_text(json.dumps({"sentinel": name}))
        (self.foundation / "reports/chatbot-memory-demo.html").write_text("<main>Original report</main>")
        (self.foundation / "README.md").write_text("Synthetic input-preflight fixture only.")

    def snapshot(self):
        return {p.name: p.read_bytes() for p in (self.foundation / "reports").iterdir()}

    def run_builder(self, name, evidence_root=None):
        environment = dict(os.environ)
        environment.pop("BRIDGE_EVIDENCE_ROOT", None)
        if evidence_root is not None:
            environment["BRIDGE_EVIDENCE_ROOT"] = str(evidence_root)
        return subprocess.run(
            [sys.executable, str(self.foundation / "examples" / name)],
            cwd=self.base, env=environment, capture_output=True, text=True,
            timeout=10,
        )

    def test_missing_inputs_are_listed_before_any_report_changes(self):
        before = self.snapshot()
        for name, inputs in BUILDERS.items():
            with self.subTest(builder=name):
                result = self.run_builder(name)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Missing or invalid required JSON inputs", result.stderr)
                self.assertNotIn("Traceback", result.stderr)
                for relative in inputs:
                    self.assertIn(str(self.foundation / "evidence" / relative), result.stderr)
                self.assertEqual(self.snapshot(), before)

    def test_external_evidence_root_is_used_consistently(self):
        external = self.base / "preserved-records"
        before = self.snapshot()
        for name, inputs in BUILDERS.items():
            with self.subTest(builder=name):
                result = self.run_builder(name, external)
                self.assertNotEqual(result.returncode, 0)
                for relative in inputs:
                    self.assertIn(str(external / relative), result.stderr)
                self.assertNotIn(str(self.foundation / "evidence"), result.stderr)
                self.assertEqual(self.snapshot(), before)

    def test_malformed_input_is_not_rendered_or_echoed(self):
        path = self.foundation / "evidence/maya-maintenance-2026-10-13/acceptance.json"
        path.parent.mkdir(parents=True)
        sentinel = "PRIVATE_SYNTHETIC_INPUT_SENTINEL"
        path.write_text('{"broken": "' + sentinel)
        before = self.snapshot()
        result = self.run_builder("build_maya_maintenance_report.py")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid-json", result.stderr)
        self.assertNotIn(sentinel, result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_story_requires_base_html_before_constructing_outputs(self):
        for relative in BUILDERS["build_memory_story.py"]:
            path = self.foundation / "evidence" / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("{}")
        template = self.foundation / "reports/chatbot-memory-demo.html"
        for content in [None, "<body>No main element</body>"]:
            with self.subTest(template=content):
                if content is None:
                    template.unlink()
                else:
                    template.write_text(content)
                before = self.snapshot()
                result = self.run_builder("build_memory_story.py")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Report", result.stderr)
                self.assertNotIn("Traceback", result.stderr)
                self.assertEqual(self.snapshot(), before)

    def test_invalid_optional_story_input_fails_before_outputs(self):
        for relative in BUILDERS["build_memory_story.py"]:
            path = self.foundation / "evidence" / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("{}")
        (self.foundation / "reports/host-agent-memory.json").write_text("not JSON")
        before = self.snapshot()
        result = self.run_builder("build_memory_story.py")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("host-agent-memory.json: invalid-json", result.stderr)
        self.assertEqual(self.snapshot(), before)


if __name__ == "__main__":
    unittest.main()

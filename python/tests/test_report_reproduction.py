"""Retained reports reproduce without setup, live acceptance, or source writes."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SOURCES = (
    "scripts/render_reports.py", "scripts/render-test-report.py",
    "examples/host_agent.py", "examples/host_maintenance.py",
    "examples/residence_acceptance.py", "examples/parity/report.py",
)
REPORTS = {
    "test-report": "test-rounds", "host-agent-memory": "host-agent-memory",
    "residence-memory": "residence-memory", "native-sdk-parity": "native-sdk-parity",
}


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ReportReproductionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bridge-report-reproduction-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.foundation = self.base / "checkout"
        self.cwd = self.base / "other-cwd"
        self.cwd.mkdir()
        for relative in SOURCES:
            target = self.foundation / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, target)
        shutil.copytree(ROOT / "python/src/openclaw_memory_bridge",
                        self.foundation / "python/src/openclaw_memory_bridge",
                        ignore=shutil.ignore_patterns("__pycache__"))
        (self.foundation / "reports").mkdir()
        for stem, source in REPORTS.items():
            for name in [source + ".json", stem + ".html"]:
                shutil.copy2(ROOT / "reports" / name, self.foundation / "reports" / name)
        self.output = self.base / "rendered"

    def run_wrapper(self, output=None):
        return subprocess.run(
            [sys.executable, "-I", str(self.foundation / "scripts/render_reports.py"),
             "--foundation", str(self.foundation), "--output-dir", str(output or self.output)],
            cwd=self.cwd, capture_output=True, text=True,
        )

    def hashes(self):
        return {path.name: hashlib.sha256(path.read_bytes()).hexdigest()
                for path in (self.foundation / "reports").iterdir()}

    def test_clean_checkout_reproduction_is_exact_and_deterministic(self):
        before = self.hashes()
        self.assertFalse((self.foundation / "node_modules").exists())
        self.assertFalse((self.foundation / "evidence").exists())
        self.assertFalse((self.foundation / ".env").exists())
        for _ in range(2):
            result = self.run_wrapper()
            self.assertEqual(result.returncode, 0, result.stderr)
            summary = json.loads(result.stdout)
            self.assertEqual(summary["kind"], "retained-record-render")
            self.assertEqual(summary["liveModelCalls"], 0)
            self.assertEqual(len(summary["outputs"]), 4)
            for stem in REPORTS:
                self.assertEqual((self.output / (stem + ".html")).read_bytes(),
                                 (self.foundation / "reports" / (stem + ".html")).read_bytes())
            self.assertEqual(self.hashes(), before)

    def test_missing_invalid_and_unrenderable_records_leave_outputs_unchanged(self):
        source = self.foundation / "reports/native-sdk-parity.json"
        before = source.read_bytes()
        self.output.mkdir()
        sentinel = self.output / "test-report.html"
        sentinel.write_text("Existing output must survive a failed render.")
        for bad in [None, b"{invalid", b"[]", b"{}"]:
            with self.subTest(record=bad):
                if bad is None:
                    source.unlink()
                else:
                    source.write_bytes(bad)
                result = self.run_wrapper()
                self.assertEqual(result.returncode, 2)
                self.assertIn("Cannot reproduce retained reports", result.stderr)
                self.assertEqual([path.name for path in self.output.iterdir()], [sentinel.name])
                self.assertEqual(sentinel.read_text(), "Existing output must survive a failed render.")
                source.write_bytes(before)

    def test_failed_render_does_not_create_output_directory(self):
        (self.foundation / "reports/native-sdk-parity.json").write_text("{}")
        result = self.run_wrapper()
        self.assertEqual(result.returncode, 2)
        self.assertFalse(self.output.exists())

    def test_canonical_directory_and_symlink_alias_are_refused(self):
        before = self.hashes()
        alias = self.base / "reports-alias"
        alias.symlink_to(self.foundation / "reports", target_is_directory=True)
        for output in [self.foundation / "reports", alias]:
            with self.subTest(output=output):
                result = self.run_wrapper(output)
                self.assertEqual(result.returncode, 2)
                self.assertIn("canonical reports must be preserved", result.stderr)
                self.assertEqual(self.hashes(), before)

    def test_linked_output_files_are_refused(self):
        self.output.mkdir()
        target = self.output / "test-report.html"
        original = self.foundation / "reports/test-report.html"
        before = self.hashes()
        for kind in ["symlink", "hardlink"]:
            with self.subTest(kind=kind):
                if kind == "symlink":
                    target.symlink_to(original)
                else:
                    os.link(original, target)
                try:
                    result = self.run_wrapper()
                    self.assertEqual(result.returncode, 2)
                    self.assertIn("independent regular file", result.stderr)
                    self.assertEqual(self.hashes(), before)
                finally:
                    target.unlink()

    def test_test_report_import_is_read_only_and_render_preserves_input(self):
        target = self.foundation / "reports/test-report.html"
        target.write_text("Do not regenerate during import.")
        module = load(self.foundation / "scripts/render-test-report.py", "pure_test_report")
        self.assertEqual(target.read_text(), "Do not regenerate during import.")
        rounds = json.loads((self.foundation / "reports/test-rounds.json").read_text())
        before = copy.deepcopy(rounds)
        self.assertEqual(module.render(rounds).encode(), (ROOT / "reports/test-report.html").read_bytes())
        self.assertEqual(rounds, before)

    def test_existing_record_renderers_do_not_mutate_input(self):
        previous_path = sys.path[:]
        try:
            sys.path[:0] = [str(self.foundation / "examples"), str(self.foundation / "python/src")]
            for stem, relative in [
                ("host-agent-memory", "examples/host_agent.py"),
                ("residence-memory", "examples/residence_acceptance.py"),
                ("native-sdk-parity", "examples/parity/report.py"),
            ]:
                with self.subTest(stem=stem):
                    module = load(self.foundation / relative, "unchanged_" + stem.replace("-", "_"))
                    record = json.loads((self.foundation / "reports" / (stem + ".json")).read_text())
                    before = copy.deepcopy(record)
                    module.render(record, self.base / (stem + ".html"))
                    self.assertEqual(record, before)
        finally:
            sys.path[:] = previous_path

    def test_test_report_cli_keeps_default_and_supports_output_overrides(self):
        script = self.foundation / "scripts/render-test-report.py"
        canonical = self.foundation / "reports/test-report.html"
        expected = canonical.read_bytes()
        canonical.write_text("Default output is regenerated only by explicit CLI execution.")
        for flags, target in [
            (["--output", str(self.base / "specific.html")], self.base / "specific.html"),
            (["--output-dir", str(self.output)], self.output / "test-report.html"),
            ([], canonical),
        ]:
            with self.subTest(flags=flags):
                result = subprocess.run([sys.executable, "-I", str(script), *flags],
                                        cwd=self.cwd, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(target.read_bytes(), expected)

    def test_test_report_cli_rejects_input_aliases_and_linked_outputs(self):
        script = self.foundation / "scripts/render-test-report.py"
        source = self.foundation / "reports/test-rounds.json"
        other = self.foundation / "reports/host-agent-memory.html"
        before = self.hashes()
        target = self.base / "linked-output.html"
        for kind, original in [
            ("hardlink", source), ("symlink", source),
            ("hardlink", other), ("symlink", other),
        ]:
            with self.subTest(kind=kind, original=original.name):
                if kind == "hardlink":
                    os.link(original, target)
                else:
                    target.symlink_to(original)
                try:
                    result = subprocess.run(
                        [sys.executable, "-I", str(script), "--output", str(target)],
                        cwd=self.cwd, capture_output=True, text=True,
                    )
                    self.assertEqual(result.returncode, 2)
                    self.assertIn("Cannot render retained test report", result.stderr)
                    self.assertEqual(self.hashes(), before)
                finally:
                    target.unlink()


if __name__ == "__main__":
    unittest.main()

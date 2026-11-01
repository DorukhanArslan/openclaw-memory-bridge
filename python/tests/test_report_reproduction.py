"""Retained reports reproduce without setup, live acceptance, or source writes."""
import copy
import hashlib
import importlib.util
import json
import os
from html.parser import HTMLParser
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import quote, unquote


ROOT = Path(__file__).resolve().parents[2]
SOURCES = (
    "scripts/render_reports.py", "scripts/render-test-report.py",
    "examples/host_agent.py", "examples/host_maintenance.py",
    "examples/residence_acceptance.py", "examples/parity/report.py",
    "examples/conversation_report.py",
)
REPORTS = {
    "test-report": "test-rounds", "host-agent-memory": "host-agent-memory",
    "residence-memory": "residence-memory", "native-sdk-parity": "native-sdk-parity",
    "chatbot-memory-demo": "chatbot-memory-demo",
}
# SHA-256 of the five retained HTML views before generated pages left Git.
# These independent snapshots preserve the complete historical views without
# keeping generated HTML as source fixtures.
HTML_HASHES = {
    "test-report": "87cbf1f78915a01146323aa7368bb65bc1708a85667afba45e7e12124848648d",
    "host-agent-memory": "b809498cd9377439a16b7471d4d3ddb205af2c16f0b87f5673c5ef1144eab2b1",
    "residence-memory": "d69ee284346fd5818fe1b7cf04e9e04f8077aa5e01305ce219d44ecc42b10642",
    "native-sdk-parity": "7a35e07bf41eb52e262e68b822ecf4f979268fd758df33eade8414f20fca29d9",
    "chatbot-memory-demo": "fd2cfea1af9593dc6b61857984c547f90d52effeb728d4539772de01260ffd1a",
}
SOURCE_LINKS = {
    "../README.md": "README.md",
    "chatbot-memory-demo.json": "reports/chatbot-memory-demo.json",
    "memory-capabilities.json": "reports/memory-capabilities.json",
    "memory-story.json": "reports/memory-story.json",
}


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.links.extend(value for name, value in attrs if name == "href")


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
        (self.foundation / "README.md").write_text("Synthetic checkout description.")
        for source in [*REPORTS.values(), "memory-story", "conversation-validation", "memory-capabilities"]:
            name = source + ".json"
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
        self.assertEqual(list((self.foundation / "reports").glob("*.html")), [])
        for _ in range(2):
            result = self.run_wrapper()
            self.assertEqual(result.returncode, 0, result.stderr)
            summary = json.loads(result.stdout)
            self.assertEqual(summary["kind"], "retained-record-render")
            self.assertEqual(summary["liveModelCalls"], 0)
            self.assertEqual(len(summary["outputs"]), 5)
            for stem in REPORTS:
                page = (self.output / (stem + ".html")).read_text()
                if stem == "chatbot-memory-demo":
                    for original, relative in SOURCE_LINKS.items():
                        rebased = quote(os.path.relpath(self.foundation / relative, self.output), safe="/")
                        page = page.replace(f'href="{rebased}"', f'href="{original}"')
                self.assertEqual(hashlib.sha256(page.encode()).hexdigest(),
                                 HTML_HASHES[stem])
            self.assertEqual(self.hashes(), before)

    def test_generated_links_resolve_from_arbitrary_output_directory(self):
        self.output = self.base / "a directory with spaces" / "nested"
        result = self.run_wrapper()
        self.assertEqual(result.returncode, 0, result.stderr)
        parser = LinkParser()
        parser.feed((self.output / "chatbot-memory-demo.html").read_text())
        destinations = {(self.output / unquote(link)).resolve() for link in parser.links}
        expected = {self.foundation / relative for relative in SOURCE_LINKS.values()}
        expected.add(self.output / "test-report.html")
        self.assertEqual(destinations, expected)
        self.assertTrue(all(path.is_file() for path in destinations))

    def test_missing_invalid_and_unrenderable_records_leave_outputs_unchanged(self):
        self.output.mkdir()
        sentinel = self.output / "test-report.html"
        sentinel.write_text("Existing output must survive a failed render.")
        for name in ["native-sdk-parity", "chatbot-memory-demo", "memory-story", "conversation-validation"]:
            source = self.foundation / "reports" / (name + ".json")
            before = source.read_bytes()
            for bad in [None, b"{invalid", b"[]", b"{}"]:
                with self.subTest(source=name, record=bad):
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
        original = self.foundation / "reports/test-rounds.json"
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
        self.assertEqual(hashlib.sha256(module.render(rounds).encode()).hexdigest(), HTML_HASHES["test-report"])
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

    def test_conversation_render_is_pure_and_retains_historical_boundaries(self):
        before_files = self.hashes()
        module = load(self.foundation / "examples/conversation_report.py", "pure_conversation_report")
        records = [json.loads((self.foundation / "reports" / (name + ".json")).read_text())
                   for name in ["chatbot-memory-demo", "memory-story", "conversation-validation"]]
        original = copy.deepcopy(records)
        page = module.render(*records)
        self.assertEqual(hashlib.sha256(page.encode()).hexdigest(), HTML_HASHES["chatbot-memory-demo"])
        self.assertIn("preserved historical results", page)
        self.assertIn("rejected adapter path; native get and Python search evidence retained", page)
        self.assertIn("Automatic flush was not observed", page)
        self.assertEqual(records, original)
        self.assertEqual(self.hashes(), before_files)
        self.assertFalse(self.output.exists())

    def test_conversation_render_escapes_supplied_conversation_and_case_text(self):
        module = load(self.foundation / "examples/conversation_report.py", "safe_conversation_report")
        records = [json.loads((self.foundation / "reports" / (name + ".json")).read_text())
                   for name in ["chatbot-memory-demo", "memory-story", "conversation-validation"]]
        script = "<script>synthetic report text</script>"
        records[0]["steps"][0]["bot"] = script
        records[1]["cases"][0]["title"] = script
        original = copy.deepcopy(records)
        page = module.render(*records)
        self.assertNotIn(script, page)
        self.assertIn("&lt;script&gt;synthetic report text&lt;/script&gt;", page)
        self.assertEqual(records, original)

    def test_test_report_cli_defaults_to_ignored_directory_and_supports_overrides(self):
        script = self.foundation / "scripts/render-test-report.py"
        canonical = self.foundation / "reports/test-report.html"
        canonical.write_text("Source directory must survive CLI rendering.")
        for flags, target in [
            (["--output", str(self.base / "specific.html")], self.base / "specific.html"),
            (["--output-dir", str(self.output)], self.output / "test-report.html"),
            ([], self.foundation / ".bootstrap/rendered-reports/test-report.html"),
        ]:
            with self.subTest(flags=flags):
                result = subprocess.run([sys.executable, "-I", str(script), *flags],
                                        cwd=self.cwd, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(), HTML_HASHES["test-report"])
                self.assertEqual(canonical.read_text(), "Source directory must survive CLI rendering.")

    def test_test_report_cli_rejects_input_aliases_and_linked_outputs(self):
        script = self.foundation / "scripts/render-test-report.py"
        source = self.foundation / "reports/test-rounds.json"
        other = self.foundation / "reports/host-agent-memory.json"
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

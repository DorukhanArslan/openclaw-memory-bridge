"""Synthetic loader fixtures only; these tests do not establish model behavior."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(os.environ["FOUNDATION_ROOT"])
SCRIPT = ROOT / "scripts/evidence_status.py"
spec = importlib.util.spec_from_file_location("test_evidence_status_helper", SCRIPT)
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)


class EvidenceStatusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="evidence-loader-fixture-")
        self.root = Path(self.temp.name)
        self.env = patch.dict(os.environ, {"BRIDGE_EVIDENCE_ROOT": "", "BRIDGE_REQUIRE_MODEL_EVIDENCE": "0"})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def write_json(self, relative, value):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))
        return path

    def test_inventory_maps_three_missing_records_to_six_cases(self):
        status = evidence.evidence_status(self.root)
        self.assertFalse(status["complete"])
        self.assertEqual(len(status["inputs"]), 3)
        self.assertEqual([item["status"] for item in status["inputs"]], ["missing"] * 3)
        self.assertEqual([case for item in status["inputs"] for case in item["cases"]], [f"MODEL-0{i}" for i in range(1, 7)])
        self.assertEqual(status["unsupportedCases"], ["MODEL-07"])
        self.assertEqual(status["modelCalls"], 0)
        self.assertFalse((self.root / "evidence").exists())

    def test_explicit_and_environment_roots_preserve_the_legacy_relative_path(self):
        os.environ["BRIDGE_EVIDENCE_ROOT"] = str(self.root / "external")
        expected = self.root / "external/live-smoke/acceptance.json"
        self.assertEqual(evidence.evidence_path(ROOT, "evidence/live-smoke/acceptance.json"), expected)
        self.assertEqual(evidence.evidence_path(ROOT, "live-smoke/acceptance.json"), expected)
        override = self.root / "override"
        self.assertEqual(evidence.evidence_path(ROOT, "evidence/live-smoke/acceptance.json", evidence_root=override), override / "live-smoke/acceptance.json")
        for relative in ["../outside.json", "/outside.json"]:
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                evidence.evidence_path(ROOT, relative)

    def test_missing_is_distinct_from_invalid_or_unreadable_present_records(self):
        missing = self.root / "evidence/live-smoke/acceptance.json"
        with self.assertRaises(evidence.MissingEvidenceError) as caught:
            evidence.load_record(self.root, "evidence/live-smoke/acceptance.json")
        self.assertIn(str(missing), str(caught.exception))
        for value in [None, [], "synthetic scalar"]:
            self.write_json("evidence/live-smoke/acceptance.json", value)
            with self.subTest(value=value), self.assertRaises(evidence.EvidenceInputError):
                evidence.load_record(self.root, "evidence/live-smoke/acceptance.json")
        missing.write_text("not JSON: SYNTHETIC_PRIVATE_PAYLOAD")
        with self.assertRaises(evidence.EvidenceInputError) as caught:
            evidence.load_record(self.root, "evidence/live-smoke/acceptance.json")
        self.assertNotIn("SYNTHETIC_PRIVATE_PAYLOAD", str(caught.exception))
        with patch.object(Path, "read_text", side_effect=PermissionError("synthetic unreadable input")):
            with self.assertRaises(evidence.EvidenceInputError):
                evidence.load_record(self.root, "evidence/live-smoke/acceptance.json")

    def test_report_preflight_aggregates_inputs_and_accepts_arrays_without_writes(self):
        valid = self.write_json("rounds.json", [{"fixture": "synthetic loader only"}])
        self.assertEqual(evidence.require_json_inputs([valid]), {valid: [{"fixture": "synthetic loader only"}]})
        malformed = self.root / "malformed.json"
        malformed.write_text("not JSON: SYNTHETIC_PRIVATE_PAYLOAD")
        scalar = self.write_json("scalar.json", 3)
        absent = self.root / "absent.json"
        before = set(self.root.iterdir())
        with self.assertRaises(evidence.EvidenceInputError) as caught:
            evidence.require_json_inputs([valid, malformed, scalar, absent])
        message = str(caught.exception)
        for path in [malformed, scalar, absent]:
            self.assertIn(str(path), message)
        self.assertNotIn("SYNTHETIC_PRIVATE_PAYLOAD", message)
        self.assertEqual(set(self.root.iterdir()), before)

    def test_cli_optional_and_required_availability_are_not_acceptance(self):
        for args, expected in [([], 0), (["--require-complete"], 1)]:
            output = io.StringIO()
            with self.subTest(args=args), contextlib.redirect_stdout(output):
                self.assertEqual(evidence.main(["--foundation", str(self.root), "--json", *args]), expected)
            self.assertFalse(json.loads(output.getvalue())["complete"])
        for relative, _ in evidence.MODEL_INPUTS:
            self.write_json("external/" + relative, {"synthetic_loader_fixture": "DO_NOT_PRINT_PAYLOAD"})
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = evidence.main(["--foundation", str(ROOT), "--evidence-root", str(self.root / "external"), "--require-complete", "--json"])
        self.assertEqual(code, 0)
        self.assertTrue(json.loads(output.getvalue())["complete"])
        self.assertIn("not model acceptance", output.getvalue())
        self.assertNotIn("DO_NOT_PRINT_PAYLOAD", output.getvalue())
        self.write_json("external/live-smoke/acceptance.json", [])
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(evidence.main(["--evidence-root", str(self.root / "external"), "--json"]), 1)

    def test_strict_flag_rejects_ambiguous_configuration(self):
        for value in ["", "0", "1"]:
            self.assertEqual(evidence.model_evidence_required({"BRIDGE_REQUIRE_MODEL_EVIDENCE": value}), value == "1")
        with self.assertRaises(ValueError):
            evidence.model_evidence_required({"BRIDGE_REQUIRE_MODEL_EVIDENCE": "yes"})

    def test_subprocess_optional_skips_and_strict_fails_without_provider_calls(self):
        # No fake acceptance records are supplied. Only the missing-input policy
        # is exercised in the real historical audit runner.
        env = os.environ.copy()
        env.update(FOUNDATION_ROOT=str(ROOT), BRIDGE_EVIDENCE_ROOT=str(self.root / "absent"))
        command = [sys.executable, "-m", "unittest", "discover", "-s", str(ROOT / "python/tests"), "-p", "test_readme_model_evidence.py", "-v"]
        env["BRIDGE_REQUIRE_MODEL_EVIDENCE"] = "0"
        optional = subprocess.run(command, env=env, capture_output=True, text=True, timeout=15)
        self.assertEqual(optional.returncode, 0, optional.stderr)
        self.assertIn("OK (skipped=7)", optional.stderr)
        for relative, _ in evidence.MODEL_INPUTS:
            self.assertIn(str(self.root / "absent" / relative), optional.stderr)
        env["BRIDGE_REQUIRE_MODEL_EVIDENCE"] = "1"
        strict = subprocess.run(command, env=env, capture_output=True, text=True, timeout=15)
        self.assertEqual(strict.returncode, 1, strict.stderr)
        self.assertIn("FAILED (failures=6, skipped=1)", strict.stderr)
        self.assertIn("MODEL-07", strict.stderr)


if __name__ == "__main__":
    unittest.main()

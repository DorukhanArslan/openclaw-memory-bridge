"""Stable README acceptance cases. These use an installed SDK and real no-key OpenClaw."""
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from openclaw_memory_bridge import BridgeConfig, FoundationError, MemoryClient, MemoryScope


class ReadmeSDKCases(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="readme-sdk-case-")
        self.root = Path(self.temp.name)
        self.foundation = Path(os.environ["FOUNDATION_ROOT"])
        self.config = BridgeConfig(self.foundation, self.root)
        self.scope = MemoryScope("observatory", "alex", "first")
        self.client = MemoryClient(self.config)

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def note_file(self, scope=None):
        return self.root / (scope or self.scope).routing_workspace / "workspace/memory/filters.md"

    def seed(self, text="Synthetic Vega uses cobalt filters on Tuesday."):
        result = self.client.write(self.scope, "filters", text)
        self.assertEqual(result["path"], "memory/filters.md")
        self.assertTrue(result["needsIndex"])
        self.assertIn(text, self.note_file().read_text())
        self.client.index(self.scope)

    def test_SDK_00_install_connect_creates_no_memory_notes(self):
        """SDK-00: wheel import/connect; no auto-created MD, no model required."""
        self.assertEqual(importlib.metadata.version("openclaw-memory-bridge"), "0.1.0")
        self.assertEqual(self.client.engine, {"name": "openclaw", "version": "2026.9.9"})
        self.assertEqual(list(self.root.rglob("*.md")), [])

    def test_SDK_01_write_keyword_recall_and_agent_prompt(self):
        """SDK-01: exact end-to-end README example. Prompt is app output, not model execution."""
        spec = importlib.util.spec_from_file_location("readme_quickstart", self.foundation / "examples/readme_quickstart.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result = module.prepare_agent_prompt(self.client, self.scope)
        self.assertEqual(result["provider"], "none")
        self.assertTrue(any(h["path"] == "memory/filters.md" for h in result["sources"]))
        self.assertIn("cobalt", self.note_file().read_text())
        self.assertIn("cobalt", result["agent_prompt"])
        self.assertIn("memory/filters.md", result["agent_prompt"])
        for source in result["sources"]:
            reference = f"[{source['path']}:L{source['startLine']}-L{source['endLine']}]"
            self.assertIn(reference, result["agent_prompt"])
        self.assertEqual(self.client.search(self.scope, "unrecordedword")["results"], [])

    def test_SDK_02_get_source_and_line_range(self):
        """SDK-02: retrieve cited source and reject invalid ranges/paths."""
        self.seed()
        hit = self.client.search(self.scope, "cobalt")["results"][0]
        self.assertGreaterEqual(hit["startLine"], 1)
        self.assertGreaterEqual(hit["endLine"], hit["startLine"])
        source = self.client.get(self.scope, hit["path"], start=hit["startLine"], lines=hit["endLine"] - hit["startLine"] + 1)
        self.assertEqual(source["status"], "ok")
        self.assertIn("cobalt", source["text"])
        for kwargs in [{"start":0}, {"lines":201}]:
            with self.assertRaises(FoundationError):
                self.client.get(self.scope, "memory/filters.md", **kwargs)
        with self.assertRaises(FoundationError):
            self.client.get(self.scope, "../outside.md")

    def test_SDK_03_update_removes_stale_keyword(self):
        """SDK-03: app-owned source update; not native lineage supersession."""
        self.seed()
        self.client.write(self.scope, "filters", "Synthetic Vega uses amber filters on Friday.")
        self.client.index(self.scope)
        self.assertNotIn("cobalt", self.note_file().read_text())
        self.assertIn("amber", self.client.get(self.scope, "memory/filters.md")["text"])
        self.assertTrue(self.client.search(self.scope, "amber")["results"])
        self.assertEqual(self.client.search(self.scope, "cobalt")["results"], [])

    def test_SDK_04_delete_and_missing_delete_error(self):
        """SDK-04: source removal + reindex; not backup erasure."""
        self.seed()
        self.client.delete(self.scope, "filters")
        self.assertFalse(self.note_file().exists())
        self.client.index(self.scope)
        self.assertEqual(self.client.search(self.scope, "cobalt")["results"], [])
        with self.assertRaises(FoundationError) as caught:
            self.client.delete(self.scope, "filters")
        self.assertEqual(caught.exception.code, "engine_error")

    def test_SDK_05_gateway_host_and_new_session_persistence(self):
        """SDK-05: same scope/root across real restarts and a different session."""
        self.seed()
        original = self.note_file().read_bytes()
        later = MemoryScope("observatory", "alex", "later")
        self.assertEqual(later.routing_workspace, self.scope.routing_workspace)
        self.assertTrue(self.client.restart(self.scope)["restarted"])
        self.assertTrue(self.client.search(later, "cobalt")["results"])
        self.client.close()
        self.client = MemoryClient(self.config)
        self.assertTrue(self.client.search(later, "cobalt")["results"])
        self.assertEqual(self.note_file().read_bytes(), original)

    def test_SDK_06_user_workspace_route_separation(self):
        """SDK-06: separate real corpora; no authentication/security claim."""
        self.seed()
        for other in [MemoryScope("observatory", "sam", "first"), MemoryScope("separate", "alex", "first")]:
            self.assertNotEqual(other.routing_workspace, self.scope.routing_workspace)
            self.client.index(other)
            self.assertEqual(self.client.search(other, "cobalt")["results"], [])
            self.assertFalse(self.note_file(other).exists())
            self.client.write(other, "filters", "Synthetic Orion uses saffron filters on Monday.")
            self.client.index(other)
            self.assertIn("saffron", self.note_file(other).read_text())
            self.assertTrue(self.client.search(other, "saffron")["results"])
            self.assertEqual(self.client.search(other, "cobalt")["results"], [])
            self.assertEqual(self.client.search(self.scope, "saffron")["results"], [])
        self.assertTrue(self.client.search(self.scope, "cobalt")["results"])
        with self.assertRaises(ValueError):
            MemoryScope("../outside", "alex", "first")

    def test_SDK_07_fixture_history_state_and_native_reset_capture(self):
        """SDK-07: native lifecycle hook from a labelled fixture; no model extraction."""
        with self.assertRaises(FoundationError):
            self.client.reset_session(self.scope)
        self.client.configure(self.scope, ingestion=True)
        fixture = self.client.inject_fixture(self.scope, "Synthetic fixture: Vega records charts on copper paper.")
        self.assertFalse(fixture["modelExecuted"])
        self.assertIn("copper", json.dumps(self.client.session_history(self.scope)))
        before = self.client.session_state(self.scope)
        session_id = before["session"]["sessionId"]
        self.assertEqual(before["nativeMaintenance"]["compactionCount"], 0)
        capture = self.client.reset_session(self.scope)
        self.assertEqual(capture["native"], "session-memory hook")
        self.assertFalse(capture["modelSummary"])
        self.assertIn(session_id, capture["content"])
        self.assertIn("agent:main:first", capture["content"])
        path = self.root / self.scope.routing_workspace / "workspace" / capture["captured"]
        self.assertTrue(path.is_file())
        self.assertIn("copper", self.client.get(self.scope, capture["captured"])["text"])
        self.assertTrue(self.client.search(self.scope, "copper")["results"])
        # Native reset need not allocate a new logical UUID. Verify routing and
        # captured-source identity instead of inventing an identity guarantee.
        self.assertEqual(self.client.session_state(self.scope)["session"]["key"], "agent:main:first")

    def test_SDK_08_status_diary_are_inspection_not_generation(self):
        """SDK-08: configure hook, inspect native status; no implicit dreaming or MD."""
        self.client.configure(self.scope, ingestion=False)
        self.assertIn('"provider": "none"', json.dumps(self.client.status(self.scope)))
        status = self.client.dream_status(self.scope)
        self.assertFalse(status["dreaming"]["enabled"])
        diary = self.client.dream_diary(self.scope)
        self.assertEqual(diary.get("content", ""), "")
        self.assertEqual(list((self.root / self.scope.routing_workspace / "workspace").rglob("*.md")), [])

    def test_SDK_09_invalid_operation_input_preserves_valid_note(self):
        """SDK-09: engine errors remain distinct from a successful empty recall."""
        self.seed()
        original = self.note_file().read_bytes()
        with self.assertRaises(FoundationError) as caught:
            self.client.call("unsupported", self.scope.routing_workspace)
        self.assertEqual(caught.exception.code, "invalid_request")
        for invalid in ["../escape", ""]:
            with self.assertRaises(FoundationError):
                self.client.write(self.scope, invalid, "Synthetic invalid request")
        with self.assertRaises(FoundationError):
            self.client.search(self.scope, " ")
        self.assertEqual(self.note_file().read_bytes(), original)
        self.assertTrue(self.client.search(self.scope, "cobalt")["results"])


if __name__ == "__main__":
    unittest.main()

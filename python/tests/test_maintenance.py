"""Public adapter contracts. These tests do not call models or mock recall."""
import unittest
from unittest.mock import Mock
from openclaw_memory_bridge import MemoryClient, MemoryScope

class MaintenanceContract(unittest.TestCase):
    def setUp(self):
        self.client = object.__new__(MemoryClient)
        self.client.call = Mock(return_value={"native": "receipt"})
        self.scope = MemoryScope("garden", "maya", "session")

    def test_daily_is_explicit_replace_not_native_flush(self):
        self.client.write_daily(self.scope, "2026-10-13", "Synthetic event")
        self.client.call.assert_called_once_with("write_daily", self.scope.routing_workspace, day="2026-10-13", text="Synthetic event")
        self.assertFalse(hasattr(self.client, "flush"))
        self.assertFalse(hasattr(self.client, "chat"))

    def test_config_preserves_budget_and_scope(self):
        self.client.configure_maintenance(self.scope, cumulative_limit_usd=50, host_reserve_usd=12)
        self.client.call.assert_called_once_with("configure_maintenance", self.scope.routing_workspace, cumulativeLimitUsd=50, hostReserveUsd=12)

    def test_run_routes_user_corpus_not_external_agent_session(self):
        self.assertEqual(self.client.run_maintenance(self.scope), {"native": "receipt"})
        self.client.call.assert_called_once_with("run_maintenance", self.scope.routing_workspace)
        self.assertEqual(self.scope.routing_workspace, MemoryScope("garden", "maya", "new-session").routing_workspace)
        self.assertNotEqual(self.scope.routing_workspace, MemoryScope("garden", "noor", "session").routing_workspace)

if __name__ == "__main__":
    unittest.main()

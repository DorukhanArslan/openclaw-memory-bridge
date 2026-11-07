"""Background native startup checks with labelled SDK fixtures, no inference."""
from __future__ import annotations

from pathlib import Path
import tempfile
import threading
import time
import unittest

from server import DemoJobs, NativeChatDemo
from test_native_chat import (BrokerFixture, FOUNDATION, PublicNativeFixture,
                              RetainedProviderFixture)


class WarmupPeer(PublicNativeFixture):
    def __init__(self):
        super().__init__()
        self.history_entered = threading.Event()
        self.history_release = threading.Event()
        self.history_error = None

    def client(self, config):
        client = super().client(config)

        def session_history(scope):
            self.operations.append(("session_history", scope))
            self.history_entered.set()
            if not self.history_release.wait(3):
                raise RuntimeError("Fixture history read was not released.")
            if self.history_error:
                raise RuntimeError(self.history_error)
            return {"sessionKey": "agent:main:explicit:" + scope.session,
                    "messages": self.transcripts.get(scope.session, [])}

        client.session_history = session_history
        return client


class StartupWarmup(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="native-startup-warmup-fixture-")
        self.root = Path(self.temporary.name)
        self.native = WarmupPeer()
        self.provider = RetainedProviderFixture()
        self.demo = self.make_demo()

    def make_demo(self, *, client_factory=None):
        return NativeChatDemo(FOUNDATION, self.root, self.provider,
                              client_factory=client_factory or self.native.client,
                              broker_factory=BrokerFixture)

    def tearDown(self):
        self.native.history_release.set()
        self.demo.close()
        if self.demo._warmup_thread is not None:
            self.demo._warmup_thread.join(timeout=3)
        self.temporary.cleanup()

    def wait_finished(self):
        self.demo._warmup_thread.join(timeout=3)
        self.assertFalse(self.demo._warmup_thread.is_alive())

    def test_warmup_is_one_read_only_start_and_cached_state_stays_responsive(self):
        before = self.provider.state()
        self.assertEqual(self.native.clients, [])
        self.demo.start_warmup()
        self.assertTrue(self.native.history_entered.wait(2))
        started = time.monotonic()
        for _ in range(30):
            state = self.demo.state()
            self.assertEqual(state["memory"]["connection"]["status"], "starting")
            self.assertEqual(state["conversation"]["messages"], [])
        self.assertLess(time.monotonic() - started, 0.2)
        self.demo.start_warmup()
        self.assertEqual(len(self.native.clients), 1)
        self.assertEqual([op[0] for op in self.native.operations],
                         ["configure_chat", "session_history"])
        self.assertEqual(self.demo.broker.windows, 0)
        self.assertEqual(self.provider.state(), before)
        self.assertEqual(self.demo.turns, [])
        self.native.history_release.set()
        self.wait_finished()
        self.assertEqual(self.demo.state()["memory"]["connection"]["status"], "ready")
        self.assertEqual(self.demo.conversation["messages"], [])
        self.assertFalse(self.demo.conversation.get("native", {}).get("transcriptPersisted"))
        self.assertEqual(self.demo.broker.windows, 0)
        self.demo.start_warmup()
        self.assertEqual(len(self.native.clients), 1)

    def test_first_chat_waits_for_warmup_and_reuses_its_client(self):
        self.demo.start_warmup()
        self.assertTrue(self.native.history_entered.wait(2))
        jobs = DemoJobs(self.demo)
        accepted = jobs.submit("chat", {"message": "A labelled first-turn fixture."})
        self.assertTrue(accepted["busy"])
        self.assertFalse(any(op[0] == "chat" for op in self.native.operations))
        self.assertEqual(len(self.native.clients), 1)
        self.native.history_release.set()
        self.wait_finished()
        jobs.worker.join(timeout=3)
        self.assertFalse(jobs.worker.is_alive())
        state = self.demo.state()
        self.assertEqual(state["job"]["status"], "completed", state["job"])
        self.assertEqual(len(self.native.clients), 1)
        names = [op[0] for op in self.native.operations]
        self.assertEqual(names.count("configure_chat"), 1)
        self.assertEqual(names.count("session_history"), 1)
        self.assertEqual(names.count("chat"), 1)
        self.assertLess(names.index("session_history"), names.index("chat"))
        self.assertEqual(self.demo.broker.windows, 1)
        self.assertEqual(state["conversation"]["messages"][-1]["role"], "assistant")

    def test_disabled_or_stopped_host_does_not_start_native_work(self):
        self.provider.ready = False
        self.demo.start_warmup()
        self.assertIsNone(self.demo._warmup_thread)
        self.assertEqual(self.native.clients, [])
        self.assertEqual(self.demo.state()["memory"]["connection"]["status"], "idle")
        self.provider.ready = True
        self.demo.request_stop()
        self.demo.start_warmup()
        self.assertIsNone(self.demo._warmup_thread)
        self.assertEqual(self.native.clients, [])

    def test_failure_is_visible_and_only_a_later_explicit_chat_reopens(self):
        self.native.history_error = "Controlled startup failure under " + str(self.root)
        self.native.history_release.set()
        self.demo.start_warmup()
        self.wait_finished()
        connection = self.demo.state()["memory"]["connection"]
        self.assertEqual(connection["status"], "failed")
        self.assertIn("Controlled startup failure", connection["error"])
        self.assertNotIn(str(self.root), connection["error"])
        self.assertTrue(self.native.clients[0].closed)
        self.assertIsNone(self.demo.memory)
        self.assertEqual(self.demo.broker.windows, 0)
        self.demo.start_warmup()
        self.assertEqual(len(self.native.clients), 1)
        self.native.history_error = None
        self.demo.chat("An explicit message after startup failed.")
        self.assertEqual(len(self.native.clients), 2)
        self.assertEqual(self.demo.state()["memory"]["connection"]["status"], "ready")
        self.assertEqual(self.demo.broker.windows, 1)
        self.assertEqual([op[0] for op in self.native.operations].count("session_history"), 1)

    def test_stop_during_client_construction_closes_it_without_followup_reads(self):
        self.demo.close()
        constructed, release = threading.Event(), threading.Event()

        def delayed_client(config):
            constructed.set()
            if not release.wait(3):
                raise RuntimeError("Fixture constructor was not released.")
            return self.native.client(config)

        self.demo = self.make_demo(client_factory=delayed_client)
        self.demo.start_warmup()
        self.assertTrue(constructed.wait(2))
        closed = threading.Thread(target=self.demo.close)
        closed.start()
        try:
            self.assertTrue(self.demo._stopping.wait(2))
            self.assertTrue(closed.is_alive())
        finally:
            release.set()
            closed.join(timeout=3)
        self.wait_finished()
        self.assertFalse(closed.is_alive())
        self.assertTrue(self.demo.closed)
        self.assertEqual(len(self.native.clients), 1)
        self.assertTrue(self.native.clients[0].closed)
        self.assertEqual([op[0] for op in self.native.operations], ["close"])
        self.assertFalse((self.root / "chat.lock").exists())


if __name__ == "__main__":
    unittest.main()

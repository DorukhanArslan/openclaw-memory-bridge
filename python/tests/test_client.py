"""Client transport tests with a labelled protocol fixture. No engine claims."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from dataclasses import replace
from openclaw_memory_bridge import BridgeConfig, FoundationError, MemoryClient, MemoryScope


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="sdk-protocol-fixture-")
        self.root = Path(self.temp.name)
        foundation = Path(os.environ["FOUNDATION_ROOT"])
        node = self.root / "node_modules/node/bin/node"
        node.parent.mkdir(parents=True)
        node.symlink_to(foundation / "node_modules/node/bin/node")
        (self.root / "src").mkdir()
        (self.root / "src/stdio.ts").write_text('''
import { createInterface } from 'node:readline';
console.log(JSON.stringify({v:1,event:'ready',engine:{name:'protocol fixture'}}));
for await(const line of createInterface({input:process.stdin})) {
 const r=JSON.parse(line);
 if(r.op==='timeout') {await new Promise(resolve=>setTimeout(resolve,5000));continue;}
 if(r.op==='malformed') {console.log('not-json');continue;}
 if(r.op==='mismatch') {console.log(JSON.stringify({v:1,id:'wrong',ok:true,result:{}}));continue;}
 if(r.op==='bad-error') {console.log(JSON.stringify({v:1,id:r.id,ok:false,error:'bad'}));continue;}
 if(r.op==='error') {console.log(JSON.stringify({v:1,id:r.id,ok:false,error:{code:'invalid_request',message:'Unsupported operation.'}}));continue;}
 console.log(JSON.stringify({v:1,id:r.id,ok:true,result:{fixture:true}}));
 if(r.op==='shutdown') {process.stdin.destroy();break;}
}
''')
        self.config = BridgeConfig(self.root, self.root / "data", timeout=0.1)

    def tearDown(self):
        self.temp.cleanup()

    def test_scope_routes_distinct_user_and_workspace_pairs(self):
        a = MemoryScope("a-b", "c", "one")
        b = MemoryScope("a", "b-c", "one")
        self.assertNotEqual(a.routing_workspace, b.routing_workspace)
        self.assertEqual(a.routing_workspace, MemoryScope("a-b", "c", "two").routing_workspace)
        with self.assertRaises(ValueError):
            MemoryScope("../outside", "alex", "one")

    def test_structured_error_keeps_stream_usable(self):
        with MemoryClient(self.config) as client:
            with self.assertRaises(FoundationError) as caught:
                client.call("error")
            self.assertEqual(caught.exception.code, "invalid_request")
            self.assertTrue(client.call("valid")["fixture"])
            with self.assertRaises(FoundationError):
                client.call("valid", text="x" * 128000)
            self.assertTrue(client.call("valid")["fixture"])

    def test_maintenance_receipt_timeout_covers_the_native_envelope(self):
        # A labelled echo fixture checks transport policy without waiting for
        # minutes or dispatching a native/model operation.
        for configured in [0.1, 3600]:
            with self.subTest(configured=configured):
                with MemoryClient(replace(self.config, timeout=configured)) as client:
                    with patch.object(client, "_receive", wraps=client._receive) as receive:
                        self.assertTrue(client.call("run_maintenance")["fixture"])
                        allowed = receive.call_args.args[0]
                        self.assertGreaterEqual(allowed, 120 + 10 * 120 + 210 + 90 + 120 + 25 + 100)
                        self.assertGreaterEqual(allowed, configured)
                        receive.reset_mock()
                        self.assertTrue(client.call("valid")["fixture"])
                        receive.assert_called_once_with(configured)
                    self.assertFalse(client.poisoned)

    def test_uncertain_transport_poisoning(self):
        for operation in ["timeout", "malformed", "mismatch", "bad-error"]:
            with self.subTest(operation=operation):
                with MemoryClient(self.config) as client:
                    with self.assertRaises(FoundationError):
                        client.call(operation)
                    with self.assertRaises(FoundationError) as caught:
                        client.call("valid")
                    self.assertEqual(caught.exception.code, "transport_failed")


if __name__ == "__main__":
    unittest.main()

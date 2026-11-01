"""Real child environment checks with a labelled JSONL fixture; no network calls."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from openclaw_memory_bridge import BridgeConfig, MemoryClient
from openclaw_memory_bridge.client import _network_environment


NETWORK_SETTINGS = {
    "HTTP_PROXY": "http://proxy.fixture.invalid:8080",
    "HTTPS_PROXY": "http://secure-proxy.fixture.invalid:8080",
    "ALL_PROXY": "http://fallback-proxy.fixture.invalid:8080",
    "NO_PROXY": "localhost,127.0.0.1",
    "http_proxy": "",
    "https_proxy": "http://lowercase-proxy.fixture.invalid:8080",
    "all_proxy": "",
    "no_proxy": "",
    "NODE_EXTRA_CA_CERTS": "/tmp/synthetic-missing-extra-ca.pem",
    "SSL_CERT_FILE": "/tmp/synthetic-certificate-bundle.pem",
    "SSL_CERT_DIR": "/tmp/synthetic-certificate-directory",
}


class NetworkEnvironmentTests(unittest.TestCase):
    def test_only_allowlisted_keys_are_read_without_iterating_source(self):
        class SelectedKeysOnly:
            def __getitem__(self, key):
                if key not in NETWORK_SETTINGS:
                    raise AssertionError("Read an unselected environment setting")
                return NETWORK_SETTINGS[key]

            def __iter__(self):
                raise AssertionError("Enumerated the host environment")

        self.assertEqual(_network_environment(SelectedKeysOnly()), NETWORK_SETTINGS)
        self.assertEqual(_network_environment({}), {})

    def test_invalid_values_report_only_the_selected_name(self):
        marker = "synthetic-private-network-setting"
        for value in [None, 1, marker + "\r", marker + "\n", marker + "\0", marker * 1000]:
            with self.subTest(value_type=type(value).__name__):
                with self.assertRaises(ValueError) as caught:
                    _network_environment({"HTTPS_PROXY": value})
                self.assertEqual(str(caught.exception), "Invalid network environment setting: HTTPS_PROXY.")
                self.assertNotIn(marker, str(caught.exception))
        self.assertEqual(_network_environment({"NO_PROXY": "x" * 16384}), {"NO_PROXY": "x" * 16384})


class ChildNetworkEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="sdk-network-env-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.foundation = Path(self.temp.name)
        node = self.foundation / "node_modules/node/bin/node"
        node.parent.mkdir(parents=True)
        node.symlink_to(Path(os.environ["FOUNDATION_ROOT"]) / "node_modules/node/bin/node")
        (self.foundation / "src").mkdir()
        (self.foundation / "src/stdio.ts").write_text('''
import { createInterface } from 'node:readline';
console.log(JSON.stringify({v:1,event:'ready',engine:{name:'environment fixture'}}));
for await (const line of createInterface({input:process.stdin})) {
 const request=JSON.parse(line);
 console.log(JSON.stringify({v:1,id:request.id,ok:true,result:process.env}));
 if(request.op==='shutdown') {process.stdin.destroy();break;}
}
''')
        self.config = BridgeConfig(self.foundation, self.foundation / "data", timeout=5)
        self.base_environment = {
            "PATH": str(node.parent) + os.pathsep + "/usr/bin:/bin",
            "LANG": "en_US.UTF-8",
        }

    def child_environment(self, source):
        with patch.dict(os.environ, source, clear=True):
            with MemoryClient(self.config) as client:
                return client.call("environment")

    def test_real_child_receives_network_settings_without_other_host_state(self):
        source = dict(NETWORK_SETTINGS)
        source.update({
            "OPENAI_API_KEY": "synthetic-unselected-provider-key",
            "OPENROUTER_API_KEY": "synthetic-unselected-other-provider-key",
            "AWS_SECRET_ACCESS_KEY": "synthetic-unselected-cloud-key",
            "GITHUB_TOKEN": "synthetic-unselected-github-token",
            "HOME": "/tmp/synthetic-host-home",
            "PATH": "/tmp/synthetic-host-bin",
            "LANG": "synthetic-host-language",
            "OPENCLAW_GATEWAY_TOKEN": "synthetic-unselected-gateway-token",
            "NODE_OPTIONS": "--synthetic-disallowed-option",
            "NODE_TLS_REJECT_UNAUTHORIZED": "0",
            "NODE_USE_ENV_PROXY": "1",
            "REQUESTS_CA_BUNDLE": "/tmp/synthetic-python-only-bundle.pem",
            "CURL_CA_BUNDLE": "/tmp/synthetic-curl-only-bundle.pem",
        })
        self.assertEqual(self.child_environment(source), {**self.base_environment, **NETWORK_SETTINGS})

    def test_absent_network_settings_remain_absent_in_real_child(self):
        self.assertEqual(self.child_environment({}), self.base_environment)

    def test_invalid_network_setting_fails_before_process_start(self):
        for value in [None, "synthetic-private-value\n", "x" * 16385]:
            with self.subTest(value_type=type(value).__name__):
                with patch("openclaw_memory_bridge.client.os.environ", {"HTTPS_PROXY": value}):
                    with patch("openclaw_memory_bridge.client.subprocess.Popen") as start:
                        with self.assertRaises(ValueError) as caught:
                            MemoryClient(self.config)
                        self.assertEqual(str(caught.exception), "Invalid network environment setting: HTTPS_PROXY.")
                        start.assert_not_called()


if __name__ == "__main__":
    unittest.main()

"""Real local HTTPS handshakes; no model or external network calls.

Only the initial OS trust-store state and packaged CA selection are fixtures.
Certificate-chain and hostname verification run in the actual TLS transport.
"""
from __future__ import annotations

from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import import_module
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request


@unittest.skipUnless(shutil.which("openssl"), "Local TLS fixtures require the openssl executable.")
class PortableTrustTLS(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.trust = import_module("https_trust")
        cls.truststore = import_module("truststore")
        cls.certifi = import_module("certifi")
        cls.temporary = tempfile.TemporaryDirectory(prefix="memory-chat-tls-")
        cls.root = Path(cls.temporary.name)

        def openssl(*arguments):
            subprocess.run(["openssl", *arguments], cwd=cls.root, check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        try:
            for name in ["accepted", "foreign"]:
                (cls.root / f"{name}.cnf").write_text(
                    "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ca\n"
                    f"[dn]\nCN=Memory Chat {name} fixture CA\n"
                    "[ca]\nbasicConstraints=critical,CA:TRUE\n"
                    "keyUsage=critical,keyCertSign,cRLSign\n"
                    "subjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n")
                openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
                        "-keyout", f"{name}.key", "-out", f"{name}.pem", "-days", "2",
                        "-config", f"{name}.cnf")
            openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key",
                    "-out", "server.csr", "-subj", "/CN=localhost")
            (cls.root / "server.cnf").write_text(
                "basicConstraints=critical,CA:FALSE\n"
                "keyUsage=critical,digitalSignature,keyEncipherment\n"
                "extendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost\n"
                "subjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n")
            openssl("x509", "-req", "-in", "server.csr", "-CA", "accepted.pem",
                    "-CAkey", "accepted.key", "-CAcreateserial", "-out", "server.pem",
                    "-days", "2", "-sha256", "-extfile", "server.cnf")

            class Handler(BaseHTTPRequestHandler):
                def log_message(self, *_):
                    pass

                def do_GET(self):
                    body = b'{"localTlsFixture":true}'
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)

            cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cls.root / "server.pem", cls.root / "server.key")
            cls.server.socket = context.wrap_socket(cls.server.socket, server_side=True)
            cls.worker = threading.Thread(target=cls.server.serve_forever,
                                          kwargs={"poll_interval": 0.05}, daemon=True)
            cls.worker.start()
        except BaseException:
            cls.temporary.cleanup()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.worker.join(timeout=3)
        cls.temporary.cleanup()

    def fetch(self, context, host="localhost"):
        # A loopback fixture must not depend on an inherited outbound proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                            urllib.request.HTTPSHandler(context=context))
        with opener.open(f"https://{host}:{self.server.server_port}/models", timeout=3) as response:
            return json.load(response)

    @contextmanager
    def initial_empty_trust(self, *, packaged="accepted", **environment):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        self.assertEqual(context.cert_store_stats()["x509_ca"], 0)
        values = {name: "" for name in ["SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"]}
        values.update(environment)
        # This models a Python installation with no usable default roots. It
        # does not replace the real TLS handshake or trust supplied afterward.
        with patch.dict(os.environ, values), \
             patch.object(context, "load_default_certs", return_value=None), \
             patch.object(self.truststore, "SSLContext", return_value=context), \
             patch.object(self.certifi, "where", return_value=str(self.root / f"{packaged}.pem")):
            yield context

    def test_missing_default_roots_are_repaired_without_disabling_verification(self):
        empty = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        with self.assertRaises(urllib.error.URLError) as baseline:
            self.fetch(empty)
        self.assertIsInstance(baseline.exception.reason, ssl.SSLCertVerificationError)
        original_class, original_factory = ssl.SSLContext, ssl.create_default_context
        with self.initial_empty_trust():
            context = self.trust.create_tls_context()
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(context.check_hostname)
            self.assertEqual(self.fetch(context), {"localTlsFixture": True})
        self.assertIs(ssl.SSLContext, original_class)
        self.assertIs(ssl.create_default_context, original_factory)

    def test_trusted_chain_with_wrong_hostname_is_still_rejected(self):
        with self.initial_empty_trust():
            context = self.trust.create_tls_context()
            self.assertEqual(self.fetch(context), {"localTlsFixture": True})
            with self.assertRaises(urllib.error.URLError) as failure:
                self.fetch(context, host="127.0.0.1")
        self.assertIsInstance(failure.exception.reason, ssl.SSLCertVerificationError)

    def test_foreign_certificate_authority_is_still_rejected(self):
        with self.initial_empty_trust(packaged="foreign"):
            context = self.trust.create_tls_context()
            with self.assertRaises(urllib.error.URLError) as failure:
                self.fetch(context)
        self.assertIsInstance(failure.exception.reason, ssl.SSLCertVerificationError)

    def test_explicit_certificate_files_supplement_packaged_trust(self):
        for name in ["SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"]:
            with self.subTest(variable=name):
                with self.initial_empty_trust(packaged="foreign", **{name: str(self.root / "accepted.pem")}):
                    context = self.trust.create_tls_context()
                    self.assertEqual(self.fetch(context), {"localTlsFixture": True})

    def test_invalid_explicit_certificate_file_fails_closed(self):
        missing = str(self.root / "private-looking-invalid-ca.pem")
        with self.initial_empty_trust(NODE_EXTRA_CA_CERTS=missing):
            with self.assertRaisesRegex(RuntimeError, "NODE_EXTRA_CA_CERTS") as failure:
                self.trust.create_tls_context()
        self.assertNotIn(missing, str(failure.exception))

    def test_native_os_truststore_accepts_extra_ca_and_rejects_wrong_hostname(self):
        # No factory or bundle mocks: this exercises the installed native trust
        # backend (including Keychain when this suite runs on macOS).
        with patch.dict(os.environ, {"SSL_CERT_FILE": "", "SSL_CERT_DIR": "",
                                     "NODE_EXTRA_CA_CERTS": str(self.root / "accepted.pem")}):
            context = self.trust.create_tls_context()
            self.assertIsInstance(context, self.truststore.SSLContext)
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(context.check_hostname)
            self.assertEqual(self.fetch(context), {"localTlsFixture": True})
            with self.assertRaises(urllib.error.URLError) as failure:
                self.fetch(context, host="127.0.0.1")
        self.assertIsInstance(failure.exception.reason, ssl.SSLCertVerificationError)

    def test_real_provider_metadata_transport_uses_the_corrected_trust(self):
        from provider import Provider

        with self.initial_empty_trust(), \
             patch.dict(os.environ, {"NO_PROXY": "localhost,127.0.0.1", "no_proxy": "localhost,127.0.0.1"}):
            provider = Provider(self.root / "provider-state" / "allowance.json", 0, key="local-fixture-only")
            response = provider._response_json(urllib.request.Request(
                f"https://localhost:{self.server.server_port}/models"), 4096)
        self.assertEqual(response, {"localTlsFixture": True})
        self.assertEqual(provider.state()["requests"], 0)

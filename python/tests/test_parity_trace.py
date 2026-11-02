"""Durable comparison evidence; all providers and CLI programs here are fixtures."""
import hashlib
import base64
import copy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(os.environ['FOUNDATION_ROOT'])
sys.path.insert(0, str(ROOT / 'examples'))
from parity.trace import TraceError, TraceJournal, read_trace
from parity.native import DirectNative


class TraceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='parity-trace-')
        self.root = Path(self.tmp.name)
        self.path = self.root / 'events.jsonl'

    def tearDown(self):
        self.tmp.cleanup()

    def journal(self, **kwargs):
        return TraceJournal(self.path, capture_id='test-capture', route='native', **kwargs)

    def native(self, journal, name='native', key=None):
        template = {'logging': {}, 'gateway': {'auth': {'token': 'original-template-token'}}}
        return DirectNative(ROOT, self.root / name, template, self.root / 'template', None, key, trace=journal)

    def test_private_ordered_operations_and_redaction_preserve_payload_arrays(self):
        secret = 'synthetic-selected-key'
        trace = self.journal(secrets=[secret])
        trace.begin_generation('before-restart')
        operation = trace.start('cli', {'args': ['status'], 'list': ['same', 'same']})
        trace.record('observed', {'token': 'unknown-token', 'message': secret,
            'url': 'https://user:password@example.test/path?token=hidden&query=a%20b',
            'safeURL': 'http://example.test/path?query=a%20b',
            'headersEcho': 'Bearer unknown-header-token'})
        trace.end(operation, 'cli.result', {'stdout': 'ok\n', 'stderr': 'warn\n', 'status': 0})
        trace.barrier('before-restart')
        prefix = read_trace(self.path)
        self.assertFalse(prefix['complete'])
        self.assertEqual(prefix['records'][2]['data']['list'], ['same', 'same'])
        trace.begin_generation('after-restart')
        manifest = trace.finish()
        result = read_trace(self.path)
        self.assertTrue(result['complete'])
        self.assertEqual(manifest['sha256'], hashlib.sha256(self.path.read_bytes()).hexdigest())
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual([r['sequence'] for r in result['records']], list(range(1, result['events'] + 1)))
        self.assertEqual(result['records'][3]['data']['safeURL'], 'http://example.test/path?query=a%20b')
        data = self.path.read_text()
        for item in [secret, 'unknown-token', 'hidden', 'password@', 'unknown-header-token']:
            self.assertNotIn(item, data)

    def test_reject_existing_linked_or_nonprivate_paths_without_overwrite(self):
        trace = self.journal()
        before = self.path.read_bytes()
        with self.assertRaises(FileExistsError):self.journal()
        self.assertEqual(self.path.read_bytes(), before)
        link = self.root / 'link.jsonl';link.symlink_to(self.path)
        with self.assertRaises(OSError):TraceJournal(link, capture_id='x', route='native')
        unsafe = self.root / 'unsafe';unsafe.mkdir(mode=0o755);unsafe.chmod(0o755)
        with self.assertRaises(TraceError):TraceJournal(unsafe / 'x', capture_id='x', route='native')
        trace.finish()

    def test_scope_secrets_reject_before_creation_and_text_credentials_are_masked(self):
        secret = 'initial-scope-secret'
        for field in ['capture_id', 'route']:
            path = self.root / (field + '.jsonl')
            values = {'capture_id': 'capture', 'route': 'native', 'secrets': [secret]}
            values[field] = 'prefix-' + secret
            with self.assertRaises(TraceError):TraceJournal(path, **values)
            self.assertFalse(path.exists())
        trace = self.journal(secrets=[secret])
        safe_url = 'https://example.test/path?query=a%20b&order=first'
        trace.record('cli.result', {
            'stdout': '{ "api_key": "labelled-raw-secret", "value": "' + secret + '" }',
            'stderr': 'Bearer unregistered-bearer-token',
            'array': ['same', 'same'], 'safeURL': safe_url})
        trace.finish()
        text = self.path.read_text()
        for value in [secret, 'labelled-raw-secret', 'unregistered-bearer-token']:
            self.assertNotIn(value, text)
        event = read_trace(self.path)['records'][1]
        self.assertEqual(event['data']['array'], ['same', 'same'])
        self.assertEqual(event['data']['safeURL'], safe_url)

    def test_long_scope_labels_binary_redaction_and_strict_prefix_reader(self):
        path = self.root / 'long.jsonl'
        trace = TraceJournal(path, capture_id='c' + 'x' * 159, route='r' + 'x' * 159, secrets=['selected-token'])
        trace.record('binary', {'stdout': b'\xffselected-token\x00'})
        trace.begin_generation('native')
        operation = trace.start('cli', {'args': []})
        trace.end(operation, 'cli.result', {'status': 0})
        trace.finish()
        result = read_trace(path)
        self.assertTrue(result['complete'])
        encoded = result['records'][1]['data']['stdout']
        self.assertEqual(base64.b64decode(encoded['value']), b'\xff[REDACTED]\x00')
        for change in ['sequence', 'generation', 'nonfinite', 'truncated']:
            records = copy.deepcopy(result['records'])
            if change == 'sequence':records[2]['sequence'] = 99
            if change == 'generation':records[2]['generation'] = 5
            if change == 'nonfinite':records[1]['data']['bad'] = float('nan')
            body = '\n'.join(json.dumps(r) for r in records) + '\n'
            if change == 'truncated':body = body[:-2]
            changed = self.root / (change + '.jsonl');changed.write_text(body);changed.chmod(0o600)
            before = changed.read_bytes()
            self.assertFalse(read_trace(changed)['complete'])
            self.assertEqual(changed.read_bytes(), before)

    def test_typescript_and_python_read_each_others_complete_journals(self):
        trace = self.journal()
        trace.begin_generation('python')
        operation = trace.start('cli', {'args': ['fixture']})
        trace.end(operation, 'cli.result', {'stdout': 'exact\n', 'stderr': 'warning\n'})
        trace.finish()
        node_path = self.root / 'node.jsonl'
        program = (
            "import assert from 'node:assert/strict';"
            f"import{{TraceJournal,readTrace}}from{json.dumps((ROOT/'examples/parity/trace.ts').as_uri())};"
            f"assert.equal(readTrace({json.dumps(str(self.path))}).complete,true);"
            f"const t=new TraceJournal({json.dumps(str(node_path))},{{captureId:'node',route:'sdk-http'}});"
            "t.beginGeneration('node');const op=t.start('http',{request:{query:'exact'}});"
            "t.end(op,'http.result',{status:200,response:{results:[]}});t.finish();"
        )
        subprocess.run([str(ROOT/'node_modules/node/bin/node'), '--input-type=module', '-e', program], check=True,
                       cwd=ROOT, env={'PATH': '/usr/bin:/bin'}, capture_output=True, text=True)
        self.assertTrue(read_trace(node_path)['complete'])

    def test_fsync_failure_oversize_pending_and_replaced_path_never_seal(self):
        for case in ['fsync', 'oversize', 'pending', 'replace']:
            with self.subTest(case=case):
                path = self.root / (case + '.jsonl')
                trace = TraceJournal(path, capture_id='failure', route='native', max_event_bytes=1024)
                if case == 'fsync':
                    with patch('parity.trace.os.fsync', side_effect=OSError('fixture fsync failure')):
                        with self.assertRaises(TraceError):trace.record('data', {'value': 'not durable'})
                elif case == 'oversize':
                    with self.assertRaises(TraceError):trace.record('data', {'value': 'x' * 2000})
                elif case == 'pending':trace.start('http', {'request': 'started'})
                else:
                    path.rename(self.root / 'replaced-original.jsonl')
                    path.write_text('replacement\n');path.chmod(0o600)
                    with self.assertRaises(TraceError):trace.record('data', {})
                with self.assertRaises(TraceError):trace.finish()
                self.assertTrue(trace.poisoned)
                self.assertFalse(read_trace(path)['complete'])

    def test_subprocess_crash_keeps_durable_unsealed_prefix_without_final_report(self):
        program = (
            "import os,sys;sys.path.insert(0,sys.argv[1]);"
            "from parity.trace import TraceJournal;"
            "j=TraceJournal(sys.argv[2],capture_id='crashed',route='native');"
            "j.begin_generation('first');j.start('cli',{'args':['fixture']});os._exit(7)"
        )
        result = subprocess.run([sys.executable, '-c', program, str(ROOT / 'examples'), str(self.path)])
        self.assertEqual(result.returncode, 7)
        result = read_trace(self.path)
        self.assertFalse(result['complete'])
        self.assertEqual(result['records'][-1]['operationState'], 'start')
        self.assertFalse((self.root / 'final-report.json').exists())

    def test_real_cli_retains_separate_streams_nonzero_and_timeout_partial_output(self):
        trace = self.journal()
        direct = self.native(trace, key='synthetic-selected-key')
        direct.base = [sys.executable, '-c']
        script = "import json,os,sys;k=os.environ['OPENROUTER_API_KEY'];sys.stderr.write(k[:8]);sys.stderr.flush();sys.stderr.write(k[8:]+'\\n');print(json.dumps({'ok':True}))"
        self.assertEqual(direct.cli([script], json_output=True), {'ok': True})
        with self.assertRaises(RuntimeError):direct.cli(["import sys;print('out');print('error',file=sys.stderr);sys.exit(3)"])
        timeout = "import os,sys,time;print(os.environ['OPENCLAW_GATEWAY_TOKEN'],flush=True);print('before timeout',file=sys.stderr,flush=True);time.sleep(10)"
        with self.assertRaises(subprocess.TimeoutExpired):direct.cli([timeout], timeout=.15)
        direct.close();trace.finish()
        events = read_trace(self.path)['records']
        outcomes = [r for r in events if r.get('operationState') == 'end']
        self.assertEqual(outcomes[0]['data']['stdout'], '{"ok": true}\n')
        self.assertEqual(outcomes[0]['data']['stderr'], '[REDACTED]\n')
        self.assertEqual(outcomes[1]['data']['status'], 3)
        self.assertTrue(outcomes[2]['data']['timedOut'])
        self.assertIn('before timeout', outcomes[2]['data']['stderr'])
        content = self.path.read_text()
        self.assertNotIn('synthetic-selected-key', content)
        self.assertNotIn(direct.env['OPENCLAW_GATEWAY_TOKEN'], content)

    def test_replacement_native_instances_share_generations_and_none_omits_paid_env(self):
        trace = self.journal()
        first = self.native(trace)
        self.assertNotIn('OPENROUTER_API_KEY', first.env)
        self.assertNotIn('OPENCLAW_LAB_LIFECYCLE_LEDGER', first.env)
        first.write(None, 'before', 'A retained source')
        first.close()
        before = self.path.read_bytes()
        second = self.native(trace)
        second.write(None, 'after', 'A second source')
        second.close();trace.finish()
        self.assertTrue(self.path.read_bytes().startswith(before))
        records = read_trace(self.path)['records']
        self.assertEqual([r['generation'] for r in records if r['kind'] == 'generation.start'], [1, 2])
        self.assertTrue((first.notes / 'before.md').exists())

    def test_gateway_daemon_streams_are_redacted_and_durable_before_replacement(self):
        trace = self.journal()
        program = (
            "import os,sys,time;"
            "key=os.environ['OPENROUTER_API_KEY'];token=os.environ['OPENCLAW_GATEWAY_TOKEN'];"
            "sys.stdout.write(key[:5]);sys.stdout.flush();sys.stdout.write(key[5:]+'\\nready\\n');sys.stdout.flush();"
            "sys.stderr.write(token[:8]);sys.stderr.flush();sys.stderr.write(token[8:]+'\\nwarning\\n');sys.stderr.flush();"
            "time.sleep(30)"
        )
        def await_ready(direct):
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if b'ready\n' in direct._stream_buffers['stdout'] and b'warning\n' in direct._stream_buffers['stderr']:
                    return {'results': []}
                time.sleep(.01)
            raise AssertionError('Dummy daemon did not flush both streams.')
        for generation in [1, 2]:
            direct = self.native(trace, key='dummy-selected-stream-key')
            direct.base = [sys.executable, '-c', program]
            direct.invoke = lambda *args, **kwargs: await_ready(direct)
            direct.start();child = direct.child
            direct.close()
            self.assertIsNotNone(child.poll())
            current = read_trace(self.path)
            streams = [r for r in current['records'] if r['kind'] == 'gateway.streams.result']
            self.assertEqual(len(streams), generation)
            self.assertEqual(streams[-1]['data']['stdout'], '[REDACTED]\nready\n')
            self.assertEqual(streams[-1]['data']['stderr'], '[REDACTED]\nwarning\n')
            self.assertTrue(streams[-1]['data']['complete'])
            self.assertFalse(current['complete'])
            self.assertEqual(current['pending'], [])
            self.assertNotIn(direct.env['OPENCLAW_GATEWAY_TOKEN'], self.path.read_text())
        trace.finish()
        self.assertTrue(read_trace(self.path)['complete'])
        self.assertNotIn('dummy-selected-stream-key', self.path.read_text())

    def test_gateway_stream_overflow_or_journal_failure_still_stops_owned_child(self):
        for failure in ['overflow', 'recorder']:
            with self.subTest(failure=failure):
                path = self.root / (failure + '-daemon.jsonl')
                trace = TraceJournal(path, capture_id='failure', route='native')
                direct = self.native(trace, name=failure)
                direct.base = [sys.executable, '-c', "import sys,time;sys.stdout.write('x'*1048576);sys.stdout.flush();time.sleep(30)"]
                direct.invoke = lambda *args, **kwargs: {'results': []}
                if failure == 'overflow':
                    direct._stream_limit = 1024
                    with self.assertRaises(TraceError):
                        direct.start()
                        child = direct.child
                        deadline = time.monotonic() + 5
                        while not direct._stream_errors and time.monotonic() < deadline:time.sleep(.01)
                        direct.stop()
                else:
                    direct.start();child = direct.child
                    with self.assertRaises(TraceError):trace.fail('Injected recorder failure.')
                    with self.assertRaises(TraceError):direct.stop()
                self.assertIsNone(direct.child)
                self.assertTrue(all(not thread.is_alive() for thread in direct._stream_threads))
                if failure == 'recorder':self.assertIsNotNone(child.poll())
                else:
                    captured = [r for r in read_trace(path)['records'] if r['kind'] == 'gateway.streams.error']
                    self.assertEqual(len(captured), 1)
                    self.assertIsNotNone(captured[0]['data']['status'])
                self.assertTrue(trace.poisoned)
                self.assertFalse(read_trace(path)['complete'])
                with self.assertRaises(TraceError):trace.finish()

    def test_local_http_keeps_raw_success_malformed_status_and_disconnect_outcomes(self):
        trace = self.journal()
        direct = self.native(trace)
        gateway_token = direct.env['OPENCLAW_GATEWAY_TOKEN']
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):pass
            def do_POST(self):
                value = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                query = value['args']['query']
                if query == 'disconnect':
                    self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
                if query in ['partial', 'partial-error']:
                    data = b'observed partial response'
                    self.send_response(200 if query == 'partial' else 400)
                    self.send_header('Content-Length', str(len(data) + 20));self.end_headers()
                    self.wfile.write(data);self.wfile.flush()
                    self.close_connection = True
                    return
                data = (b'not json' if query == 'malformed' else
                        json.dumps({'ok': True, 'result': {'details': {'echo': gateway_token, 'matches': ['same', 'same']}}}).encode())
                self.send_response(400 if query == 'http-error' else 200)
                self.send_header('Content-Length', str(len(data)));self.end_headers()
                self.wfile.write(data)
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True);thread.start()
        direct.port = server.server_address[1]
        try:
            self.assertEqual(direct.invoke('memory_search', {'query': 'ok'}, start=False)['matches'], ['same', 'same'])
            for query in ['malformed', 'http-error', 'partial', 'partial-error', 'disconnect']:
                with self.subTest(query=query):
                    with self.assertRaises(Exception):direct.invoke('memory_search', {'query': query}, start=False)
        finally:server.shutdown();server.server_close();thread.join()
        direct.close();trace.finish()
        records = read_trace(self.path)['records']
        outcomes = [r for r in records if r.get('operationState') == 'end']
        self.assertEqual(len(outcomes), 6)
        self.assertEqual(outcomes[0]['data']['status'], 200)
        self.assertEqual(outcomes[1]['data']['responseBody'], 'not json')
        self.assertEqual(outcomes[2]['data']['status'], 400)
        self.assertTrue(outcomes[2]['data']['responseBodyComplete'])
        self.assertEqual(outcomes[3]['kind'], 'http.error')
        self.assertEqual(outcomes[3]['data']['status'], 200)
        self.assertFalse(outcomes[3]['data']['responseBodyComplete'])
        self.assertEqual(outcomes[3]['data']['partialResponse'], 'observed partial response')
        self.assertEqual(outcomes[4]['kind'], 'http.error')
        self.assertEqual(outcomes[4]['data']['status'], 400)
        self.assertFalse(outcomes[4]['data']['responseBodyComplete'])
        self.assertEqual(outcomes[4]['data']['responseBody'], 'observed partial response')
        self.assertEqual(outcomes[5]['kind'], 'http.error')
        self.assertIsNone(outcomes[5]['data']['status'])
        self.assertEqual(len(direct.http), 1)
        self.assertNotIn(gateway_token, self.path.read_text())


if __name__ == '__main__':unittest.main()

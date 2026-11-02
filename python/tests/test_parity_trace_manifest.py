"""Capture completeness is separate from scenario success; missing evidence stays missing."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(os.environ['FOUNDATION_ROOT'])
sys.path[:0]=[str(ROOT/'examples/parity'),str(ROOT/'examples')]
from parity.trace import TraceJournal
from run import trace_manifest,save_trace_manifest


class CaptureManifestTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='capture-manifest-')
        self.root=Path(self.tmp.name)

    def tearDown(self):self.tmp.cleanup()

    def complete(self,name='native.jsonl',capture_id='capture-test'):
        journal=TraceJournal(self.root/name,capture_id=capture_id,route='native')
        journal.begin_generation('fixture')
        op=journal.start('cli',{'args':['fixture']})
        journal.end(op,'cli.result',{'status':0,'stdout':'labelled fixture','stderr':''})
        return journal.finish()

    def test_private_exclusive_manifest_hashes_the_actual_producer(self):
        source=self.complete()
        value=save_trace_manifest(self.root,'capture-test',['native.jsonl'])
        self.assertTrue(value['complete'])
        self.assertEqual(value['producers'][0]['sha256'],source['sha256'])
        self.assertIn('cli.result',value['producers'][0]['eventKinds'])
        self.assertNotIn('records',value['producers'][0])
        target=self.root/'capture-manifest.json'
        self.assertEqual(target.stat().st_mode & 0o777,0o600)
        self.assertEqual(json.loads(target.read_text()),value)
        with self.assertRaises(FileExistsError):save_trace_manifest(self.root,'capture-test',['native.jsonl'])

    def test_missing_scope_mismatch_duplicate_and_unsealed_producers_cannot_pass(self):
        self.complete()
        self.assertFalse(trace_manifest(self.root,'capture-test',['native.jsonl','missing.jsonl'])['complete'])
        self.assertFalse(trace_manifest(self.root,'other-capture',['native.jsonl'])['complete'])
        self.assertFalse(trace_manifest(self.root,'capture-test',['native.jsonl','native.jsonl'])['complete'])
        pending=TraceJournal(self.root/'pending.jsonl',capture_id='capture-test',route='native')
        pending.start('http',{'request':'labelled fixture'})
        self.assertFalse(trace_manifest(self.root,'capture-test',['pending.jsonl'])['complete'])
        with self.assertRaises(RuntimeError):pending.finish()

    def test_uncertain_manifest_write_retains_pending_evidence_without_publishing_success(self):
        self.complete()
        with patch('run.os.fsync',side_effect=OSError('labelled disk failure')):
            with self.assertRaises(OSError):save_trace_manifest(self.root,'capture-test',['native.jsonl'])
        self.assertFalse((self.root/'capture-manifest.json').exists())
        self.assertTrue((self.root/'capture-manifest.json.pending').exists())
        with self.assertRaises(FileExistsError):save_trace_manifest(self.root,'capture-test',['native.jsonl'])

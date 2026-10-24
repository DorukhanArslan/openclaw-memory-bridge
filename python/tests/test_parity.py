"""Strict diagnostic replay tests. Labelled fixture responses are not model evidence."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock

ROOT=Path(os.environ['FOUNDATION_ROOT'])
sys.path.insert(0,str(ROOT/'examples/parity'))
from replay import strict_replay
sys.path.insert(0,str(ROOT/'examples'))
from openclaw_memory_bridge import BridgeConfig,FoundationError,MemoryClient
# Load only the test proxy factory. No main/provider run occurs on import.
from run import proxy


class StrictReplayTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='parity-replay-')
        self.root=Path(self.tmp.name)
        provenance={'originClass':'agent','sessionKind':'unknown','observedAt':123}
        hit={'path':'memory/test.md','score':.25,'provenance':provenance}
        self.response={'results':[hit,hit],'provider':'none'}
        self.tape=self.root/'fixture.jsonl'
        records=[{'kind':'ready','value':{'v':1,'event':'ready','engine':{'name':'labelled replay fixture'}}}]
        for i,op,args,result in [(1,'search',{'query':'Ankara','session':'first'},self.response),(2,'get',{'path':'memory/test.md'},{'text':'Synthetic'}),(3,'shutdown',{}, {'closed':True})]:
            records.extend([{'kind':'request','value':{'v':1,'id':f'python-{i}','op':op,'workspace':'alpha','args':args}},{'kind':'response','value':{'v':1,'id':f'python-{i}','ok':True,'result':result}}])
        self.tape.write_text('\n'.join(json.dumps(r) for r in records)+'\n')

    def tearDown(self):self.tmp.cleanup()

    def client(self,label):
        foundation=proxy(ROOT,self.root,label,mode='replay',source=self.tape)
        return MemoryClient(BridgeConfig(foundation,self.root/'unused',3))

    def test_exact_sequence_and_duplicate_provenance_preserved(self):
        with self.client('positive') as client:
            self.assertEqual(client.call('search','alpha',query='Ankara',session='first'),self.response)
            self.assertEqual(client.call('get','alpha',path='memory/test.md'),{'text':'Synthetic'})
        with self.client('full') as client:self.assertEqual(strict_replay(client,self.tape),2)

    def test_changed_query_extra_argument_and_wrong_order_rejected(self):
        for label,op,args in [('query','search',{'query':'Istanbul','session':'first'}),('extra','search',{'query':'Ankara','session':'first','unexpected':True}),('order','get',{'path':'memory/test.md'})]:
            with self.subTest(label=label):
                with self.client(label) as client:
                    with self.assertRaises(FoundationError) as caught:client.call(op,'alpha',**args)
                    self.assertEqual(caught.exception.code,'replay_mismatch')

    def test_mutated_response_is_not_accepted_by_python_checker(self):
        client=Mock();client.call.return_value={'results':[],'provider':'none'}
        with self.assertRaises(AssertionError):strict_replay(client,self.tape)

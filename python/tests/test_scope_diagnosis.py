"""Temporary diagnostic harness guard. No engine, model or credential calls."""
import copy
import importlib.util
import os
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('scope_diagnosis_run',Path(os.environ['FOUNDATION_ROOT'])/'examples/scope-diagnosis/run.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ScopeBudgetGateTests(unittest.TestCase):
 def test_pair_requires_headroom_for_both_routes_without_resetting_counters(self):
  enough={'profile':'maintenance','requests':7,'outputTokens':14336}
  self.assertTrue(module.require_pair_headroom(enough))
  for requests,output in [(11,22528),(15,30720)]:
   ledger={'profile':'maintenance','requests':requests,'outputTokens':output};before=copy.deepcopy(ledger)
   with self.assertRaisesRegex(ValueError,'both matched routes'):module.require_pair_headroom(ledger)
   self.assertEqual(ledger,before)

 def test_other_profiles_are_not_reclassified(self):
  ledger={'profile':'conversation','requests':0,'outputTokens':0}
  with self.assertRaisesRegex(ValueError,'maintenance profile'):module.require_pair_headroom(ledger)
  self.assertEqual(ledger['profile'],'conversation')

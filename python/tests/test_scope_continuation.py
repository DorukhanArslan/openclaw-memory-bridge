"""Test only the narrow temporary application budget continuation, without network."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

ROOT=Path(os.environ['FOUNDATION_ROOT'])
spec=importlib.util.spec_from_file_location('scope_continuation',ROOT/'examples/scope-diagnosis/continue.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ScopeContinuationTests(unittest.TestCase):
 def test_only_four_requests_and_only_one_ledger_can_use_the_ceiling(self):
  with tempfile.TemporaryDirectory(prefix='scope-budget-fixture-') as directory:
   result=module.fixture_check(ROOT,Path(directory),(ROOT/'src/lifecycle-request-budget.ts').read_text())
   self.assertTrue(result['fourAdmitted'])
   self.assertTrue(result['fifthDenied'])
   self.assertTrue(result['otherLedgerDenied'])
   self.assertTrue(result['copiedCeilingOnOtherPathDenied'])
   self.assertTrue(result['countersMonotonic'])
   self.assertTrue(result['defaultsUnchanged'])
   self.assertEqual(result['networkCalls'],0)

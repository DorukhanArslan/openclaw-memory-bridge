"""Disposable trace preparation and probe contracts; no providers or Gateways."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(os.environ['FOUNDATION_ROOT'])
SPEC = importlib.util.spec_from_file_location(
    'scope_instrumentation', ROOT / 'examples/scope-diagnosis/instrument.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
SCOPE = Path('node_modules/openclaw/dist/async-work-scope-BYeX3gh6.mjs')


class ScopeInstrumentationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='scope-observer-fixture-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.original = self.base / 'original'
        self.runtime = self.base / 'runtime'
        self.case = self.base / 'case'
        self.case.mkdir()
        # Three actual pinned files suffice for preparation guards. Execution
        # below supplies fixture imports/completion, not native model execution.
        self.narrative = Path('node_modules/openclaw/dist/dreaming-narrative-B8Hp3Mc_.mjs')
        for relative in [SCOPE, self.narrative, Path('src/native-bootstrap.ts')]:
            for root in [self.original, self.runtime]:
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((ROOT / relative).read_bytes())
        self.observer = MODULE.observer_source(self.case)

    def snapshot(self, root):
        return {str(p.relative_to(root)): p.read_bytes()
                for p in root.rglob('*') if p.is_file()}

    def test_roots_must_be_disjoint_before_writes(self):
        nested = self.original / 'nested-runtime'
        nested.mkdir()
        for runtime in [self.original, nested, self.base]:
            with self.subTest(runtime=runtime):
                before = self.snapshot(self.original)
                with self.assertRaisesRegex(ValueError, 'disjoint'):
                    MODULE.instrument(self.original, runtime, self.observer)
                self.assertEqual(self.snapshot(self.original), before)

    def test_symlink_and_hardlink_targets_are_rejected_before_writes(self):
        target = self.runtime / SCOPE
        for kind in ['symlink', 'hardlink']:
            with self.subTest(kind=kind):
                target.unlink()
                if kind == 'symlink':
                    target.symlink_to(self.original / SCOPE)
                else:
                    os.link(self.original / SCOPE, target)
                original_before = self.snapshot(self.original)
                runtime_before = self.snapshot(self.runtime)
                with self.assertRaisesRegex(ValueError, 'symlinks|independent regular file'):
                    MODULE.instrument(self.original, self.runtime, self.observer)
                self.assertEqual(self.snapshot(self.original), original_before)
                self.assertEqual(self.snapshot(self.runtime), runtime_before)

    def test_linked_parent_directory_is_rejected(self):
        target = (self.runtime / SCOPE).parent
        shutil.rmtree(target)
        target.symlink_to((self.original / SCOPE).parent, target_is_directory=True)
        original_before = self.snapshot(self.original)
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            MODULE.instrument(self.original, self.runtime, self.observer)
        self.assertEqual(self.snapshot(self.original), original_before)
        self.assertFalse((self.runtime / 'src/scope-observer.mjs').exists())

    def test_late_missing_or_duplicate_marker_leaves_copy_untouched(self):
        initial = (self.original / self.narrative).read_text()
        marker = 'narrative = (await params.subagent.complete({'
        for changed in [initial.replace(marker, 'changedCompletion({', 1), initial + '\n// ' + marker]:
            with self.subTest(duplicate=changed.endswith(marker)):
                for root in [self.original, self.runtime]:
                    (root / self.narrative).write_text(changed)
                original_before = self.snapshot(self.original)
                runtime_before = self.snapshot(self.runtime)
                with self.assertRaisesRegex(ValueError, 'expected one instrumentation marker'):
                    MODULE.instrument(self.original, self.runtime, self.observer)
                self.assertEqual(self.snapshot(self.original), original_before)
                self.assertEqual(self.snapshot(self.runtime), runtime_before)

    def test_changed_copy_and_existing_observer_are_not_overwritten(self):
        bootstrap = self.runtime / 'src/native-bootstrap.ts'
        original_bootstrap = bootstrap.read_bytes()
        bootstrap.write_bytes(original_bootstrap + b'\n// Existing local work\n')
        before = self.snapshot(self.runtime)
        with self.assertRaisesRegex(ValueError, 'copy differs'):
            MODULE.instrument(self.original, self.runtime, self.observer)
        self.assertEqual(self.snapshot(self.runtime), before)
        bootstrap.write_bytes(original_bootstrap)
        (self.runtime / 'src/scope-observer.mjs').write_text('// Retained observer')
        before = self.snapshot(self.runtime)
        with self.assertRaisesRegex(ValueError, 'already exists'):
            MODULE.instrument(self.original, self.runtime, self.observer)
        self.assertEqual(self.snapshot(self.runtime), before)

    def test_successful_preparation_verifies_original_hashes(self):
        before = self.snapshot(self.original)
        manifest, patch = MODULE.instrument(self.original, self.runtime, self.observer)
        self.assertEqual(self.snapshot(self.original), before)
        self.assertEqual(len(manifest), 3)
        self.assertIn('narrative-completion-enter', patch)
        self.assertIn('narrative-completion-error', patch)
        self.assertTrue(MODULE.verify_production_hashes(self.original, manifest))
        (self.original / SCOPE).write_bytes(before[str(SCOPE)] + b'\n// Changed')
        with self.assertRaisesRegex(RuntimeError, 'Production source changed'):
            MODULE.verify_production_hashes(self.original, manifest)

    def test_completion_probes_preserve_results_and_omit_unrelated_secrets(self):
        MODULE.instrument(self.original, self.runtime, self.observer)
        # The actual transformed narrative is executed with fixture dependencies.
        # No native authorization, Gateway, model, database, or network is used.
        prefix = '''const writes=[]; export {writes};
class RequestScopedSubagentRuntimeError extends Error {}
const extractErrorCode=e=>e?.code, readErrorName=e=>e?.name;
const formatErrorMessage=e=>String(e?.message??e);
const clampDreamDiaryContextEntry=e=>e;
async function appendNarrativeEntry(params){writes.push(params.narrative);return {};}
'''
        for name, root in [('original', self.original), ('observed', self.runtime)]:
            text = (root / self.narrative).read_text()
            text = '\n'.join(line for line in text.splitlines() if not line.startswith('import '))
            (self.case / f'{name}.mjs').write_text(prefix + text)
        scope_text = (self.runtime / SCOPE).read_text()
        probe = next(line for line in scope_text.splitlines()
                     if line.startswith('globalThis[Symbol.for("openclaw.scopeContextProbe")]'))
        (self.case / 'probe.mjs').write_text(
            'const owner={phase:"open",pending:new Set()};\n'
            'const currentWorkScope={getStore:()=>owner};\n' + probe)
        script = self.case / 'check.mjs'
        script.write_text('''import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import './scope-observer.mjs';
import './probe.mjs';
import * as original from './original.mjs';
import * as observed from './observed.mjs';
async function run(module,mode){
 const calls=[],messages=[];let thrown;
 module.writes.length=0;
 const result=await module.n({agentId:'fixture',detached:false,
   workspaceDir:'fixture-only',nowMs:1,timezone:'UTC',
   data:{phase:'deep',snippets:['PRIVATE_INPUT_SENTINEL']},
   logger:{warn:m=>messages.push(m),info:m=>messages.push(m)},
   subagent:{complete:async request=>{calls.push(request);
     if(mode!=='success'){thrown=new Error(mode==='closed'?'Async work scope is closed':'PRIVATE_ERROR_SENTINEL');throw thrown;}
     return {text:'PRIVATE_COMPLETION_SENTINEL'};
   }}});
 return {outcome:{result,calls,messages,writes:[...module.writes]},stack:thrown?.stack};
}
let targetStack;
for(const mode of ['success','closed','other']){
 const baseline=await run(original,mode),instrumented=await run(observed,mode);
 assert.deepEqual(instrumented.outcome,baseline.outcome);
 if(mode==='closed')targetStack=instrumented.stack;
}
const trace=readFileSync(new URL('./scope-events.jsonl',import.meta.url),'utf8');
const events=trace.trim().split('\\n').map(JSON.parse);
const entries=events.filter(e=>e.kind==='narrative-completion-enter');
const errors=events.filter(e=>e.kind==='narrative-completion-error');
assert.equal(entries.length,3);assert.equal(errors.length,2);
assert(entries.every(e=>e.narrativePhase==='deep'&&e.scope&&e.owner===e.scope&&e.phase==='open'&&e.stack));
assert.equal(errors[0].exceptionStack,targetStack);
assert.equal(errors[1].exceptionStack,undefined);
assert.equal(errors[0].scope,entries[1].scope);
for(const secret of ['PRIVATE_INPUT_SENTINEL','PRIVATE_COMPLETION_SENTINEL','PRIVATE_ERROR_SENTINEL'])assert(!trace.includes(secret));
console.log(JSON.stringify({fixtureSemanticsEqual:true,completionEntryCaptured:true,targetRejectionStackCaptured:true,unrelatedErrorOmitted:true,providerCalls:0}));
''')
        shutil.copy2(self.runtime / 'src/scope-observer.mjs', self.case / 'scope-observer.mjs')
        output = subprocess.check_output([str(ROOT / 'node_modules/node/bin/node'), str(script)], text=True)
        result = json.loads(output)
        self.assertTrue(result['fixtureSemanticsEqual'])
        self.assertTrue(result['completionEntryCaptured'])
        self.assertTrue(result['targetRejectionStackCaptured'])
        self.assertTrue(result['unrelatedErrorOmitted'])
        self.assertEqual(result['providerCalls'], 0)


if __name__ == '__main__':
    unittest.main()

"""Observability-only patch of a disposable OpenClaw copy. No production writes."""
from pathlib import Path
import argparse,hashlib,json,subprocess


def replace_once(text, before, after, label):
    count = text.count(before)
    if count != 1:
        raise ValueError(f'{label}: expected one instrumentation marker, found {count}')
    return text.replace(before, after, 1)


def destination(runtime, relative, source=None, missing=False):
    """Only independent regular files form an isolated runtime copy."""
    target = runtime / relative
    current = runtime
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f'Instrumentation target must not contain symlinks: {relative}')
    if not target.parent.is_dir():
        raise ValueError(f'Instrumentation target parent is missing: {relative}')
    if target.exists():
        if not target.is_file() or target.stat().st_nlink != 1:
            raise ValueError(f'Instrumentation target must be an independent regular file: {relative}')
        if source is not None and target.samefile(source):
            raise ValueError(f'Instrumentation target aliases production: {relative}')
    elif not missing:
        raise ValueError(f'Instrumentation target is missing from the copy: {relative}')
    return target


def verify_production_hashes(original, manifest):
    for item in manifest:
        actual = hashlib.sha256((original / item['file']).read_bytes()).hexdigest()
        if actual != item['originalSha256']:
            raise RuntimeError(f'Production source changed: {item["file"]}')
    return True


def instrument(original, runtime, observer):
    original = Path(original).resolve(strict=True)
    runtime = Path(runtime).resolve(strict=True)
    if original == runtime or original in runtime.parents or runtime in original.parents:
        raise ValueError('Production and disposable runtime roots must be disjoint')
    if not original.is_dir() or not runtime.is_dir():
        raise ValueError('Production and disposable runtime roots must be directories')
    manifest=[];patches=[];planned=[]

    def plan(relative, before, after):
        target = destination(runtime, relative, original / relative)
        if target.read_bytes() != before:
            raise ValueError(f'Disposable copy differs from production: {relative}')
        planned.append((relative, before, after.encode('utf8')))
        manifest.append({'file':str(relative),'originalSha256':hashlib.sha256(before).hexdigest(),'instrumentedSha256':hashlib.sha256(after.encode('utf8')).hexdigest()})
        # Bundled runtime files contain large repeated sections. Use the native
        # diff implementation rather than quadratic Python sequence matching.
        diff = subprocess.run(
            ['/usr/bin/diff', '-u', '-L', str(relative), '-L', str(relative),
             str(original / relative), '-'],
            input=after, capture_output=True, text=True,
        )
        if diff.returncode not in (0, 1):
            raise RuntimeError(f'Could not prepare instrumentation diff: {relative}')
        patches.append(diff.stdout)

    for source in sorted((original/'node_modules/openclaw/dist').rglob('*')):
        if not source.is_file() or source.suffix not in ['.js','.mjs']:continue
        before=source.read_bytes();text=before.decode('utf8')
        marker='AsyncWorkScope = class AsyncWorkScope {'
        if marker not in text:continue
        if text.count(marker) != 1:raise ValueError(f'Expected one scope definition: {source.relative_to(original)}')
        point=text.index(marker);start=text.rfind('\n',0,point)+1;prefix=text[start:point];indent='\t' if prefix=='\t' else '';ending='\n'+indent+'};';end=text.index(ending,point)+len(ending);body=text[start:end]
        if 'Async work scope is closed' not in body:raise ValueError(f'Unrecognized scope implementation: {source.relative_to(original)}')
        if 'const owner = currentWorkScope.getStore();' not in body:raise ValueError(f'Missing scope owner contract: {source.relative_to(original)}')
        def emit(kind):return f'globalThis[Symbol.for("openclaw.scopeDiagnostic")]?.(this, "{kind}", currentWorkScope.getStore());'
        replacements=[
            ('this.phase = "open";', 'this.phase = "open";\n\t\t'+emit('create')),
            ('enter(run) {','enter(run) {\n\t\t'+emit('enter')),
            ('run(run) {','run(run) {\n\t\t'+emit('run-use')),
            ('track(run) {','track(run) {\n\t\t'+emit('track-use')),
            ('if (this.phase === "closed") throw new Error("Async work scope is closed");','if (this.phase === "closed") { const diagnosticError = new Error("Async work scope is closed"); globalThis[Symbol.for("openclaw.scopeDiagnostic")]?.(this, "reject-run", currentWorkScope.getStore(), undefined, diagnosticError.stack); throw diagnosticError; }'),
            ('if (this.phase === "closed") return Promise.reject(/* @__PURE__ */ new Error("Async work scope is closed"));','if (this.phase === "closed") { const diagnosticError = new Error("Async work scope is closed"); globalThis[Symbol.for("openclaw.scopeDiagnostic")]?.(this, "reject-track", currentWorkScope.getStore(), undefined, diagnosticError.stack); return Promise.reject(diagnosticError); }'),
            ('beginClose(reason) {','beginClose(reason) {\n\t\t'+emit('begin-close')),
            ('async drain() {','async drain() {\n\t\t'+emit('drain-start')),
            ('this.phase = "closed";','this.phase = "closed";\n\t\t'+emit('closed')),
        ]
        changed=body
        for old,new in replacements:
            changed=replace_once(changed,old,new,str(source.relative_to(original)))
        output=text[:start]+changed+text[end:]
        capture='function captureAsyncWorkTracker() {\n\tconst scope = currentWorkScope.getStore();'
        if capture in output:output=replace_once(output,capture,capture+'\n\tglobalThis[Symbol.for("openclaw.scopeDiagnostic")]?.(scope, "tracker-capture", scope);',str(source.relative_to(original)))
        probe='globalThis[Symbol.for("openclaw.scopeContextProbe")] = (kind, narrativePhase, exceptionStack) => { const scope = currentWorkScope.getStore(); globalThis[Symbol.for("openclaw.scopeDiagnostic")]?.(scope, kind, scope, narrativePhase, exceptionStack); };\n'
        probe_point=output.rfind('\n',0,output.index(marker))+1
        output=output[:probe_point]+probe+output[probe_point:]
        relative=source.relative_to(original)
        plan(relative,before,output)
    if not planned:raise ValueError('No supported AsyncWorkScope definitions found')
    narrative=Path('node_modules/openclaw/dist/dreaming-narrative-B8Hp3Mc_.mjs')
    before=(original/narrative).read_bytes();after=before.decode('utf8')
    replacements=[
        ('async function generateAndAppendDreamNarrative(params) {','async function generateAndAppendDreamNarrative(params) {\n\tglobalThis[Symbol.for("openclaw.scopeContextProbe")]?.("narrative-start", params.data.phase);'),
        ('if (detached) {\n\t\tqueueMicrotask','if (detached) {\n\t\tglobalThis[Symbol.for("openclaw.scopeContextProbe")]?.("narrative-queue", rest.data.phase);\n\t\tqueueMicrotask'),
        ('narrative = (await params.subagent.complete({','globalThis[Symbol.for("openclaw.scopeContextProbe")]?.("narrative-completion-enter", params.data.phase);\n\t\t\t\tnarrative = (await params.subagent.complete({'),
        ('} catch (error) {\n\t\t\tif (!model || !isConfiguredModelUnavailableNarrativeError(error)) throw error;','} catch (error) {\n\t\t\tglobalThis[Symbol.for("openclaw.scopeContextProbe")]?.("narrative-completion-error", params.data.phase, error instanceof Error && error.message === "Async work scope is closed" ? error.stack : undefined);\n\t\t\tif (!model || !isConfiguredModelUnavailableNarrativeError(error)) throw error;'),
    ]
    for old,new in replacements:after=replace_once(after,old,new,str(narrative))
    plan(narrative,before,after)
    bootstrap=Path('src/native-bootstrap.ts');before=(original/bootstrap).read_bytes();after='import "./scope-observer.mjs";\n'+before.decode('utf8')
    plan(bootstrap,before,after)
    observer_path=Path('src/scope-observer.mjs')
    if destination(runtime,observer_path,missing=True).exists():
        raise ValueError('Disposable observer already exists; preserve the previous capture')
    verify_production_hashes(original,manifest)
    for relative,before,after in planned:
        target=destination(runtime,relative,original/relative)
        if target.read_bytes()!=before:raise ValueError(f'Disposable copy changed during preparation: {relative}')
        target.write_bytes(after)
    destination(runtime,observer_path,missing=True).write_text(observer)
    verify_production_hashes(original,manifest)
    return manifest,''.join(patches)

def observer_source(case):
    return '''import {appendFileSync,readFileSync} from 'node:fs';
import {threadId} from 'node:worker_threads';
const file=__TRACE__;
let label='unknown';try{label=JSON.parse(readFileSync(__LABEL__,'utf8')).run;}catch{}
const ids=new WeakMap();let serial=0,sequence=0;
function id(value){if(!value||typeof value!=='object')return null;if(!ids.has(value))ids.set(value,`${process.pid}:${threadId}:${++serial}`);return ids.get(value);}
globalThis[Symbol.for('openclaw.scopeDiagnostic')]=(scope,kind,owner,narrativePhase,exceptionStack)=>{
 try{
  const entry={run:label,pid:process.pid,threadId,sequence:++sequence,timeMs:Date.now(),kind,scope:id(scope),phase:scope?.phase,owner:id(owner),ownerPhase:owner?.phase,pending:scope?.pending?.size,narrativePhase};
  if(exceptionStack)entry.exceptionStack=exceptionStack;
  if(['create','begin-close','drain-start','closed','reject-run','reject-track','tracker-capture','narrative-queue','narrative-start','narrative-completion-enter','narrative-completion-error'].includes(kind))entry.stack=new Error('scope diagnostic').stack;
  appendFileSync(file,JSON.stringify(entry)+'\\n');
 }catch{} // Observation failure must not affect the native operation.
};
'''.replace('__TRACE__',json.dumps(str(case/'scope-events.jsonl'))).replace('__LABEL__',json.dumps(str(case/'current-run.json')))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('original',type=Path);parser.add_argument('runtime',type=Path);parser.add_argument('case',type=Path);args=parser.parse_args()
    case=args.case.resolve()
    observer=observer_source(case)
    manifest,patch=instrument(args.original.resolve(),args.runtime.resolve(),observer)
    retained=verify_production_hashes(args.original,manifest)
    (case/'instrumentation.json').write_text(json.dumps({'purpose':'Temporary scope observation only; no ownership, prompt, queue, delay or return-value changes','files':manifest,'observerSha256':hashlib.sha256(observer.encode()).hexdigest(),'productionHashesRetained':retained},indent=2)+'\n')
    (case/'instrumentation.patch').write_text(patch)
    print(json.dumps({'instrumentedDefinitions':len(manifest)-2,'productionHashesRetained':retained}))

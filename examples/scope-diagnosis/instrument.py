"""Observability-only patch of a disposable OpenClaw copy. No production writes."""
from pathlib import Path
import argparse,difflib,hashlib,json,subprocess


def instrument(original, runtime, observer):
    manifest=[];patches=[]
    for source in (original/'node_modules/openclaw/dist').rglob('*'):
        if not source.is_file() or source.suffix not in ['.js','.mjs']:continue
        text=source.read_text(errors='strict')
        marker='AsyncWorkScope = class AsyncWorkScope {'
        if marker not in text:continue
        point=text.index(marker);start=text.rfind('\n',0,point)+1;prefix=text[start:point];indent='\t' if prefix=='\t' else '';ending='\n'+indent+'};';end=text.index(ending,point)+len(ending);body=text[start:end]
        if 'Async work scope is closed' not in body:continue
        assert 'const owner = currentWorkScope.getStore();' in body
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
            assert changed.count(old)==1,(str(source),old,changed.count(old))
            changed=changed.replace(old,new)
        output=text[:start]+changed+text[end:]
        capture='function captureAsyncWorkTracker() {\n\tconst scope = currentWorkScope.getStore();'
        if capture in output:output=output.replace(capture,capture+'\n\tglobalThis[Symbol.for("openclaw.scopeDiagnostic")]?.(scope, "tracker-capture", scope);',1)
        probe='globalThis[Symbol.for("openclaw.scopeContextProbe")] = (kind, narrativePhase) => { const scope = currentWorkScope.getStore(); globalThis[Symbol.for("openclaw.scopeDiagnostic")]?.(scope, kind, scope, narrativePhase); };\n'
        probe_point=output.rfind('\n',0,output.index(marker))+1
        output=output[:probe_point]+probe+output[probe_point:]
        relative=source.relative_to(original)
        target=runtime/relative;target.write_text(output)
        manifest.append({'file':str(relative),'originalSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'instrumentedSha256':hashlib.sha256(target.read_bytes()).hexdigest()})
        diff=subprocess.run(['/usr/bin/diff','-u','-L',str(relative),'-L',str(relative),str(source),str(target)],capture_output=True,text=True)
        assert diff.returncode in [0,1]
        patches.append(diff.stdout)
    narrative=Path('node_modules/openclaw/dist/dreaming-narrative-B8Hp3Mc_.mjs')
    before=(original/narrative).read_text();after=before.replace('async function generateAndAppendDreamNarrative(params) {','async function generateAndAppendDreamNarrative(params) {\n\tglobalThis[Symbol.for("openclaw.scopeContextProbe")]?.("narrative-start", params.data.phase);').replace('if (detached) {\n\t\tqueueMicrotask','if (detached) {\n\t\tglobalThis[Symbol.for("openclaw.scopeContextProbe")]?.("narrative-queue", rest.data.phase);\n\t\tqueueMicrotask')
    (runtime/narrative).write_text(after)
    manifest.append({'file':str(narrative),'originalSha256':hashlib.sha256(before.encode()).hexdigest(),'instrumentedSha256':hashlib.sha256(after.encode()).hexdigest()})
    patches.extend(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile=str(narrative),tofile=str(narrative)))
    bootstrap=runtime/'src/native-bootstrap.ts';before=(original/'src/native-bootstrap.ts').read_text();after='import "./scope-observer.mjs";\n'+before;bootstrap.write_text(after)
    patches.extend(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='src/native-bootstrap.ts',tofile='src/native-bootstrap.ts'))
    manifest.append({'file':'src/native-bootstrap.ts','originalSha256':hashlib.sha256(before.encode()).hexdigest(),'instrumentedSha256':hashlib.sha256(after.encode()).hexdigest()})
    (runtime/'src/scope-observer.mjs').write_text(observer)
    return manifest,''.join(patches)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('original',type=Path);parser.add_argument('runtime',type=Path);parser.add_argument('case',type=Path);args=parser.parse_args()
    case=args.case.resolve()
    observer='''import {appendFileSync,readFileSync} from 'node:fs';
import {threadId} from 'node:worker_threads';
const file=__TRACE__;
let label='unknown';try{label=JSON.parse(readFileSync(__LABEL__,'utf8')).run;}catch{}
const ids=new WeakMap();let serial=0,sequence=0;
function id(value){if(!value||typeof value!=='object')return null;if(!ids.has(value))ids.set(value,`${process.pid}:${threadId}:${++serial}`);return ids.get(value);}
globalThis[Symbol.for('openclaw.scopeDiagnostic')]=(scope,kind,owner,narrativePhase,exceptionStack)=>{
 try{
  const entry={run:label,pid:process.pid,threadId,sequence:++sequence,timeMs:Date.now(),kind,scope:id(scope),phase:scope?.phase,owner:id(owner),ownerPhase:owner?.phase,pending:scope?.pending?.size,narrativePhase};
  if(exceptionStack)entry.exceptionStack=exceptionStack;
  if(['create','begin-close','drain-start','closed','reject-run','reject-track','tracker-capture','narrative-queue','narrative-start'].includes(kind))entry.stack=new Error('scope diagnostic').stack;
  appendFileSync(file,JSON.stringify(entry)+'\\n');
 }catch{} // Observation failure must not affect the native operation.
};
'''.replace('__TRACE__',json.dumps(str(case/'scope-events.jsonl'))).replace('__LABEL__',json.dumps(str(case/'current-run.json')))
    manifest,patch=instrument(args.original.resolve(),args.runtime.resolve(),observer)
    (case/'instrumentation.json').write_text(json.dumps({'purpose':'Temporary scope observation only; no ownership, prompt, queue, delay or return-value changes','files':manifest,'observerSha256':hashlib.sha256(observer.encode()).hexdigest()},indent=2)+'\n')
    (case/'instrumentation.patch').write_text(patch)
    print(json.dumps({'instrumentedDefinitions':len(manifest)-2,'productionHashesRetained':True}))

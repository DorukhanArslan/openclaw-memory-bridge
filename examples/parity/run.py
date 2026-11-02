"""Bounded native/installed-wheel parity and lost-ack validation. Synthetic only."""
from __future__ import annotations
import argparse,copy,hashlib,html,json,os,shutil,sys,time,uuid
from datetime import date
from pathlib import Path

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent))
from openclaw_memory_bridge import BridgeConfig,FoundationError,MemoryClient,MemoryScope,MemoryTools
import openclaw_memory_bridge
from host_agent import HostAgent,Provider,HOST_ENVELOPE_USD,sanitize_report
from residence_acceptance import SYSTEM
from native import DirectNative
from replay import strict_replay
from parity.trace import TraceJournal,read_trace

class DirectTools:
    # Matched schemas and host policy, independent dispatch to public native interfaces.
    def __init__(self,memory,scope,day,definitions):self.memory,self.scope,self.day,self.definitions=memory,scope,day,definitions
    def execute(self,name,args):
        if name=='memory_search':return self.memory.search(self.scope,args['query'])
        if name=='memory_get':return self.memory.get(self.scope,args['path'])
        if name=='memory_save':result=self.memory.write(self.scope,'preference',args['text'])
        elif name=='memory_save_daily':result=self.memory.write_daily(self.scope,self.day,args['text'])
        else:raise ValueError('Unknown test tool')
        return {**result,'index':self.memory.index(self.scope)}

class RecordingProvider:
    def __init__(self,provider):self.provider=provider;self.records=[]
    def complete(self,messages,tools):
        record={'messages':copy.deepcopy(messages),'tools':copy.deepcopy(tools)};self.records.append(record)
        result=self.provider.complete(messages,tools);record['response'],record['usage']=result;return result


def proxy(foundation,root,label,*,mode='record',source=None,drop=False,trace_dir=None,capture_id=None):
    dest=root/'consumer'/label;(dest/'src').mkdir(parents=True,exist_ok=True)
    node=dest/'node_modules/node/bin/node';node.parent.mkdir(parents=True,exist_ok=True)
    if not node.exists():node.symlink_to(foundation/'node_modules/node/bin/node')
    shutil.copyfile(HERE/'relay.ts',dest/'src/stdio.ts')
    shutil.copyfile(HERE/'trace.ts',dest/'src/trace.ts')
    cfg={'mode':mode,'entry':str(foundation/'src/stdio.ts'),'capture':str(HERE/'capture.ts'),
         'tape':str(root/(label+'.jsonl')),'httpTape':str(root/(label+'-http.jsonl')),
         'dropAck':drop,'witness':str(root/'ack-witness.json'),'source':str(source) if source else None}
    if trace_dir is not None:
        trace_dir=Path(trace_dir);trace_dir.mkdir(parents=True,exist_ok=True,mode=0o700)
        cfg.update({'captureId':capture_id,'traceJournal':str(trace_dir/(label+'-protocol.jsonl'))})
        if mode!='replay':cfg['httpJournal']=str(trace_dir/(label+'-http.jsonl'))
    (dest/'relay.json').write_text(json.dumps(cfg));return dest


def trace_manifest(directory,capture_id,expected):
    """Validate durable producer journals; never reconstruct a missing trace."""
    records=[]
    for name in expected:
        path=Path(directory)/name
        if not path.exists():
            records.append({'path':str(path),'complete':False,'errors':['missing producer']});continue
        value=read_trace(path)
        if any(event.get('captureId')!=capture_id for event in value.get('records',[])):
            value={**value,'complete':False,'errors':['capture identity mismatch']}
        records.append({**{key:value[key] for key in value if key!='records'},'eventKinds':sorted({event['kind'] for event in value.get('records',[])})})
    unique=len(expected)==len(set(expected))
    return {'schemaVersion':1,'captureId':capture_id,'complete':bool(records) and unique and all(record.get('complete') for record in records),'supportedSurfaces':['native CLI stdout/stderr','native Gateway streams','native tools HTTP','SDK JSONL protocol','SDK tools HTTP','SDK child stderr'],'observedRoutes':sorted({record['route'] for record in records if record.get('route')}),'providerTraffic':False,'byteInterleaving':False,'duplicateProducers':not unique,'producers':records}


def save_trace_manifest(directory,capture_id,expected):
    """Publish only a completely written/fsynced private summary; journals stay authoritative."""
    directory=Path(directory).absolute()
    if directory.resolve()!=directory or directory.stat().st_mode & 0o077:
        raise RuntimeError('Trace manifest requires a private canonical directory.')
    result=trace_manifest(directory,capture_id,expected)
    target=directory/'capture-manifest.json';pending=directory/'capture-manifest.json.pending'
    if target.exists() or target.is_symlink():raise FileExistsError('Capture manifest already exists.')
    fd=os.open(pending,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,'w') as stream:
            json.dump(result,stream,indent=2);stream.write('\n');stream.flush();os.fsync(stream.fileno())
        # link is exclusive: a competing or existing final result is never replaced.
        os.link(pending,target,follow_symlinks=False)
        parent=os.open(directory,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(parent)
        except BaseException:
            target.unlink()
            raise
        finally:os.close(parent)
        pending.unlink()
    except BaseException:
        # Retain uncertain temporary evidence. Never return a complete result.
        raise
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--foundation',type=Path,required=True);p.add_argument('--root',type=Path,required=True);p.add_argument('--report',type=Path,required=True);p.add_argument('--wheel',type=Path,required=True);args=p.parse_args()
    f=args.foundation.resolve();root=args.root.resolve();root.mkdir(parents=True,exist_ok=True,mode=0o700)
    if root.stat().st_mode & 0o077:p.error('Capture root must be a private directory (mode 0700).')
    if (root/'started.json').exists():p.error('Run already started. Retain all evidence and counters; do not reset to replay paid work.')
    contract=json.loads((HERE/'contract.json').read_text());(root/'started.json').write_text(json.dumps({'contractSha256':hashlib.sha256((HERE/'contract.json').read_bytes()).hexdigest(),'contract':contract}))
    scope=MemoryScope('parity','synthetic-maya','first');day=date.today().isoformat();sdkroot=root/'sdk';directory=sdkroot/scope.routing_workspace
    report={'ok':False,'contract':contract,'contractSha256':hashlib.sha256((HERE/'contract.json').read_bytes()).hexdigest(),'scope':{'workspace':scope.workspace,'user':scope.user},'runs':{},'claims':{},'normalization':'Only known filesystem roots in configuration comparison. HTTP body probes and replay responses remain exact. Array order, duplicates and provenance are never removed.','sdkModule':str(Path(openclaw_memory_bridge.__file__).resolve()),'day':day}
    args.report.parent.mkdir(parents=True,exist_ok=True)
    trace_dir=root/'traces';trace_dir.mkdir(mode=0o700)
    capture_id=uuid.uuid4().hex
    coordinator=TraceJournal(trace_dir/'run.jsonl',capture_id=capture_id,route='run')
    native_trace=TraceJournal(trace_dir/'native.jsonl',capture_id=capture_id,route='native')
    expected_traces=['run.jsonl','native.jsonl']
    report['traceCapture']={'schemaVersion':1,'captureId':capture_id,'complete':False,'directory':str(trace_dir),'futureOnly':True}
    def recorded_proxy(label,**kwargs):
        result=proxy(f,root,label,trace_dir=trace_dir,capture_id=capture_id,**kwargs)
        expected_traces.append(label+'-protocol.jsonl')
        if kwargs.get('mode','record')!='replay':expected_traces.append(label+'-http.jsonl')
        return result
    def save(stage):
        report['stage']=stage
        coordinator.record('run.stage',{'stage':stage})
        clean=sanitize_report(native_trace.redact(report),foundation=f,state=root)
        clean['scenarioOk']=bool(report.get('ok'))
        if not report.get('traceCapture',{}).get('complete'):clean['ok']=False
        args.report.write_text(json.dumps(clean,indent=2)+'\n');print(json.dumps({'stage':stage}),flush=True)
    prior=[f/'evidence/provenance-merge-acceptance/request-ledger.json',f/'.lab-test-provenance-merge/sdk-maintenance-ledger.json',f/'.lab-test-residence-2026-10-17/host-request-ledger.json',f/'.lab-test-residence-2026-10-17/memory/sdk-maintenance-ledger.json',f.parent/'openclaw-chatbot-consumer/data/host-request-ledger.json',f.parent/'openclaw-chatbot-consumer/data/memory/sdk-maintenance-ledger.json']
    def ledgers():return {str(q.relative_to(f.parent)):hashlib.sha256(q.read_bytes()).hexdigest() for q in prior if q.exists()}
    report['oldLedgersBefore']=ledgers();direct=None
    try:
        provider=Provider(f,root/'host-request-ledger.json');recording=RecordingProvider(provider)
        coordinator.add_secret(provider.key);native_trace.add_secret(provider.key)
        report['installedWheel']=hashlib.sha256(args.wheel.read_bytes()).hexdigest()
        assert str(Path(openclaw_memory_bridge.__file__).resolve()).startswith(str(root/'consumer/.venv'))
        with MemoryClient(BridgeConfig(f,sdkroot,300)) as m:report['preflight']=m.configure_maintenance(scope,cumulative_limit_usd=50,host_reserve_usd=HOST_ENVELOPE_USD)
        template=json.loads((directory/'openclaw.json').read_text())
        direct=DirectNative(f,root/'direct',template,directory,sdkroot/'sdk-maintenance-ledger.json',provider.key,trace=native_trace)
        def normalized(config,home):
            value=json.loads(json.dumps(config).replace(str(home),'<corpus>'));value['gateway']['port']='<ephemeral>';return value
        report['configurationParity']=normalized(template,directory)==normalized(direct.value,direct.directory)
        assert report['configurationParity']
        assert not list(direct.notes.glob('*.md')) and not list((directory/'workspace/memory').glob('*.md'))
        direct.cli(['config','validate'])
        save('contract and matched blank state admitted')
        probes={}
        def run_side(name,memory,active,where,tape=None):
            result={'conversation':[],'checks':{},'files':{},'probes':{}};report['runs'][name]=result
            def snap(label):
                result['files'][label]={str(q.relative_to(where/'workspace')):q.read_text() for q in (where/'workspace').rglob('*.md')}
                start=len(direct.http) if name=='native' else len(Path(tape).read_text().splitlines()) if Path(tape).exists() else 0
                result['probes'][label]={'canonical':memory.get(active,'memory/preference.md',lines=200),'daily':memory.get(active,f'memory/{day}.md',lines=200)}
                for query in ['Istanbul','Ankara','jasmine']:result['probes'][label][query]=memory.search(active,query)
                events=direct.http[start:] if name=='native' else [json.loads(x) for x in Path(tape).read_text().splitlines()[start:]]
                probes[(name,label)]=[e['request'] for e in events if e.get('request',{}).get('args',{}).get('query')!='foundationreadinessprobe']
            def agent(current):
                a=HostAgent(recording,memory,current,day);a.messages[0]['content']=SYSTEM+day
                if name=='native':a.tools=DirectTools(memory,current,day,a.tools.definitions)
                return a
            a=agent(active);result['conversation']=a.trace
            a.turn("I am synthetic Maya. I live in Ankara. I prefer jasmine tea. Save my current residence and tea preference in the canonical profile. Record today's initial residence in today's daily note.")
            snap('initial');text=result['probes']['initial']['canonical']['text'].lower();result['checks']['initialAnkara']='ankara' in text and 'jasmine' in text
            save(name+' initial model write')
            a.turn("I have now moved from Ankara to Istanbul. Istanbul is my current home; Ankara is my previous home. Read the saved notes. Update my canonical profile, preserve jasmine tea, and retain the dated history and this move in today's daily note.")
            snap('corrected');text=result['probes']['corrected']['canonical']['text'].lower()
            result['checks']['currentIstanbul']='istanbul' in text;result['checks']['unrelatedRetained']='jasmine' in text
            result['checks']['canonicalIndexed']=any(x['path']=='memory/preference.md' for x in result['probes']['corrected']['Istanbul']['results'])
            result['checks']['historyVisible']='ankara' in result['probes']['corrected']['daily']['text'].lower()
            save(name+' correction indexed')
            result['maintenance']=memory.maintenance() if name=='native' else memory.run_maintenance(active)
            memory.index(active);snap('maintained')
            result['checks']['maintenanceCompleted']=result['maintenance']['sweep'].get('completed') is True and result['maintenance']['sweep'].get('completionStatus')=='succeeded'
            result['checks']['canonicalPreserved']=result['probes']['maintained']['canonical']['text']==result['probes']['corrected']['canonical']['text']
            result['checks']['allPublishersCompleted']=all(v=='completed' for v in result['maintenance']['publishers'].values())
            save(name+' native maintenance complete')
            return result,agent
        native_result,_=run_side('native',direct,scope,direct.directory)
        report['nativeHttpBeforeRestart']=copy.deepcopy(direct.http);report['nativeCommandsBeforeRestart']=copy.deepcopy(direct.events)
        native_trace.barrier('before native process replacement');coordinator.barrier('before native process replacement')
        direct.stop();fresh=MemoryScope(scope.workspace,scope.user,'fresh')
        new_direct=DirectNative(f,root/'direct',template,directory,sdkroot/'sdk-maintenance-ledger.json',provider.key,trace=native_trace);direct=new_direct
        def recall(name,memory,where):
            r=report['runs'][name];before=r['probes']['corrected']['canonical']['text']
            r['afterRestart']=memory.get(fresh,'memory/preference.md',lines=200)
            a=HostAgent(recording,memory,fresh,day);a.messages[0]['content']=SYSTEM+day
            if name=='native':a.tools=DirectTools(memory,fresh,day,a.tools.definitions)
            try:a.turn('Where do I live now, and what tea do I prefer? Search and read saved sources. Distinguish current and previous home.')
            finally:r['conversation'].extend(a.trace)
            reply=(a.trace[-1].get('reply') or '').lower()
            r['checks']['freshRealRecall']='istanbul' in reply and 'jasmine' in reply and any(x['name']=='memory_get' for c in a.trace[-1]['calls'] for x in c['results'])
            r['checks']['processPersistence']=before==r['afterRestart']['text']
        recall('native',direct,direct.directory);direct.close();save('native fresh-session recall complete')
        sdkproxy=recorded_proxy('sdk-live')
        with MemoryClient(BridgeConfig(sdkproxy,sdkroot,300)) as memory:
            memory.configure_maintenance(scope,cumulative_limit_usd=50,host_reserve_usd=HOST_ENVELOPE_USD)
            run_side('sdk',memory,scope,directory,root/'sdk-live-http.jsonl')
        coordinator.barrier('before SDK process replacement')
        freshproxy=recorded_proxy('sdk-fresh')
        with MemoryClient(BridgeConfig(freshproxy,sdkroot,300)) as memory:recall('sdk',memory,directory)
        report['actualProbeRequests']={name:{label:probes[(name,label)] for label in ['initial','corrected','maintained']} for name in ['native','sdk']}
        report['matchedProbeRequests']={label:probes[('native',label)]==probes[('sdk',label)] for label in ['initial','corrected','maintained']}
        report['nativeHttp']=new_direct.http;report['nativeCommands']=new_direct.events
        report['modelRequests']=recording.records
        save('SDK real interaction and process restart complete')
        # Re-run the actual SDK request streams against immutable native response tapes.
        report['replay']={}
        for label in ['sdk-live','sdk-fresh']:
            replayproxy=recorded_proxy(label+'-replay',mode='replay',source=root/(label+'.jsonl'))
            with MemoryClient(BridgeConfig(replayproxy,root/'unused-replay',10)) as memory:report['replay'][label]=strict_replay(memory,root/(label+'.jsonl'))
        # One fault at the SDK transport boundary: native/file operation has finished.
        fault=recorded_proxy('lost-ack',drop=True);text='Synthetic retry boundary: amber compass.'
        with MemoryClient(BridgeConfig(fault,sdkroot,300)) as memory:
            memory.configure(scope);memory.timeout=.25
            try:memory.write(scope,'retry-boundary',text);raise AssertionError('Lost ack must time out')
            except FoundationError as error:
                assert error.code=='timeout';report['lostAck']={'clientError':error.code,'poisoned':memory.poisoned}
                try:memory.write(scope,'retry-boundary',text)
                except FoundationError as blocked:report['lostAck']['reuseBlocked']=blocked.code=='transport_failed'
        witness=json.loads((root/'ack-witness.json').read_text());target=directory/'workspace/memory/retry-boundary.md'
        prior_mtime=target.stat().st_mtime_ns;before=target.read_text();time.sleep(.02)
        coordinator.barrier('before explicit lost-ack retry connection')
        retryproxy=recorded_proxy('retry-ack')
        with MemoryClient(BridgeConfig(retryproxy,sdkroot,300)) as memory:
            memory.write(scope,'retry-boundary',text);after=target.read_text();after_mtime=target.stat().st_mtime_ns
            memory.index(scope);report['lostAck']['source']=memory.get(scope,'memory/retry-boundary.md');report['lostAck']['recall']=memory.search(scope,'amber compass')
            report['afterBudget']=memory.configure_maintenance(scope,cumulative_limit_usd=50,host_reserve_usd=HOST_ENVELOPE_USD)['budget']
        report['lostAck'].update({'writeCompletedBeforeDrop':witness['writeCompleted'],'identicalDurableBytes':before==after==text+'\n','secondWriteExecuted':after_mtime!=prior_mtime,'canonicalCopies':after.count(text),'exactlyOnce':'unsupported; two writes executed; one canonical source remains'})
        report['oldLedgersAfter']=ledgers();report['oldLedgersUnchanged']=report['oldLedgersBefore']==report['oldLedgersAfter']
        report['hostLedger']=json.loads((root/'host-request-ledger.json').read_text());report['sharedNativeLedger']=json.loads((sdkroot/'sdk-maintenance-ledger.json').read_text())
        report['claims']={'adapterConfiguration':'verified' if report['configurationParity'] else 'unresolved','matchedNativeProbeRequests':'verified' if all(report['matchedProbeRequests'].values()) else 'unresolved','strictResponseReplay':'verified','productScenario':'verified' if all(all(r['checks'].values()) for r in report['runs'].values()) else 'unresolved','formalSupersession':'unsupported','nativeExternalFlush':'unsupported','exactlyOnceRetry':'unsupported','fullNativeAgentParity':'not tested; both sides use the same independent host policy, not an OpenClaw chat agent'}
        report['ok']=all(all(r['checks'].values()) for r in report['runs'].values()) and all(report['matchedProbeRequests'].values()) and report['oldLedgersUnchanged'] and all(report['lostAck'][k] for k in ['writeCompletedBeforeDrop','identicalDurableBytes','secondWriteExecuted','reuseBlocked'])
        save('complete')
    except Exception as error:
        report['error']=type(error).__name__+': '+str(error);save('incomplete')
    finally:
        if direct:direct.close()
        if 'recording' in locals():report['modelRequests']=recording.records
        try:
            native_trace.finish();coordinator.barrier('before final capture manifest')
            coordinator.finish()
            report['traceCapture']=save_trace_manifest(trace_dir,capture_id,expected_traces)
            if not report['traceCapture']['complete']:report['ok']=False
        except Exception:
            report['ok']=False
            report['traceCapture']={**report['traceCapture'],'complete':False,'error':'Diagnostic capture did not finish; retain all prefixes.'}
        clean=sanitize_report(native_trace.redact(report),foundation=f,state=root)
        args.report.write_text(json.dumps(clean,indent=2)+'\n')
    return 0 if report['ok'] else 2

if __name__=='__main__':raise SystemExit(main())

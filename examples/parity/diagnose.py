"""Replay genuine model tool actions on two blank, matched native corpora.
No model calls, edited actions, replaced answers, or maintenance are used.
"""
import argparse,copy,hashlib,json,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
sys.path.insert(0,str(HERE.parent))
from openclaw_memory_bridge import BridgeConfig,MemoryClient,MemoryScope,MemoryTools
from host_agent import Provider,HOST_ENVELOPE_USD,sanitize_report
from native import DirectNative
from run import DirectTools,proxy


def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--foundation',type=Path,required=True);p.add_argument('--root',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args()
 f=a.foundation.resolve();root=a.root.resolve();r=json.loads(a.report.read_text());raw=root/'real-run-raw.json'
 if not raw.exists():raw.write_text(a.report.read_text())
 marker=root/'diagnostic-started.json'
 if marker.exists():p.error('Diagnostic already started; retain its evidence instead of overwriting it.')
 spec={'beforeRun':True,'sameRecordedActions':True,'assertions':['same ordered model tool names and arguments','same resulting Markdown bytes before maintenance','native HTTP query body equality for duplicate fixed probes','equal ordered hit identities and provenance class; retain full raw responses including differing observedAt and elapsed debug'],'notAsserted':['exact equality of independent runtime timestamps','equal independent model prose','formal supersession']}
 marker.write_text(json.dumps(spec));scope=MemoryScope('parity-replay','synthetic-maya','first');sdkroot=root/'sdk';directory=sdkroot/scope.routing_workspace
 provider=Provider(f,root/'host-request-ledger.json');ledger=sdkroot/'sdk-maintenance-ledger.json';before=json.loads(ledger.read_text())
 actions=[{'name':call['name'],'args':call['args']} for turn in r['runs']['sdk']['conversation'][:2] for c in turn['calls'] for call in c['results']]
 diagnostic={'contract':spec,'actions':actions,'calls':{'native':[],'sdk':[]},'probes':{},'checks':{}}
 with MemoryClient(BridgeConfig(f,sdkroot,300)) as m:m.configure_maintenance(scope,cumulative_limit_usd=50,host_reserve_usd=HOST_ENVELOPE_USD)
 template=json.loads((directory/'openclaw.json').read_text());native=DirectNative(f,root/'diagnostic-direct',template,directory,ledger,provider.key)
 sdkproxy=proxy(f,root,'diagnostic-sdk')
 try:
  with MemoryClient(BridgeConfig(sdkproxy,sdkroot,300)) as m:
   tools={'native':DirectTools(native,scope,r['day'],MemoryTools(m,scope,r['day']).definitions),'sdk':MemoryTools(m,scope,r['day'])}
   assert not list(native.notes.glob('*.md')) and not list((directory/'workspace/memory').glob('*.md'))
   for name,tool in tools.items():
    for action in actions:
     result=tool.execute(action['name'],copy.deepcopy(action['args']))
     diagnostic['calls'][name].append({'request':copy.deepcopy(action),'result':result})
    owner=native if name=='native' else m
    diagnostic['probes'][name]=[owner.search(scope,q) for q in ['Istanbul','Istanbul','Ankara','jasmine']]
   filemaps={name:{str(q.relative_to(where/'workspace')):q.read_text() for q in (where/'workspace').rglob('*.md')} for name,where in [('native',native.directory),('sdk',directory)]}
   diagnostic['files']=filemaps
   diagnostic['checks']['sameOrderedRequests']=[x['request'] for x in diagnostic['calls']['native']]==[x['request'] for x in diagnostic['calls']['sdk']]
   diagnostic['checks']['sameMarkdownBytes']=filemaps['native']==filemaps['sdk']
   def identity(results):return [[(h['path'],h['startLine'],h['endLine'],h.get('source'),h.get('provenance',{}).get('originClass'),h.get('provenance',{}).get('sessionKind')) for h in query['results']] for query in results]
   diagnostic['checks']['orderedHitIdentityAndOrigin']=identity(diagnostic['probes']['native'])==identity(diagnostic['probes']['sdk'])
  diagnostic['nativeHttp']=native.http;diagnostic['nativeCliAndWrites']=native.events
  diagnostic['sdkHttp']=[json.loads(x) for x in (root/'diagnostic-sdk-http.jsonl').read_text().splitlines()]
  # Last four actual HTTP calls are deliberate duplicate fixed probes on each side.
  diagnostic['checks']['actualProbeRequestBodiesEqual']=[e['request'] for e in native.http[-4:]]==[e['request'] for e in diagnostic['sdkHttp'][-4:]]
  diagnostic['checks']['noNewProviderRequests']=before==json.loads(ledger.read_text())
  diagnostic['nativeLedgerBefore']=before;diagnostic['nativeLedgerAfter']=json.loads(ledger.read_text())
  diagnostic['observedAtEquality']=[[h.get('provenance',{}).get('observedAt') for h in p['results']] for p in diagnostic['probes']['native']]==[[h.get('provenance',{}).get('observedAt') for h in p['results']] for p in diagnostic['probes']['sdk']]
  r['diagnosticReplay']=sanitize_report(diagnostic,foundation=f,state=root)
  a.report.write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'diagnosticChecks':diagnostic['checks'],'observedAtEquality':diagnostic['observedAtEquality']}))
 finally:native.close()
 return 0 if all(diagnostic['checks'].values()) else 2

if __name__=='__main__':raise SystemExit(main())

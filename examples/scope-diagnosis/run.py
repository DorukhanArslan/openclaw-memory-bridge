"""One observed direct/SDK maintenance pair from identical synthetic snapshot state."""
from __future__ import annotations
import argparse,copy,hashlib,json,os,shutil,sys,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent));sys.path.insert(0,str(HERE.parent/'parity'))
from openclaw_memory_bridge import BridgeConfig,MemoryClient,MemoryScope,MemoryTools
from host_agent import Provider,sanitize_report
from native import DirectNative
from run import proxy


def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def require_pair_headroom(ledger):
 # Both routes must be dispatchable under the same retained finite profile.
 # This does not authorize changing caps or resetting consumed counters.
 if ledger.get('profile')!='maintenance':raise ValueError('Expected retained maintenance profile')
 if ledger['requests']+8>40 or ledger['outputTokens']+8*2048>32000:
  raise ValueError('Insufficient retained output/request allowance for both matched routes; do not start or reset the ledger')
 return True


def main():
 p=argparse.ArgumentParser();p.add_argument('--foundation',required=True,type=Path);p.add_argument('--case',required=True,type=Path);p.add_argument('--scope-workspace',default='scope-diagnostic');p.add_argument('--prime',action='store_true');args=p.parse_args()
 f=args.foundation.resolve();case=args.case.resolve();runtime=case/'runtime';scope=MemoryScope(args.scope_workspace,'synthetic-maya','first')
 sdkroot=f/'.lab-test-parity/sdk';anchor=sdkroot/scope.routing_workspace;ledger=sdkroot/'sdk-maintenance-ledger.json'
 if (case/'started.json').exists():p.error('This pair already started. Preserve its state and shared ledger; do not reset it.')
 try:require_pair_headroom(json.loads(ledger.read_text()))
 except ValueError as error:p.error(str(error))
 spec={'beforeModelRuns':True,'eligibleDeepRequired':args.prime,'scope':'one sequential observed direct/SDK maintenance pair','controls':['same physical corpus path','restore the same stopped DB and Markdown file bytes before each route','same native model/config and finite shared ledger','instrumentation only; no owner, queue, prompt or delay changes'],'notControlled':['real network completion timing','clock advance','observation overhead'],'noResponseReplay':'Native completion requests include live context and concurrent phase work. No request will be forced to match a recording. Both routes use the authorized real model.','secretRule':'No environment values, request headers, keys or reason objects enter traces. Snapshot excludes fingerprint keys and home/auth files.'}
 (case/'started.json').write_text(json.dumps(spec,indent=2));report={'spec':spec,'baseCommit':'ee061c51f4760a9487cbe141a1fa545042721568','runs':{},'instrumentation':json.loads((case/'instrumentation.json').read_text())}
 def save(stage):
  report['stage']=stage;(case/'result.json').write_text(json.dumps(sanitize_report(report,foundation=f,state=case),indent=2)+'\n');print(json.dumps({'stage':stage}),flush=True)
 provider=Provider(f,f/'.lab-test-parity/host-request-ledger.json');host_before=(f/'.lab-test-parity/host-request-ledger.json').read_bytes();budget_before=json.loads(ledger.read_text());report['nativeLedgerBefore']=budget_before
 scope_file=runtime/'node_modules/openclaw/dist/async-work-scope-BYeX3gh6.mjs'
 assert scope_file.exists()
 (case/'current-run.json').write_text(json.dumps({'run':'prepare'}))
 source=json.loads((f/'reports/native-sdk-parity.json').read_text());actions=source['diagnosticReplay']['actions']
 # Public installed SDK, original uninstrumented runtime, creates one synthetic seed.
 with MemoryClient(BridgeConfig(f,sdkroot,300)) as memory:
  report['preflight']=memory.configure_maintenance(scope,cumulative_limit_usd=50,host_reserve_usd=0)
  tools=MemoryTools(memory,scope,source['day'])
  assert not list((anchor/'workspace/memory').glob('*.md'))
  report['seedActions']=[]
  if args.prime:
   report['seedProbes']=[]
   for turn in source['runs']['sdk']['conversation'][:2]:
    for call in turn['calls']:
     for action in call['results']:report['seedActions'].append({'request':{'name':action['name'],'args':action['args']},'result':tools.execute(action['name'],copy.deepcopy(action['args']))})
    for query in ['Istanbul','Ankara','jasmine']:report['seedProbes'].append({'query':query,'result':memory.search(scope,query)})
   report['eligibility']=memory.explain_promotion(scope,'memory/'+source['day']+'.md')
   assert report['eligibility']['candidate']['provenance']['originClass'] in ['agent','owner']
   assert all(report['eligibility']['passes'].values()),'No eligible deep candidate; no maintenance dispatch is allowed'
  else:
   for action in actions:report['seedActions'].append({'request':action,'result':tools.execute(action['name'],copy.deepcopy(action['args']))})
 template=json.loads((anchor/'openclaw.json').read_text());snapshot=case/'snapshot';snapshot.mkdir()
 # Only synthetic memory state. Do not copy, hash or replace the journal fingerprint key.
 def selected():
  out=[]
  for base in ['workspace','state']:
   for q in (anchor/base).rglob('*'):
    if not q.is_file():continue
    if base=='workspace' or '.sqlite' in q.name or q.suffix=='.json':
     if any(x in q.name.lower() for x in ['auth','credential','token']) or q.suffix=='.key':continue
     out.append(q)
  return out
 manifest={str(q.relative_to(anchor)):digest(q) for q in selected()}
 for relative in manifest:
  dest=snapshot/relative;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(anchor/relative,dest)
 report['snapshotManifest']=manifest;report['snapshotFieldsExcluded']=['state/config-journal-fingerprint.key','home','tmp','logs','shared spend ledger']
 def restore():
  for q in selected():q.unlink()
  for relative in manifest:
   dest=anchor/relative;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(snapshot/relative,dest)
  return {str(q.relative_to(anchor)):digest(q) for q in selected()}
 def setlabel(label):(case/'current-run.json').write_text(json.dumps({'run':label}))
 save('same-path snapshot captured')
 native=None
 try:
  report['beforeNative']=restore();assert report['beforeNative']==manifest
  setlabel('native')
  native=DirectNative(runtime,anchor,template,anchor,ledger,provider.key)
  # Match the SDK configuration filename as well as its contents and corpus path.
  native.config=anchor/'openclaw.json';native.env['OPENCLAW_CONFIG_PATH']=str(native.config);native.save_config()
  native.cli(['config','validate'])
  report['runs']['native']={'maintenance':native.maintenance(),'commands':native.events,'http':native.http}
  native.close();native=None
  report['runs']['native']['workspaceAfter']={str(q.relative_to(anchor/'workspace')):q.read_text() for q in (anchor/'workspace').rglob('*.md')}
  shutil.copy2(anchor/'openclaw.log',case/'native-runtime.log')
  save('observed native maintenance completed')
  report['beforeSdk']=restore();assert report['beforeSdk']==manifest
  setlabel('sdk')
  bridge=proxy(f,case,'sdk-observed')
  shim=case/'env-capture.mjs';shim.write_text('import '+json.dumps(str(f/'src/load-env.ts'))+';\nimport '+json.dumps(str(f/'examples/parity/capture.ts'))+';\n')
  relay=bridge/'relay.json';cfg=json.loads(relay.read_text());cfg['entry']=str(runtime/'src/stdio.ts');cfg['capture']=str(shim);relay.write_text(json.dumps(cfg))
  with MemoryClient(BridgeConfig(bridge,sdkroot,300)) as memory:
   report['runs']['sdk']={'maintenance':memory.run_maintenance(scope)}
  report['runs']['sdk']['workspaceAfter']={str(q.relative_to(anchor/'workspace')):q.read_text() for q in (anchor/'workspace').rglob('*.md')}
  shutil.copy2(anchor/'openclaw.log',case/'sdk-runtime.log')
  report['nativeLedgerAfter']=json.loads(ledger.read_text());report['newNativeRequests']=report['nativeLedgerAfter']['requests']-budget_before['requests']
  report['hostLedgerUnchanged']=(f/'.lab-test-parity/host-request-ledger.json').read_bytes()==host_before
  # Verify the patched dependency is a copy and production bytes did not change.
  report['productionUnchanged']=all(digest(f/item['file'])==item['originalSha256'] for item in report['instrumentation']['files'])
  with MemoryClient(BridgeConfig(f,sdkroot,300)) as memory:report['afterBudget']=memory.configure_maintenance(scope,cumulative_limit_usd=50,host_reserve_usd=0)['budget']
  save('observed pair completed')
 except Exception as error:
  report['error']=type(error).__name__+': '+str(error);save('incomplete')
 finally:
  if native:native.close()
 return 0 if 'error' not in report else 2

if __name__=='__main__':raise SystemExit(main())

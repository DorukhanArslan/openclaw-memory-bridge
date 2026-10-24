"""Finish the authorized SDK route with a path-specific local supervision ceiling.
The production guard and every default profile stay unchanged. No counter reset.
"""
from __future__ import annotations
import argparse,copy,difflib,hashlib,json,os,shutil,stat,subprocess,sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parent));sys.path.insert(0,str(HERE.parent/'parity'))
from openclaw_memory_bridge import BridgeConfig,MemoryClient,MemoryScope
from host_agent import sanitize_report
from run import proxy


def continued_guard(source,path,ceiling):
 expected=json.dumps(ceiling,separators=(',',':'))
 helper='''
// Temporary diagnosis-only application supervision; not an OpenClaw change.
const approvedContinuationPath = __PATH__;
const approvedContinuationCeiling = __CEILING__;
function continuationLimits(path: string, ledger: Ledger) {
  const extra = ledger.continuationCeiling;
  if (extra === undefined) return MAINTENANCE_LIMITS;
  if (path !== approvedContinuationPath || ledger.profile !== "maintenance" ||
      JSON.stringify(extra) !== JSON.stringify(approvedContinuationCeiling))
    throw new Error("Unapproved diagnostic continuation ceiling.");
  return { ...MAINTENANCE_LIMITS, requests: extra.requests,
    inputBytes: extra.inputBytes, outputTokens: extra.outputTokens };
}
'''.replace('__PATH__',json.dumps(str(path))).replace('__CEILING__',expected)
 source=source.replace('  profile?: "consolidation" | "conversation" | "maintenance";', '  profile?: "consolidation" | "conversation" | "maintenance";\n  continuationCeiling?: { requests: number; inputBytes: number; outputTokens: number };')
 mark='// Open the final ledger component'
 assert mark in source;source=source.replace(mark,helper+'\n'+mark,1)
 needle='    const next = {\n      ...(ledger.profile ? { profile: ledger.profile } : {}),'
 replacement='    const effectiveLimits = ledger.profile === "maintenance" ? continuationLimits(path, ledger) : limits;\n    const next = {\n      ...(ledger.continuationCeiling ? { continuationCeiling: ledger.continuationCeiling } : {}),\n      ...(ledger.profile ? { profile: ledger.profile } : {}),'
 assert needle in source;source=source.replace(needle,replacement,1)
 source=source.replace('next.requests > limits.requests','next.requests > effectiveLimits.requests').replace('next.inputBytes > limits.inputBytes','next.inputBytes > effectiveLimits.inputBytes').replace('next.outputTokens > limits.outputTokens','next.outputTokens > effectiveLimits.outputTokens')
 return source


def fixture_check(f,case,source):
 folder=case/'continuation-fixtures';folder.mkdir(exist_ok=True)
 approved=folder/'approved.json';other=folder/'other.json';module=folder/'guard.ts'
 ceiling={'requests':19,'inputBytes':432624,'outputTokens':38912}
 seed={'profile':'maintenance','requests':15,'inputBytes':32624,'outputTokens':30720}
 approved.write_text(json.dumps({**seed,'continuationCeiling':ceiling}));other.write_text(json.dumps(seed))
 module.write_text(continued_guard(source,approved,ceiling))
 check=folder/'check.mjs'
 check.write_text('''import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';
const [module,approved,other]=process.argv.slice(2);const g=await import(pathToFileURL(module));
const before=JSON.parse(readFileSync(approved));const req={method:'POST',body:JSON.stringify({model:'openai/gpt-6-sol',max_completion_tokens:2048,messages:[{role:'user',content:'Synthetic budget fixture.'}]})};
for(let i=0;i<4;i++)g.admitLifecycleRequest(approved,'https://openrouter.ai/api/v1/chat/completions',req);
const after=JSON.parse(readFileSync(approved));assert.equal(after.requests,before.requests+4);assert.equal(after.outputTokens,before.outputTokens+8192);assert.deepEqual(after.continuationCeiling,before.continuationCeiling);
assert.throws(()=>g.admitLifecycleRequest(approved,'https://openrouter.ai/api/v1/chat/completions',req),/budget exhausted/);
assert.throws(()=>g.admitLifecycleRequest(other,'https://openrouter.ai/api/v1/chat/completions',req),/budget exhausted/);
assert.equal(JSON.parse(readFileSync(other)).requests,15);writeFileSync(other,JSON.stringify({...before}));assert.throws(()=>g.admitLifecycleRequest(other,'https://openrouter.ai/api/v1/chat/completions',req),/Unapproved diagnostic/);assert.equal(JSON.parse(readFileSync(other)).requests,15);assert.equal(g.MAINTENANCE_LIMITS.outputTokens,32000);
console.log(JSON.stringify({fourAdmitted:true,fifthDenied:true,otherLedgerDenied:true,copiedCeilingOnOtherPathDenied:true,defaultsUnchanged:true,countersMonotonic:true,networkCalls:0}));''')
 output=subprocess.check_output([str(f/'node_modules/node/bin/node'),str(check),str(module),str(approved),str(other)],text=True)
 return json.loads(output)


def main():
 p=argparse.ArgumentParser();p.add_argument('--foundation',type=Path,required=True);p.add_argument('--case',type=Path,required=True);a=p.parse_args()
 f=a.foundation.resolve();case=a.case.resolve();runtime=case/'runtime';sdkroot=f/'.lab-test-parity/sdk';ledger=sdkroot/'sdk-maintenance-ledger.json';scope=MemoryScope('scope-diagnostic-eligible','synthetic-maya','first');anchor=sdkroot/scope.routing_workspace
 result_path=case/'continuation.json'
 if result_path.exists():p.error('Continuation already started; retain its counters and evidence.')
 previous=json.loads((case/'result.json').read_text());baseline=json.loads(ledger.read_text())
 assert baseline['profile']=='maintenance' and baseline['requests']==15 and baseline['outputTokens']==30720
 record={'capProvenance':{'kind':'our local application supervision setting','source':'src/lifecycle-request-budget.ts: MAINTENANCE_LIMITS.outputTokens','introducedIn':'7cefa0f940b9f566738263d597f8262e6f2c022a','independentUserConstraint':False,'permissionReviewerDenial':False,'userBudgetUsd':50,'authorization':'Existing cumulative 50 USD budget and narrow diagnosis; latest delegation explicitly permits correcting our own local ceiling.'},'before':baseline,'runs':{}}
 def save(stage):
  record['stage']=stage;result_path.write_text(json.dumps(sanitize_report(record,foundation=f,state=case.parent),indent=2)+'\n');print(json.dumps({'stage':stage}),flush=True)
 # Existing supported quota preflight; GET metadata cannot spend model allowance.
 with MemoryClient(BridgeConfig(f,sdkroot,300)) as memory:record['freshPreflight']=memory.configure_maintenance(scope,cumulative_limit_usd=50,host_reserve_usd=0)
 extra_usd=((4*100000+4*1024)*18+8192*30)/1e6
 assert record['freshPreflight']['budget']['usedUsd']+extra_usd<50
 record['extraWorstCaseUsd']=extra_usd
 source_path=f/'src/lifecycle-request-budget.ts';source=source_path.read_text();record['productionGuardSha256']=hashlib.sha256(source.encode()).hexdigest();record['fixtureCheck']=fixture_check(f,case,source)
 ceiling={'requests':baseline['requests']+4,'inputBytes':baseline['inputBytes']+4*100000,'outputTokens':baseline['outputTokens']+8192}
 changed=continued_guard(source,ledger,ceiling);target=runtime/'src/lifecycle-request-budget.ts';target.write_text(changed)
 (case/'continuation-guard.patch').write_text(''.join(difflib.unified_diff(source.splitlines(True),changed.splitlines(True),fromfile='src/lifecycle-request-budget.ts',tofile='temporary-runtime/src/lifecycle-request-budget.ts')))
 record['continuationCeiling']=ceiling;record['privateGuardSha256']=hashlib.sha256(changed.encode()).hexdigest();record['guardDiffSha256']=hashlib.sha256((case/'continuation-guard.patch').read_bytes()).hexdigest()
 # Exact shared lock path, no-follow descriptor, retain all old consumed values.
 lock=str(ledger)+'.lock';lockfd=os.open(lock,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 try:
  fd=os.open(ledger,os.O_RDWR|os.O_NOFOLLOW)
  try:
   assert stat.S_ISREG(os.fstat(fd).st_mode)
   current=json.loads(os.read(fd,65536));assert current==baseline
   updated={**current,'continuationCeiling':ceiling};os.lseek(fd,0,os.SEEK_SET);os.ftruncate(fd,0);os.write(fd,json.dumps(updated).encode())
  finally:os.close(fd)
 finally:os.close(lockfd);os.unlink(lock)
 record['afterCeilingOnly']=json.loads(ledger.read_text())
 assert all(record['afterCeilingOnly'][k]==baseline[k] for k in ['requests','inputBytes','outputTokens','profile'])
 # Preserve the confounded trace byte-for-byte before a fresh capture file is used.
 old_trace=case/'scope-events.jsonl';preserved=case/'scope-events-blocked.jsonl'
 assert not preserved.exists();old_trace.rename(preserved);record['preservedBlockedTraceSha256']=hashlib.sha256(preserved.read_bytes()).hexdigest()
 manifest=previous['snapshotManifest']
 selected=[]
 for base in ['workspace','state']:
  for q in (anchor/base).rglob('*'):
   if q.is_file() and (base=='workspace' or '.sqlite' in q.name or q.suffix=='.json') and not any(s in q.name.lower() for s in ['auth','credential','token']) and q.suffix!='.key':selected.append(q)
 for q in selected:q.unlink()
 for relative in manifest:
  dest=anchor/relative;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(case/'snapshot'/relative,dest)
 record['restoredSnapshot']={relative:hashlib.sha256((anchor/relative).read_bytes()).hexdigest() for relative in manifest};assert record['restoredSnapshot']==manifest==previous['beforeNative']
 (case/'current-run.json').write_text(json.dumps({'run':'sdk-continuation'}))
 bridge=proxy(f,case,'sdk-continuation');cfgpath=bridge/'relay.json';cfg=json.loads(cfgpath.read_text());cfg['entry']=str(runtime/'src/stdio.ts');cfg['capture']=str(case/'env-capture.mjs');cfgpath.write_text(json.dumps(cfg))
 log=anchor/'openclaw.log';offset=len(log.read_text()) if log.exists() else 0
 save('local ceiling corrected; counters preserved; identical snapshot restored')
 try:
  with MemoryClient(BridgeConfig(bridge,sdkroot,300)) as memory:record['runs']['sdk']={'maintenance':memory.run_maintenance(scope)}
  (case/'sdk-continuation-runtime.log').write_text(log.read_text()[offset:])
  record['after']=json.loads(ledger.read_text());assert record['after']['requests']<=ceiling['requests'] and record['after']['outputTokens']<=ceiling['outputTokens']
  assert hashlib.sha256(source_path.read_bytes()).hexdigest()==record['productionGuardSha256']
  with MemoryClient(BridgeConfig(f,sdkroot,300)) as memory:record['afterBudget']=memory.configure_maintenance(scope,cumulative_limit_usd=50,host_reserve_usd=0)['budget']
  record['newNativeRequests']=record['after']['requests']-baseline['requests'];record['productionGuardUnchanged']=True;save('authorized matched continuation completed')
 except Exception as error:record['error']=type(error).__name__+': '+str(error);save('incomplete')
 return 0 if 'error' not in record else 2

if __name__=='__main__':raise SystemExit(main())

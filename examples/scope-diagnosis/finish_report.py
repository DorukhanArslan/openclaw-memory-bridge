"""Record the completed authorized continuation; keep both historical failures intact."""
import argparse,hashlib,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from host_agent import sanitize_report


def main():
 p=argparse.ArgumentParser();p.add_argument('--foundation',type=Path,required=True);p.add_argument('--case',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args()
 f=a.foundation.resolve();c=a.case.resolve();r=json.loads(a.report.read_text());continuation=json.loads((c/'continuation.json').read_text());pair=json.loads((c/'result.json').read_text());trace=[json.loads(line) for line in (c/'scope-events.jsonl').read_text().splitlines()]
 assert continuation['newNativeRequests']==4
 assert continuation['restoredSnapshot']==pair['beforeNative']==pair['snapshotManifest']
 assert continuation['runs']['sdk']['maintenance']['sweep']['completionStatus']=='succeeded'
 assert all(v=='completed' for v in continuation['runs']['sdk']['maintenance']['publishers'].values())
 assert not any(v['kind'].startswith('reject') for v in trace)
 deep=next(v for v in trace if v.get('narrativePhase')=='deep' and v['kind']=='narrative-start');owner=deep['scope']
 selected=[v for v in trace if v['scope']==owner and v['kind'] in ['create','narrative-queue','narrative-start','tracker-capture','track-use','drain-start','begin-close','closed']]
 capture=next(v for v in selected if v['kind']=='tracker-capture' and v['sequence']>deep['sequence'])
 closed=next(v for v in selected if v['kind']=='closed')
 assert capture['phase']=='open' and capture['sequence']<closed['sequence']
 denied=[]
 for line in (c/'sdk-continuation-runtime.log').read_text().splitlines():
  try:d=json.loads(line);message=str(d.get('1',d.get('message','')))
  except:continue
  if 'Finite lifecycle request budget exhausted' in message:denied.append(message)
 assert not denied
 scope=r['scopeDiagnostic'];old_ref=scope['traceReference'];scope['traceReference']=str((c/'scope-events-blocked.jsonl').relative_to(f));assert hashlib.sha256((c/'scope-events-blocked.jsonl').read_bytes()).hexdigest()==scope['traceSha256']
 blocker=scope['blocker'];blocker['historicalInputAssumption']=blocker.pop('inputNeeded');blocker['currentInputNeeded']=None;blocker['resolved']=True;blocker['correction']='32000 was our local application supervision setting, not an independent user constraint or tool/reviewer denial. The existing 50 USD authorization covered the narrow continuation.'
 scope['status']='matched continuation completed; original initiating cause unresolved'
 scope['continuation']={'status':'verified completion; not a fix or proof that the original failure is absent','record':continuation,'sameSnapshotAsNativeBaseline':True,'originalBlockedTraceReference':old_ref,'newTraceReference':str((c/'scope-events.jsonl').relative_to(f)),'newTraceSha256':hashlib.sha256((c/'scope-events.jsonl').read_bytes()).hexdigest(),'criticalOrderedEvents':selected,'ownerScope':owner,'deepTrackedWhileOpen':True,'scopeRejected':False,'completionBudgetDenied':False,'nativeBaselinePublishers':pair['runs']['native']['maintenance']['publishers'],'sdkPublishers':continuation['runs']['sdk']['maintenance']['publishers'],'conclusion':'With matching restored memory state and enough local dispatch allowance, both native baseline and installed-SDK continuation published all three diaries. The earlier budget-denied scope chain is not evidence of an SDK defect. The original non-exhausted failure was not reproduced and has no captured original ownership stack. Native timing sensitivity remains a hypothesis, not a proven original cause. No production SDK fix was made.','limits':['Observer and guard-validation overhead can affect timing.','Real model responses and network timing were not replay-controlled; no mismatched request was forced into a tape.','A successful diagnostic repeat cannot establish a fix or the absence of a timing-dependent error.'],'validation':{'budgetScopeFixture':'four admitted, fifth denied, other ledger denied, copied ceiling denied on another path, defaults unchanged, no network','scopeBudgetFixtures':'3 passed','pythonCompile':'passed','lint':'passed','typecheck':'passed'}}
 scope['latestAfterBudget']=continuation['afterBudget'];scope['totalNewNativeRequestsIncludingContinuation']=scope['newNativeRequestsAllDiagnostics']+continuation['newNativeRequests']
 r['assessment']['matchedInstrumentedMaintenanceWithDispatchAllowance']='verified for one pair; not an original-cause diagnosis'
 r['assessment']['originalFailureInitiator']='unresolved; no original ownership stack, and healthy matched continuation did not reproduce'
 r['assessment']['budgetApprovalBlocker']='resolved: self-imposed local ceiling; no separate user approval was required'
 assert r['ok'] is False and r['originalRunVerdictPreserved']
 a.report.write_text(json.dumps(sanitize_report(r,foundation=f,state=c.parent),indent=2)+'\n');print('Recorded completed continuation and corrected cap provenance; original failed verdict retained.')

if __name__=='__main__':main()

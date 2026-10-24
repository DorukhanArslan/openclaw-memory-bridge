"""Attach observed scope evidence without changing the original failed verdict."""
import argparse,hashlib,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from host_agent import sanitize_report


def main():
 p=argparse.ArgumentParser();p.add_argument('--foundation',type=Path,required=True);p.add_argument('--case',type=Path,required=True);p.add_argument('--report',type=Path,required=True);a=p.parse_args()
 f=a.foundation.resolve();case=a.case.resolve();r=json.loads(a.report.read_text());pair=json.loads((case/'result.json').read_text());graph=json.loads((case/'analysis.json').read_text());pilot=json.loads((case.parent/'result.json').read_text());instrument=json.loads((case/'instrumentation.json').read_text())
 events=[json.loads(s) for s in (case/'scope-events.jsonl').read_text().splitlines()]
 rejection=next(v for v in events if v['run']=='sdk' and v['kind']=='reject-track')
 identity=rejection['scope'];critical=[v for v in events if v['run']=='sdk' and v['scope']==identity and (v['kind'] in ['create','drain-start','begin-close','closed','reject-track'] or v.get('narrativePhase')=='deep' or (v['kind']=='tracker-capture' and v.get('phase')=='closed'))]
 log=[]
 for i,line in enumerate((case/'sdk-runtime.log').read_text().splitlines()):
  try:d=json.loads(line);message=str(d.get('1',d.get('message','')))
  except:continue
  if any(s in message for s in ['Finite lifecycle request budget exhausted','narrative generation failed','narrative generation used fallback','consolidation failed','received SIGTERM']):log.append({'line':i+1,'message':message,'time':d.get('time')})
 ledger=json.loads((f/'.lab-test-parity/sdk/sdk-maintenance-ledger.json').read_text())
 assert ledger['outputTokens']==30720 and ledger['lastDenial']=='output_tokens'
 assert graph['identicalSnapshotBytes'] and graph['eligibleBeforeDispatch']
 assert pair['productionUnchanged'] and pair['hostLedgerUnchanged']
 assert any(v['kind']=='closed' and v['sequence']<rejection['sequence'] for v in critical)
 assert rejection['exceptionStack'].startswith('Error: Async work scope is closed')
 r['boundedPublisherDiagnosis']['historicalLibraryVersion']=1
 r['scopeDiagnostic']={
  'status':'unresolved: controlled comparison blocked by retained output-token allowance',
  'original19of20FailurePreserved':r['ok'] is False,
  'pilot':{'result':'invalid for deep reproduction: no deep candidates; not counted as a successful non-reproduction','nativeRequests':pilot['newNativeRequests'],'publishers':{k:v['maintenance']['publishers'] for k,v in pilot['runs'].items()}},
  'eligiblePair':{'beforeNative':pair['beforeNative'],'beforeSdk':pair['beforeSdk'],'snapshotManifest':pair['snapshotManifest'],'eligibility':pair['eligibility'],'nativeResult':pair['runs']['native']['maintenance'],'sdkResult':pair['runs']['sdk']['maintenance'],'nativeRequests':pair['newNativeRequests'],'memoryStateEquality':True,'financialHeadroomWasNotEqual':'The shared spend ledger was deliberately never restored. After the native route, only 1280 reserved output tokens remained; the SDK route needed 2048 for each request and was denied.'},
  'verifiedMechanism':'In the budget-denied SDK run, native runGeneration created the owner scope. Deep narrative queued and started while it was open. Native generation cleanup drained and closed that exact identity. A later isolated-completion tracker captured it closed and AsyncWorkScope.track rejected with the recorded original exception stack. This is a native use-after-close chain under local dispatch denial, not proof of the original failure initiator.',
  'scopeIdentity':identity,'criticalOrderedEvents':critical,'sdkNativeLog':log,
  'originalCause':'unresolved. The original 19/20 run had remaining output allowance and did not have this budget exhaustion. Its formatted message alone cannot establish the same initiating cause.',
  'sdkDefect':'not demonstrated; no production SDK change or ownership workaround',
  'blocker':{'existingProfile':'maintenance','requests':ledger['requests'],'outputTokensConsumed':ledger['outputTokens'],'outputTokenCeiling':32000,'remaining':1280,'perRequestReservation':2048,'lastDenial':ledger['lastDenial'],'currencyLimitUsd':50,'countersReset':False,'capsRaised':False,'inputNeeded':'Explicit authorization for a finite continuation of the same consumed ledger, for up to four further native model requests / 8192 reserved output tokens. Preserve counters and the cumulative 50 USD ceiling. No new key or account is needed.'},
  'harnessCorrection':'Added an up-front check for enough retained request/output allowance for both routes. The missing check and pilot consumption caused this comparison to reach the guard. Two focused fixture tests cover this check; it changes no SDK or engine behavior.',
  'observerCheck':json.loads((case/'observer-check.json').read_text()),
  'instrumentation':instrument,'exactDiffReference':str((case/'instrumentation.patch').relative_to(f)),'exactDiffSha256':hashlib.sha256((case/'instrumentation.patch').read_bytes()).hexdigest(),
  'traceReference':str((case/'scope-events.jsonl').relative_to(f)),'traceSha256':graph['eventTraceSha256'],
  'instrumentationLimits':['Synchronous observation adds overhead and can affect a timing-sensitive race; no intentional delays or queue/owner changes were introduced.','The eligible pair used one unchanged instrumented runtime; production hashes are unchanged. The preliminary pilot had no deep candidate and is excluded from causal comparison.','No provider-response replay was forced. Real model/network timing was uncontrolled. The blocked SDK dispatch means the two routes did not receive comparable completions.'],
  'productionUnchanged':pair['productionUnchanged'],'hostLedgerUnchanged':pair['hostLedgerUnchanged'],
  'nativeLedgerBeforeAllDiagnostics':pilot['nativeLedgerBefore'],'nativeLedgerAfter':pair['nativeLedgerAfter'],'newNativeRequestsAllDiagnostics':pilot['newNativeRequests']+pair['newNativeRequests'],
  'afterBudget':pair['afterBudget'],'validation':{'observerPrimitiveSemantics':'passed','actualExceptionStacks':'captured','identicalSnapshotBytes':'verified','budgetGateFixtures':'2 passed','pythonCompile':'passed','lint':'passed','typecheck':'passed','productionFixVerification':'not applicable: no production fix'}}
 assert r['ok'] is False
 clean=sanitize_report(r,foundation=f,state=case.parent)
 a.report.write_text(json.dumps(clean,indent=2)+'\n');print('Attached bounded diagnostic; original failure retained; blocker classified.')

if __name__=='__main__':main()

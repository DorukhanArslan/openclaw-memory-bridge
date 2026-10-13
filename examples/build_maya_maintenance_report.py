"""Curate a genuine continuation. Never run a model or edit memory records."""
import json
from pathlib import Path

foundation = Path(__file__).resolve().parents[1]
raw = json.loads((foundation / 'evidence/maya-maintenance-2026-10-13/acceptance.json').read_text())
workspace = foundation / '.lab-test-e2e-conversation/w-c4b42d5e46db88eb0f9c6660f653a2158b1cfe11/workspace'

def clean(value):
    text = json.dumps(value, ensure_ascii=False).replace(str(workspace), '<workspace>').replace(str(foundation), '<foundation>')
    assert '/Users/' not in text and 'sk-or-' not in text and 'Bearer ' not in text
    return json.loads(text)

steps=[]
for s in raw['steps']:
    step={k:s.get(k) for k in ['id','input','bot','before','after','changes','error']}
    out=s.get('output',{})
    if 'completion' in out:
        step['responseEvidence']={k:out['completion'].get(k) for k in ['status','terminalReceipt','terminalReply']}
        step['maintenance']=out['state']['nativeMaintenance']
        calls=[]; results=[]
        for m in out['history']['messages']:
            if m.get('role')=='assistant' and isinstance(m.get('content'),list):
                calls.extend(c for c in m['content'] if c.get('type')=='toolCall')
            elif m.get('role')=='toolResult':
                results.append({k:m.get(k) for k in ['toolCallId','toolName','content','isError']})
        changed={c['path']:c for c in s['changes']}
        writers=[c for c in calls if c.get('name') in ['write','edit'] and c.get('arguments',{}).get('path') in changed]
        step['observedWriters']=writers
        step['writerResults']=[r for r in results if r['toolCallId'] in {c['id'] for c in writers}]
        step['trigger']='Real native Gateway chat in the retained Maya workspace. Native automatic maintenance may run at the turn boundary.'
    elif s['id']=='observe-native-flush':
        step['maintenance']=out['nativeMaintenance']
        step['trigger']='Read persisted native maintenance until succeeded/failed/exhausted. This observer does not start a flush.'
    elif s['id']=='native-compaction':
        step['native']=out['native']
        step['maintenance']=out['state']['nativeMaintenance']
        step['testRetention']=out['testRetention']
        step['trigger']='Operator requests native sessions.compact. Manual compaction does not trigger automatic flush.'
    elif s['id']=='native-dreaming':
        step['native']={k:out.get(k) for k in ['completed','completionStatus','status','ok']}
        step['trigger']='Operator runs and waits for the managed native dreaming cron. No application memory rewrite.'
    steps.append(clean(step))
messages=[]
for line in raw.get('nativeDiagnostics',[]):
    data=json.loads(line)
    timestamp=data.get('_meta',{}).get('date',data.get('time',''))
    if timestamp.startswith('2026-10-13'):
        message=data.get('message',data.get('1'))
        if isinstance(message,str):messages.append({'timestamp':timestamp,'message':message})
initial=raw['initialWorkspace']; final=raw['finalWorkspace']
late_changes=[{'path':p,'before':steps[4]['after'].get(p),'after':final.get(p)} for p in set(steps[4]['after'])|set(final) if steps[4]['after'].get(p)!=final.get(p)]
report=clean({'runId':'maya-maintenance-2026-10-13','mode':raw['mode'],'continuity':raw['continuity'],'sessionIdentityBefore':raw['sessionBefore']['session']['sessionId'],'sessionIdentityAfter':raw['sessionAfter']['session']['sessionId'],'stages':raw['stages'],'steps':steps,'postSweepAsynchronousChanges':late_changes,'finalWorkspace':final,'nativePhaseMessages':messages,'nativeDreaming':{k:raw['dreamStatus']['dreaming'].get(k) for k in ['phases','promotedTotal','promotedToday','shortTermCount','recallSignalCount']},'limitations':{'flushWriteAttribution':'A native succeeded flush was observed (initial marker null). The daily thermometer file is linked to an observed agent write. No distinct flush-only file write was isolated.','summary':'The committed summary describes an older USER.md mint-tea state and pending update. The actual current USER.md stays rooibos; subsequent native recall checks saved sources.','dreaming':'The later sweep promoted zero new entries; the earlier sourced orchid promotion stays intact. Light and REM diary publishers are observed on this date; no deep narrative publication is claimed.','history':'Earlier input-bound failures and the app-mediated final answer remain in the original replay. This is a linked later continuation, not a rewritten clean first run.','bootstrap':'No new template load test. Earlier native USER.md injection evidence remains the source for that case.'},'budget':{'approvedCumulativeUsd':50,'before':raw['beforeBudget'],'after':raw['afterBudget'],'measurement':'Read-only provider key counter snapshots; delayed billing/concurrent use are not isolated per-generation charges.','phaseLimits':raw['limits'],'phaseLedger':raw['requestLedger'],'priorLedger':raw['priorLedger'],'priorLedgerAfter':raw['priorLedgerAfter'],'priorLedgerIntegrity':raw['priorLedgerIntegrity']}})
(foundation / 'reports/maya-maintenance.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'stages':report['stages'],'afterBudget':report['budget']['after'],'priorLedgerIntegrity':report['budget']['priorLedgerIntegrity']}))

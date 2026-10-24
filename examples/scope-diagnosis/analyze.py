"""Join scope observations by actual identity; preserve original event order."""
import argparse,hashlib,json
from pathlib import Path


def analyze(case):
 result=json.loads((case/'result.json').read_text())
 events=[json.loads(line) for line in (case/'scope-events.jsonl').read_text().splitlines()]
 runs={}
 for route in ['native','sdk']:
  selected=[e for e in events if e['run']==route]
  narratives=[e for e in selected if e['kind'] in ['narrative-queue','narrative-start']]
  rejections=[e for e in selected if e['kind'] in ['reject-run','reject-track']]
  chains=[]
  for rejection in rejections:
   identity=rejection['scope'];prefix=[e for e in selected if e['scope']==identity and e['pid']==rejection['pid'] and e['sequence']<=rejection['sequence']]
   chains.append({'rejection':rejection,'creation':next((e for e in prefix if e['kind']=='create'),None),'closeEvents':[e for e in prefix if e['kind'] in ['begin-close','drain-start','closed']],'trackerCapture':[e for e in prefix if e['kind']=='tracker-capture'],'narrativeEvents':[e for e in prefix if e['kind'].startswith('narrative')]})
  deep=[e for e in narratives if e.get('narrativePhase')=='deep']
  deep_chains=[]
  for e in deep:
   later=[x for x in selected if x['scope']==e['scope'] and x['pid']==e['pid'] and x['kind'] in ['begin-close','drain-start','closed'] and x['sequence']>=e['sequence']]
   deep_chains.append({'event':e,'subsequentCloseEvents':later})
  runs[route]={'eventCount':len(selected),'maintenance':result.get('runs',{}).get(route,{}).get('maintenance'),'narrativeEvents':narratives,'rejections':chains,'deepScopeLifetime':deep_chains}
 return {'runs':runs,'eventTraceSha256':hashlib.sha256((case/'scope-events.jsonl').read_bytes()).hexdigest(),'eventCount':len(events),'identicalSnapshotBytes':result.get('beforeNative')==result.get('beforeSdk')==result.get('snapshotManifest'),'eligibleBeforeDispatch':all(result.get('eligibility',{}).get('passes',{}).values()) if result.get('eligibility') else False,'originalFailureNotOverwritten':True}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('case',type=Path);a=p.parse_args();result=analyze(a.case);(a.case/'analysis.json').write_text(json.dumps(result,indent=2)+'\n')
 for route,v in result['runs'].items():print(route,{'narrativeEvents':[(e['kind'],e.get('narrativePhase'),e.get('scope'),e.get('phase')) for e in v['narrativeEvents']],'rejections':len(v['rejections']),'publishers':(v.get('maintenance') or {}).get('publishers')})

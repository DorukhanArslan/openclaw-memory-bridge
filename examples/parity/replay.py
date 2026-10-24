"""Replay actual SDK protocol requests. Arrays, duplicates and provenance remain exact."""
from __future__ import annotations
import copy


def strict_replay(client,tape,*,mutate=None):
    import json
    from openclaw_memory_bridge import FoundationError
    records=[json.loads(line) for line in tape.read_text().splitlines()]
    requests=[r['value'] for r in records if r['kind']=='request']
    responses=[r['value'] for r in records if r['kind']=='response']
    matched=0
    # Shutdown is handled by the client's context manager.
    for i,(q,r) in enumerate(zip(requests,responses)):
        if q['op']=='shutdown':break
        q=copy.deepcopy(q)
        if mutate:q=mutate(i,q)
        try:
            result=client.call(q['op'],q['workspace'],**q['args'])
        except FoundationError as error:
            if not r.get('ok') and error.code==r['error']['code'] and str(error)==r['error']['message']:
                matched+=1;continue
            raise
        if r.get('ok') is not True or result!=r['result']:raise AssertionError('Replay altered native response')
        matched+=1
    return matched

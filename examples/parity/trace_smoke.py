"""Model-free native/installed-SDK evidence capture across Gateway and process restart."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys
import uuid

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
sys.path.insert(0,str(HERE.parent))
from openclaw_memory_bridge import BridgeConfig,MemoryClient,MemoryScope
from native import DirectNative
from parity.trace import TraceJournal,read_trace
from run import proxy,save_trace_manifest


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--foundation',type=Path,required=True)
    parser.add_argument('--root',type=Path,required=True)
    args=parser.parse_args()
    foundation=args.foundation.resolve();root=args.root.resolve()
    root.mkdir(mode=0o700)
    traces=root/'traces';traces.mkdir(mode=0o700)
    capture_id=uuid.uuid4().hex
    coordinator=TraceJournal(traces/'run.jsonl',capture_id=capture_id,route='run')
    native_trace=TraceJournal(traces/'native.jsonl',capture_id=capture_id,route='native')
    report={'ok':False,'captureId':capture_id,'newInferenceOperations':0,'selectedProviderKeys':False}
    scope=MemoryScope('trace-smoke','fictional-user','first')
    sdkroot=root/'sdk'
    active=None
    secrets=[]
    try:
        bridge=proxy(foundation,root,'sdk',trace_dir=traces,capture_id=capture_id)
        marker='Synthetic amber-path trace evidence survives a process restart.'
        with MemoryClient(BridgeConfig(bridge,sdkroot,120)) as memory:
            memory.configure(scope)
            memory.write(scope,'trace-proof',marker)
            memory.index(scope)
            before=memory.search(scope,'amber-path')
            assert any(hit['path']=='memory/trace-proof.md' for hit in before['results'])
            memory.get(scope,'memory/trace-proof.md')
            coordinator.barrier('before SDK Gateway restart')
            memory.restart(scope)
            after=memory.search(scope,'amber-path')
            assert any(hit['path']=='memory/trace-proof.md' for hit in after['results'])
        directory=sdkroot/scope.routing_workspace
        template=json.loads((directory/'openclaw.json').read_text())
        settings=json.loads((directory/'settings.json').read_text())
        assert settings['provider']=='none' and not settings.get('textModel')
        secrets.append(template.get('gateway',{}).get('auth',{}).get('token'))
        coordinator.barrier('before independent native capture')
        active=DirectNative(foundation,root/'direct',template,directory,None,None,trace=native_trace)
        assert 'OPENROUTER_API_KEY' not in active.env
        assert 'OPENCLAW_LAB_LIFECYCLE_LEDGER' not in active.env
        secrets.append(active.env['OPENCLAW_GATEWAY_TOKEN'])
        active.write(scope,'trace-proof',marker)
        active.index(scope)
        before_native=active.search(scope,'amber-path')
        assert any(hit['path']=='memory/trace-proof.md' for hit in before_native['results'])
        assert marker in active.get(scope,'memory/trace-proof.md')['text']
        active.close();active=None
        native_trace.barrier('before DirectNative process recreation')
        prefix=read_trace(traces/'native.jsonl')
        assert not prefix['complete'] and any(event['kind']=='cli.result' for event in prefix['records'])
        first_sequence=prefix['events']
        coordinator.barrier('before DirectNative process recreation')
        active=DirectNative(foundation,root/'direct',template,directory,None,None,trace=native_trace)
        secrets.append(active.env['OPENCLAW_GATEWAY_TOKEN'])
        after_native=active.search(scope,'amber-path')
        assert any(hit['path']=='memory/trace-proof.md' for hit in after_native['results'])
        assert marker in active.get(scope,'memory/trace-proof.md')['text']
        active.close();active=None
        native_trace.finish();coordinator.finish()
        manifest=save_trace_manifest(traces,capture_id,['run.jsonl','native.jsonl','sdk-protocol.jsonl','sdk-http.jsonl'])
        assert manifest['complete']
        native_records=read_trace(traces/'native.jsonl')['records']
        assert {1,2}.issubset({event['generation'] for event in native_records})
        assert native_records[:first_sequence]==prefix['records']
        for path in [*traces.glob('*.jsonl'),root/'sdk.jsonl',root/'sdk-http.jsonl']:
            content=path.read_text()
            assert not any(secret in content for secret in secrets if isinstance(secret,str) and secret)
        report.update({'ok':True,'nativePrefixBeforeRecreation':{'events':first_sequence,'complete':False,'sha256':prefix['sha256']},
            'preRestartPrefixPreserved':True,'nativeGenerations':2,'sdkGatewayRestart':True,
            'nativeProcessReopen':True,'sourceSha256':hashlib.sha256((root/'direct/workspace/memory/trace-proof.md').read_bytes()).hexdigest(),
            'capture':manifest})
    except Exception as error:
        report['error']=type(error).__name__
        raise
    finally:
        if active:active.close()
        (root/'result.json').write_text(json.dumps(native_trace.redact(report),indent=2)+'\n')
        (root/'result.json').chmod(0o600)
    print(json.dumps({'ok':report['ok'],'captureComplete':report['capture']['complete'],'newInferenceOperations':0,'nativeGenerations':2}))
    return 0


if __name__=='__main__':raise SystemExit(main())

"""Read the actual conversation workspace through the existing installed memory SDK."""
import json
from pathlib import Path
from openclaw_memory_bridge import BridgeConfig, FoundationError, MemoryClient, MemoryScope
foundation=Path(__file__).resolve().parents[1]
scope=MemoryScope("chat-demo","maya","after-dream-sdk")
with MemoryClient(BridgeConfig(foundation,foundation/".lab-test-e2e-conversation")) as memory:
    initial_error=None
    try:recall=memory.search(scope,"rooibos")
    except FoundationError as error:
        initial_error={"code":error.code,"reason":"Index sources changed after the finite model harness reset its config; native no-key rebuild is required."}
        memory.index(scope)
        recall=memory.search(scope,"rooibos")
    sources=[]
    for hit in recall["results"]:
        item={"path":hit["path"],"startLine":hit["startLine"],"endLine":hit["endLine"],"snippet":hit["snippet"]}
        try:item["get"]=memory.get(scope,hit["path"],start=hit["startLine"],lines=min(200,hit["endLine"]-hit["startLine"]+1))
        except FoundationError as error:item["getBoundary"]={"code":error.code,"reason":"The SDK bridge does not expose every native profile path through get; search result is kept."}
        sources.append(item)
    result={"adapter":"Installed Python MemoryClient; actual native memory_search/get; no chat or memory write", "workspace":scope.workspace,"user":scope.user,"session":scope.session,"route":scope.routing_workspace,"provider":recall.get("provider"),"initialError":initial_error,"reindexActor":"App requested the existing SDK index method; native keyword index only; no source text write.","sources":sources}
    path=foundation/"evidence/e2e-conversation/sdk-recall.json"
    path.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,indent=2))

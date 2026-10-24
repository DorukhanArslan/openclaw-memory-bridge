"""Real host-agent canonical update. No formal native supersession claim."""
from __future__ import annotations
import argparse
from datetime import date, datetime, timezone
import hashlib
import html
import json
import re
from pathlib import Path
import urllib.error

from openclaw_memory_bridge import BridgeConfig, FoundationError, MaintenanceJob, MemoryClient, MemoryScope
from host_agent import HOST_ENVELOPE_USD, HostAgent, MODEL, Provider, sanitize_report
from host_maintenance import schedule_runs

SYSTEM = """You are an independent primary Python assistant in a synthetic memory lab.
Use memory tools to save facts requested by the user. The canonical profile is memory/preference.md.
Read saved sources before changing them. Preserve unrelated current facts. Keep current residence clear.
Use today's daily note for dated events and history. Mark the old residence as historical after an explicit move.
Never claim a save unless the tool succeeded. Read source files before answering recall questions.
Cite source paths. You own conversation context; OpenClaw provides storage, indexing and maintenance.
Do not claim formal supersession or native flush. Keep replies short. Today is """


def render(report, path):
    e = html.escape
    sections = []
    for step in report.get("conversation", []):
        sections.append("<article><b>User</b><p>"+e(step["user"])+"</p><b>Agent</b><p>"+e(step.get("reply") or "Incomplete")+"</p><details><summary>Model tool calls</summary><pre>"+e(json.dumps(step["calls"],indent=2))+"</pre></details></article>")
    for key, title in [("before","Before the move"),("afterUpdate","After the move"),("afterMaintenance","After native maintenance"),("afterRestart","After bridge process restart")]:
        sections.append("<h2>"+title+"</h2><pre>"+e(json.dumps(report.get(key,{}),indent=2))+"</pre>")
    day=e(report.get("day") or report.get("afterUpdate",{}).get("daily",{}).get("path", "Daily note"))
    file_map="<h2>Files and purpose</h2><table><tr><th>File</th><th>Writer and purpose</th></tr><tr><td>memory/preference.md</td><td>The model updates the current profile and keeps unrelated facts.</td></tr><tr><td>"+day+"</td><td>The model records the initial residence and the later move as history.</td></tr><tr><td>MEMORY.md</td><td>Native maintenance promotes the dated source with a source reference.</td></tr></table>"
    checks="".join("<li>"+e(re.sub(r"([a-z])([A-Z])", r"\1 \2", k).capitalize())+": "+("PASS" if v else "FAIL")+"</li>" for k,v in report.get("checks",{}).items())
    cost=report.get("afterBudget",{}).get("usedUsd")
    budget_line="<p>Last cumulative provider usage: $"+str(round(cost,6))+" of the $50 limit. Previous spending is included.</p>" if cost is not None else "<p>Final provider usage was not checked.</p>"
    path.write_text("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Residence memory test</title><style>body{font:16px system-ui;max-width:960px;margin:32px auto;padding:0 20px;color:#203047;background:#f6f8fb}article{padding:20px;background:white;margin:16px 0;border:1px solid #ccd6e2;border-radius:10px}p,li{line-height:1.6}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}details{margin:12px 0}td,th{padding:10px;text-align:left;border-bottom:1px solid #ccd6e2}</style><h1>Residence memory test</h1><p>"+("PASS" if report.get("ok") else "INCOMPLETE")+". Real model and installed SDK. Synthetic data only.</p>"+budget_line+"<p>The agent writes the canonical profile through the SDK. It records the move in the daily source. OpenClaw indexes and searches these files. The host scheduler calls native maintenance. This test does not demonstrate formal supersession.</p>"+file_map+"".join(sections)+"<h2>Checks</h2><ul>"+checks+"</ul><h2>Limits</h2><p>Old Ankara text remains in the dated daily source and this report. The canonical profile can also retain Ankara as an explicitly historical residence. Native maintenance may keep or promote history. Canonical note replacement does not remove every old source. There is no SDK current-versus-history search filter. External host flush is unsupported. The host owns compaction, token limits and scheduling. Scope routing is not tenant security.</p><details><summary>Maintenance, index, budget and source receipts</summary><pre>"+e(json.dumps({k:v for k,v in report.items() if k!='conversation'},indent=2))+"</pre></details></html>")


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--foundation",type=Path,required=True)
    parser.add_argument("--root",type=Path,required=True)
    parser.add_argument("--report",type=Path,required=True)
    args=parser.parse_args(); foundation=args.foundation.resolve(); root=args.root.resolve()
    host_ledger=root/"host-request-ledger.json"
    if host_ledger.exists() and json.loads(host_ledger.read_text()).get("requests",0):
        parser.error("Consumed acceptance ledger: inspect the existing receipt. Do not reset it to replay.")
    args.report.parent.mkdir(parents=True,exist_ok=True)
    scope=MemoryScope("residence-lab","synthetic-maya","first");day=date.today().isoformat()
    report={"ok":False,"startedAtUtc":datetime.now(timezone.utc).isoformat(),"day":day,"model":MODEL,"runtime":"OpenClaw 2026.9.9","checks":{},"conversation":[],
            "scope":{"workspace":scope.workspace,"user":scope.user,"session":scope.session},
            "formalSupersession":"unsupported; canonical source update only", "nativeExternalFlush":"unsupported; host conversation has no native session lifecycle"}
    prior_paths=[foundation/"evidence/provenance-merge-acceptance/request-ledger.json",foundation/".lab-test-provenance-merge/sdk-maintenance-ledger.json",foundation.parent/"openclaw-chatbot-consumer/data/host-request-ledger.json",foundation.parent/"openclaw-chatbot-consumer/data/memory/sdk-maintenance-ledger.json"]
    def prior():
        return [{"name":str(p.relative_to(foundation.parent)),"sha256":hashlib.sha256(p.read_bytes()).hexdigest(),"counters":json.loads(p.read_text())} for p in prior_paths if p.is_file()]
    report["previousLedgersBefore"]=prior()
    def save():
        clean=sanitize_report(report,foundation=foundation,state=root)
        args.report.write_text(json.dumps(clean,indent=2)+"\n");render(clean,args.report.with_suffix('.html'))
    def checkpoint(stage):
        report["stage"]=stage;save();print(json.dumps({"stage":stage}),flush=True)
    def sources(memory, active):
        return {"canonical":memory.get(active,"memory/preference.md",lines=200),"daily":memory.get(active,f"memory/{day}.md",lines=200)}
    def agent(provider,memory,active):
        a=HostAgent(provider,memory,active,day);a.messages[0]["content"]=SYSTEM+day;return a
    try:
        provider=Provider(foundation,host_ledger)
        with MemoryClient(BridgeConfig(foundation,root/"memory",timeout=300)) as memory:
            report["configuration"]=memory.configure_maintenance(scope,cumulative_limit_usd=50,host_reserve_usd=HOST_ENVELOPE_USD)
            checkpoint("budget admitted")
            a=agent(provider,memory,scope)
            report["conversation"]=a.trace
            a.turn("I am synthetic Maya. I live in Ankara. I prefer jasmine tea. Please save my current residence and tea preference in the canonical profile. Also record today's initial residence as a dated event in today's daily note.")
            report["before"]=sources(memory,scope)
            report["checks"]["initialModelWrite"]="ankara" in report["before"]["canonical"]["text"].lower() and "jasmine" in report["before"]["canonical"]["text"].lower()
            checkpoint("initial model write")
            a.turn("I have now moved from Ankara to Istanbul. Istanbul is my current home; Ankara is my previous home. Read the saved notes. Update my canonical profile and retain my tea preference. Update today's daily note so it retains the dated history and records this move clearly.")
            report["afterUpdate"]=sources(memory,scope)
            report["searchAfterUpdate"]={q:memory.search(scope,q) for q in ["Istanbul","Ankara","jasmine"]}
            canonical=report["afterUpdate"]["canonical"]["text"].lower()
            report["checks"]["updatedCanonical"]="istanbul" in canonical
            report["checks"]["unrelatedTeaRetained"]="jasmine" in canonical
            report["checks"]["indexedNewResidence"]=any(r["path"]=="memory/preference.md" for r in report["searchAfterUpdate"]["Istanbul"]["results"])
            report["checks"]["historyRetainedInDaily"]="ankara" in report["afterUpdate"]["daily"]["text"].lower()
            checkpoint("model correction and indexed search")
            # Repeat the actual model-generated text through the same public tool adapter.
            # This is an idempotence check, not a new authored fact or a repaired model output.
            report["repeatWrite"]=a.tools.execute("memory_save",{"text":report["afterUpdate"]["canonical"]["text"]})
            report["checks"]["repeatWriteStable"]=memory.get(scope,"memory/preference.md",lines=200)["text"]==report["afterUpdate"]["canonical"]["text"]
            report["maintenance"]=schedule_runs(MaintenanceJob(memory,scope),count=1)[0]
            memory.index(scope)
            report["afterMaintenance"]=sources(memory,scope)
            try: report["afterMaintenance"]["durable"]=memory.get(scope,"MEMORY.md",lines=200)
            except FoundationError as error: report["afterMaintenance"]["durable"]={"unavailable":str(error)}
            report["searchAfterMaintenance"]={q:memory.search(scope,q) for q in ["Istanbul","Ankara"]}
            report["checks"]["nativeSchedulerRunCompleted"]=report["maintenance"]["sweep"].get("completed") is True and report["maintenance"]["sweep"].get("completionStatus")=="succeeded"
            report["checks"]["nativeDiaryPublishersCompleted"]=all(v=="completed" for v in report["maintenance"]["publishers"].values())
            report["checks"]["canonicalUnchangedByMaintenance"]=report["afterMaintenance"]["canonical"]["text"]==report["afterUpdate"]["canonical"]["text"]
            checkpoint("native host-scheduled maintenance")
        # A new bridge process, native Gateway and empty host conversation use the same files.
        fresh=MemoryScope(scope.workspace,scope.user,"after-process-restart")
        with MemoryClient(BridgeConfig(foundation,root/"memory",timeout=300)) as memory:
            report["reconfiguration"]=memory.configure_maintenance(fresh,cumulative_limit_usd=50,host_reserve_usd=HOST_ENVELOPE_USD)
            report["afterRestart"]=sources(memory,fresh)
            report["searchAfterRestart"]=memory.search(fresh,"Istanbul")
            b=agent(provider,memory,fresh)
            try:b.turn("Where do I live now, and what tea do I prefer? Search and read saved sources. Distinguish my current home from my previous home.")
            finally:report["conversation"].extend(b.trace)
            reply=(b.trace[-1].get("reply") or "").lower()
            report["checks"]["newSessionRecall"]="istanbul" in reply and "jasmine" in reply and any(r["name"]=="memory_get" for step in b.trace[-1]["calls"] for r in step["results"])
            report["checks"]["canonicalPersistsAcrossProcessRestart"]=report["afterRestart"]["canonical"]["text"]==report["afterUpdate"]["canonical"]["text"]
            for label,other in [("otherUser",MemoryScope(scope.workspace,"synthetic-noor","control")),("otherWorkspace",MemoryScope("residence-control",scope.user,"control"))]:
                memory.configure(other);memory.index(other)
                hits=memory.search(other,"Istanbul jasmine Ankara")
                report[label]=hits;report["checks"][label+"Isolation"]=not hits["results"]
            report["afterBudget"]=memory.configure_maintenance(fresh,cumulative_limit_usd=50,host_reserve_usd=HOST_ENVELOPE_USD)["budget"]
        report["hostLedger"]=json.loads(host_ledger.read_text())
        report["nativeLedger"]=json.loads((root/"memory/sdk-maintenance-ledger.json").read_text())
        report["previousLedgersAfter"]=prior()
        report["checks"]["previousLedgersUnchanged"]=report["previousLedgersAfter"]==report["previousLedgersBefore"]
        report["ok"]=all(report["checks"].values());checkpoint("complete")
    except Exception as error:
        report["error"]=type(error).__name__+": "+(str(error.code) if isinstance(error,urllib.error.HTTPError) else str(error));checkpoint("incomplete")
    finally:save()
    print(json.dumps({"ok":report["ok"],"checks":report["checks"],"error":report.get("error")}),flush=True)
    return 0 if report["ok"] else 2


if __name__=="__main__":raise SystemExit(main())

"""Continue a retained synthetic workspace through the installed SDK only.

Requires the recorded Vega native fixture; it never fabricates lineage or writes
MEMORY.md directly. The low-level public call API addresses its existing name.
"""
from __future__ import annotations
import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re
from openclaw_memory_bridge import BridgeConfig, MemoryClient

FACT = "Synthetic Project Vega uses amber filters every Friday."
PROJECT = "github.com/DorukhanArslan/openclaw-memory-bridge"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--foundation", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--workspace", default="provenance")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    ledger = args.root / "sdk-maintenance-ledger.json"
    if ledger.exists() and json.loads(ledger.read_text()).get("requests", 0):
        parser.error("This retained SDK continuation has already dispatched requests. Inspect the saved report; do not reset or rename its ledger to replay it.")
    foundation = args.foundation.resolve()
    report = {"ok": False, "kind": "real installed SDK / native duplicate consolidation", "workspace": args.workspace,
              "adapter": "Public JSONL SDK call selects the retained named synthetic workspace. Canonical daily writes are application adapters; MEMORY.md is written exclusively by native consolidation.", "checks": {}}
    prior_path = foundation / "evidence/provenance-merge-acceptance/request-ledger.json"
    prior = json.loads(prior_path.read_text())
    report["priorNativeLedger"] = prior
    args.report.parent.mkdir(parents=True, exist_ok=True)
    try:
        with MemoryClient(BridgeConfig(foundation, args.root, timeout=360)) as memory:
            def call(op, **kwargs): return memory.call(op, args.workspace, **kwargs)
            report["configuration"] = call("configure_maintenance", cumulativeLimitUsd=50, hostReserveUsd=0)
            before = call("get", path="MEMORY.md", lines=200)
            report["before"] = before
            if FACT not in before["text"] or not all(x in before["text"] for x in ["silver notebooks", "paper charts", "brass clocks", "white folders"]):
                raise RuntimeError("Retained genuine Vega corpus and unrelated entries are required.")
            day = date.today().isoformat()
            report["sourceWrite"] = call("write_daily", day=day, text=FACT+" <!-- project: "+PROJECT+" -->")
            call("index")
            report["recalls"] = [call("search", query=q, session="sdk-merge") for q in ["Vega amber", "amber Friday", "Vega filters"]]
            report["candidateExplanation"] = call("explain_promotion", selector="memory/"+day+".md")
            report["diaryBefore"] = call("dream_diary")
            report["maintenance"] = call("run_maintenance")
            report["after"] = call("get", path="MEMORY.md", lines=200)
            report["diaryAfter"] = call("dream_diary")
            # Diary rewrites insert into earlier sections, so compare accepted
            # consolidation-history summaries by occurrence count, not a suffix.
            prior_summaries = re.findall(r"- Added: (\d+)\s+- Merged: (\d+)\s+- Superseded: (\d+)",report["diaryBefore"].get("content", ""))
            after_summaries = re.findall(r"- Added: (\d+)\s+- Merged: (\d+)\s+- Superseded: (\d+)",report["diaryAfter"]["content"])
            report["newConsolidationSummaries"] = after_summaries[len(prior_summaries):]
            checks = report["checks"]
            checks["newAcceptedNativeMerge"] = any(int(s[1]) > 0 for s in report["newConsolidationSummaries"])
            checks["singleFactWithNewSource"] = report["after"]["text"].count(FACT)==1 and f"Source: memory/{day}.md#L" in report["after"]["text"]
            checks["unrelatedEntriesPreserved"] = all(x in report["after"]["text"] for x in ["silver notebooks", "paper charts", "brass clocks", "white folders"])
            checks["nativeCompleted"] = report["maintenance"]["sweep"].get("completed") is True and report["maintenance"]["sweep"].get("completionStatus")=="succeeded"
            checks["modelDiarySeparate"] = all(x=="completed" for x in report["maintenance"]["publishers"].values())
            call("index");call("restart")
            report["afterRestart"] = call("get", path="MEMORY.md", lines=200)
            report["recallAfterRestart"] = call("search", query="Vega amber", session="sdk-merge-restart")
            checks["persistentMerge"] = report["afterRestart"]["text"]==report["after"]["text"] and any(h["path"]=="MEMORY.md" for h in report["recallAfterRestart"]["results"])
            report["afterBudget"] = call("configure_maintenance", cumulativeLimitUsd=50, hostReserveUsd=0)["budget"]
            report["supersession"] = {"status":"unsupported by this pinned SDK Markdown path", "reason":"Native resolveChunkProvenance returns originClass/sessionKind/observedAt for memory sources, not supersedesKey. validateConsolidationPlan requires candidate.provenance.supersedesKey and matching durable lineage before accepting superseded. App replacement cannot establish that provenance.", "notClaimed":"No fabricated lineage, private database edits or force-supersession endpoint."}
            report["contracts"] = {}
            for name in ["manager-index-preparation-wXpJtJiU.mjs","short-term-promotion-MX1vHJuE.mjs"]:
                report["contracts"][name] = hashlib.sha256((foundation/"node_modules/openclaw/dist"/name).read_bytes()).hexdigest()
            report["priorNativeLedgerAfter"] = json.loads(prior_path.read_text())
            checks["priorLedgerPreserved"] = report["priorNativeLedgerAfter"]==prior
            report["ok"] = all(checks.values())
    except Exception as error:
        report["error"] = type(error).__name__+": "+str(error)
    finally:
        args.report.write_text(json.dumps(report,indent=2))
        print(json.dumps({"ok":report["ok"],"checks":report["checks"],"error":report.get("error"),"report":str(args.report)}))
    return 0 if report["ok"] else 2

if __name__=="__main__": raise SystemExit(main())

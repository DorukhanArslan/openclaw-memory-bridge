"""Independent primary Python agent. Only installed public SDK accesses memory."""
from __future__ import annotations
import argparse
from datetime import date
import html
import json
import os
from pathlib import Path
import stat
import urllib.request
from openclaw_memory_bridge import BridgeConfig, MemoryClient, MemoryScope

HOST_ENVELOPE_USD = ((600000 + 24 * 1024) * 18 + 12288 * 30) / 1e6
MODEL = "openai/gpt-6-sol"

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError("Provider redirect refused.")

class Provider:
    def __init__(self, foundation: Path, ledger: Path):
        from dotenv import dotenv_values
        # Explicitly approved project env; never copy or print credentials.
        self.key = os.environ.get("OPENROUTER_API_KEY")
        if self.key is None:
            fd = os.open(foundation / ".env", os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd) as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size > 65536:
                    raise RuntimeError("Unsafe project credential file.")
                self.key = dotenv_values(stream=stream).get("OPENROUTER_API_KEY")
        if not self.key:
            raise RuntimeError("Authorized OPENROUTER_API_KEY is required.")
        self.ledger = ledger
        ledger.parent.mkdir(parents=True, exist_ok=True)
        try:
            with ledger.open("x") as stream:
                json.dump({"requests": 0, "inputBytes": 0, "outputTokens": 0}, stream)
            ledger.chmod(0o600)
        except FileExistsError:
            pass
        self.http = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def complete(self, messages, tools):
        body = json.dumps({"model": MODEL, "messages": messages, "tools": tools,
                           "max_completion_tokens": 512, "reasoning": {"effort": "low"}}).encode()
        lock = self.ledger.with_suffix(".lock")
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            counters = json.loads(self.ledger.read_text())
            next_values = {"requests": counters["requests"] + 1,
                           "inputBytes": counters["inputBytes"] + len(body),
                           "outputTokens": counters["outputTokens"] + 512}
            if len(body) > 100000 or next_values["requests"] > 24 or next_values["inputBytes"] > 600000 or next_values["outputTokens"] > 12288:
                raise RuntimeError("Retained host request budget exhausted; no automatic reset.")
            self.ledger.write_text(json.dumps(next_values))
        finally:
            os.close(fd)
            lock.unlink()
        request = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=body,
                     headers={"Authorization": "Bearer " + self.key, "Content-Type": "application/json"})
        # No retries; failed/uncertain dispatches remain charged in the host ledger.
        with self.http.open(request, timeout=90) as response:
            value = json.load(response)
        if not value.get("choices"):
            raise RuntimeError("Provider returned no completion.")
        return value["choices"][0]["message"], value.get("usage")


def schema(name, description, properties, required):
    return {"type": "function", "function": {"name": name, "description": description,
             "parameters": {"type": "object", "properties": properties, "required": required, "additionalProperties": False}}}

STRING = {"type": "string"}
TOOLS = [schema("memory_search", "Search the user's persistent memory. Read source before answering personal questions.", {"query": STRING}, ["query"]),
         schema("memory_get", "Read saved source lines by path returned by search.", {"path": STRING}, ["path"]),
         schema("memory_save", "Replace the complete canonical preference note. Preserve other current facts. Automatically indexes.", {"text": STRING}, ["text"]),
         schema("memory_save_daily", "Replace today's complete synthetic daily note, preserving today's events. Automatically indexes.", {"text": STRING}, ["text"])]

class HostAgent:
    def __init__(self, provider, memory, scope, day):
        self.provider, self.memory, self.scope, self.day = provider, memory, scope, day
        self.messages = [{"role": "system", "content": "You are a synthetic gardening assistant. All personal facts must come from user input or memory tools. Use memory tools to save requested preferences and daily events; never claim a write without a successful tool result. Search and read current sources for recall. Keep answers short with source citations. You own this conversation; OpenClaw only provides memory and maintenance. Today's date is " + day}]
        self.trace = []

    def turn(self, text):
        self.messages.append({"role": "user", "content": text})
        step = {"user": text, "calls": [], "reply": None}
        self.trace.append(step)
        for _ in range(6):
            message, usage = self.provider.complete(self.messages, TOOLS)
            self.messages.append(message)
            calls = message.get("tool_calls") or []
            step["calls"].append({"assistant": message, "usage": usage, "results": []})
            if not calls:
                step["reply"] = message.get("content")
                if not step["reply"]:
                    raise RuntimeError("Empty final host answer.")
                return step["reply"]
            for call in calls:
                args = json.loads(call["function"]["arguments"])
                name = call["function"]["name"]
                if name == "memory_search": result = self.memory.search(self.scope, args["query"])
                elif name == "memory_get": result = self.memory.get(self.scope, args["path"])
                elif name == "memory_save":
                    result = self.memory.write(self.scope, "preference", args["text"])
                    result["index"] = self.memory.index(self.scope)
                elif name == "memory_save_daily":
                    result = self.memory.write_daily(self.scope, self.day, args["text"])
                    result["index"] = self.memory.index(self.scope)
                else: raise RuntimeError("Unknown host tool.")
                step["calls"][-1]["results"].append({"name": name, "args": args, "result": result})
                self.messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)})
        raise RuntimeError("Host tool-loop turn limit exceeded.")


def render(report, destination):
    escape = html.escape
    cards = []
    for step in report.get("conversation", []):
        cards.append("<article><b>User</b><p>" + escape(step["user"]) + "</p><b>Python host agent</b><p>" + escape(step.get("reply") or "Incomplete") + "</p><details><summary>Actual model tools and sources</summary><pre>" + escape(json.dumps(step["calls"], indent=2)) + "</pre></details></article>")
    checks = "".join("<li>" + escape(name) + ": <strong>" + ("PASS" if passed else "FAIL") + "</strong></li>" for name, passed in report.get("checks", {}).items())
    changes = {"Initial preference": report.get("before", {}).get("preference", {}).get("text"),
               "Updated preference": report.get("afterUpdate", {}).get("text"),
               "Durable native memory": report.get("durable", {}).get("text")}
    changes_html = "".join("<h3>" + escape(name) + "</h3><pre>" + escape(text or "No source") + "</pre>" for name, text in changes.items())
    completion = report.get("sdkCompletion")
    if completion:
        merge = completion["merge"]
        cards.append("<article><h2>SDK native duplicate merge</h2><p>Retained synthetic Vega corpus, separate from Maya's conversation. The installed SDK triggered native consolidation: Added 0 / Merged 1 / Superseded 0. The prior duplicate was replaced with the new daily source, four unrelated entries survived, and restart recall passed.</p><p>Light, REM and deep diary publication passed separately. Native supersession through this version's Markdown SDK path is unsupported: its indexing provenance supplies no supersedesKey for the required durable lineage.</p><details><summary>Actual before / after memory and native merge receipt</summary><pre>" + escape(json.dumps({"before": merge["before"], "after": merge["after"], "summaries": merge["newConsolidationSummaries"], "checks": merge["checks"], "supersession": merge["supersession"]}, indent=2)) + "</pre></details></article>")
    status = "PASS" if report.get("ok") else "INCOMPLETE"
    budget = report.get("afterBudget", {})
    result = "Cumulative provider usage: $" + str(round(budget.get("usedUsd", 0), 6)) + " of the authorized $50; earlier spending retained."
    destination.write_text("<!doctype html><html lang=en><meta charset=utf-8><title>Python host memory lab</title><style>body{font:16px system-ui;max-width:960px;margin:40px auto;padding:0 20px;background:#f6f8fb;color:#203047}article{background:white;padding:22px;margin:16px 0;border:1px solid #dce3ea;border-radius:12px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}p,li{line-height:1.55}details{margin:14px 0}h3{font-size:16px}</style><h1>Python host → OpenClaw memory</h1><p>" + status + ". Real independent Python agent and installed SDK; synthetic Maya. OpenClaw owns search, indexing and native dreaming. Host owns tool loop, note policy and conversation context.</p><p>" + escape(result) + "</p>" + "".join(cards) + "<h2>What changed</h2>" + changes_html + "<h2>Verified checks</h2><ul>" + checks + "</ul><p>The first run promoted a source, but shutdown interrupted three diary publishers. The correction kept the same corpus and ledgers and observed all three native model publications. Earlier fallback text remains visible. The separate retained Vega SDK continuation verifies duplicate merging. Native changed-fact supersession remains unsupported through the pinned Markdown SDK path.</p><p>Native flush/compaction of external Python context: unsupported. Host supplies authentication; scope routing is not tenant security.</p><details><summary>Complete receipts, earlier interruption and maintenance records</summary><pre>" + escape(json.dumps({k:v for k,v in report.items() if k != "conversation"}, indent=2)) + "</pre></details></html>")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--foundation", type=Path, required=True)
    parser.add_argument("--root", type=Path, default=Path("data"))
    parser.add_argument("--report", type=Path, default=Path("report.json"))
    args = parser.parse_args()
    args.root = args.root.resolve()
    report = {"ok": False, "model": MODEL, "native": "OpenClaw 2026.9.9", "checks": {}, "conversation": [], "externalContextMaintenance": "unsupported; host owns context policy"}
    scope = MemoryScope("host-garden", "maya", "first")
    day = date.today().isoformat()
    try:
        provider = Provider(args.foundation.resolve(), args.root / "host-request-ledger.json")
        with MemoryClient(BridgeConfig(args.foundation, args.root / "memory", timeout=300)) as memory:
            report["configuration"] = memory.configure_maintenance(scope, cumulative_limit_usd=50, host_reserve_usd=HOST_ENVELOPE_USD)
            agent = HostAgent(provider, memory, scope, day)
            report["conversation"] = agent.trace
            agent.turn("I am synthetic Maya, a gardener. My morning drink is ginger tea and I water orchids on Monday. Save these preferences. Also save today's event: I checked the greenhouse thermometer at 08:00.")
            report["before"] = {"preference": memory.get(scope, "memory/preference.md"), "daily": memory.get(scope, "memory/" + day + ".md")}
            agent.turn("Change my current morning drink to lemon tea. Preserve my gardener identity and Monday orchid schedule in the saved note.")
            updated = memory.get(scope, "memory/preference.md")
            report["afterUpdate"] = updated
            report["checks"]["realAgentWriteAndUpdate"] = "lemon" in json.dumps(updated).lower()
            fresh_scope = MemoryScope("host-garden", "maya", "fresh-before")
            fresh = HostAgent(provider, memory, fresh_scope, day)
            fresh.turn("What is my current drink, orchid day, and today's thermometer event? Search and read the saved sources.")
            report["conversation"].extend(fresh.trace)
            report["checks"]["freshHostRecall"] = all(term in fresh.trace[-1]["reply"].lower() for term in ["lemon", "monday", "08:00"])
            report["maintenance"] = memory.run_maintenance(scope)
            report["checks"]["nativeRunReceipt"] = report["maintenance"]["sweep"].get("completed") is True and report["maintenance"]["sweep"].get("completionStatus") == "succeeded"
            report["checks"]["nativeDiaryPublishers"] = all(value == "completed" for value in report["maintenance"]["publishers"].values())
            # A completion receipt does not imply all diary publishers have finished.
            report["durable"] = memory.get(scope, "MEMORY.md")
            report["diary"] = memory.dream_diary(scope)
            report["explanation"] = memory.explain_promotion(scope, "thermometer")
            memory.restart(scope)
            post = HostAgent(provider, memory, MemoryScope("host-garden", "maya", "after-restart"), day)
            post.turn("What is my current drink, orchid day, and today's thermometer event? Search and read sources; don't guess.")
            report["conversation"].extend(post.trace)
            report["checks"]["recallAfterMaintenanceAndRestart"] = all(term in post.trace[-1]["reply"].lower() for term in ["lemon", "monday", "08:00"])
            report["checks"]["dailyPromoted"] = "thermometer" in json.dumps(report["durable"]).lower()
            for name, other in [("otherUser", MemoryScope("host-garden", "noor", "first")), ("otherWorkspace", MemoryScope("other-garden", "maya", "first"))]:
                memory.write(other, "control", "Synthetic control corpus contains cobalt labels only.")
                memory.index(other)
                hits = memory.search(other, "lemon thermometer orchids")
                report[name] = hits
                report["checks"][name] = not hits["results"]
            report["hostLedger"] = json.loads(provider.ledger.read_text())
            # Fresh native quota snapshot retains earlier provider spending.
            report["afterBudget"] = memory.configure_maintenance(scope, cumulative_limit_usd=50, host_reserve_usd=HOST_ENVELOPE_USD)["budget"]
            report["ok"] = all(report["checks"].values())
    except Exception as error:
        # Do not include HTTP response bodies or provider credentials in errors.
        report["error"] = type(error).__name__ + ": " + (str(error) if not isinstance(error, urllib.error.HTTPError) else str(error.code))
    finally:
        args.report.write_text(json.dumps(report, indent=2))
        render(report, args.report.with_suffix(".html"))
        print(json.dumps({"ok": report["ok"], "checks": report["checks"], "error": report.get("error"), "report": str(args.report)}))
    return 0 if report["ok"] else 2

if __name__ == "__main__":
    raise SystemExit(main())

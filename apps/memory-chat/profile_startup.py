"""Opt-in timing probe using the real SDK/Gateway and labelled model replies.

This runs actual native processes in a fresh temporary corpus. Model completions
are immediate local protocol fixtures: no provider request, API key, inference,
or paid call is used. Timings describe this machine, not model response latency.
Run with --warmup to measure the app's background preparation before messaging.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import platform
import shutil
import tempfile
import time

from openclaw_memory_bridge import MemoryClient

from provider import Provider
from server import NativeChatDemo


FOUNDATION = Path(__file__).resolve().parents[2]
PROMPTS = ("Hello. This is a startup timing probe.",
           "Hello again. This is a warm timing probe.")


def profile(*, output: Path, warmup: bool = False) -> dict:
    started = time.perf_counter()
    record = {
        "kind": "actual-native-startup-immediate-protocol-fixture",
        "genuineModel": False,
        "paidProviderCalls": 0,
        "samples": 1,
        "system": platform.system(),
        "architecture": platform.machine(),
        "pythonVersion": platform.python_version(),
        "warmup": warmup,
        "clientCalls": [],
        "modelCalls": [],
        "turns": [],
    }

    def elapsed():
        return round(time.perf_counter() - started, 6)

    def emit(event, **fields):
        print(json.dumps({"event": event, "observedSeconds": elapsed(), **fields}), flush=True)

    class TimedClient(MemoryClient):
        def __init__(self, config):
            begin = elapsed()
            super().__init__(config)
            record["clientConstructionSeconds"] = round(elapsed() - begin, 6)
            emit("stdio-ready")

        def call(self, op, workspace="alpha", **kwargs):
            begin = elapsed()
            call = {"op": op, "startedSeconds": begin}
            try:
                result = super().call(op, workspace, **kwargs)
                call["ok"] = True
                return result
            except Exception as error:
                call["ok"], call["error"] = False, repr(error)
                raise
            finally:
                call["elapsedSeconds"] = round(elapsed() - begin, 6)
                record["clientCalls"].append(call)
                emit("sdk-operation", **call)

    class ImmediateModelProtocolFixture:
        ready = True

        def state(self):
            return {"limitUsd": 0, "remainingUsd": 0, "reservedUsd": 0,
                    "requests": len(record["modelCalls"]), "fixture": True}

        def status(self):
            return {"ready": True, "reason": None}

        def complete(self, messages, tools):
            Provider._validate_input(messages, tools)
            names = sorted(tool["function"]["name"] for tool in tools)
            record["modelCalls"].append({"startedSeconds": elapsed(), "toolNames": names})
            emit("fixture-model-call", number=len(record["modelCalls"]))
            # The native recall helper has a different tool set from the main
            # agent. Neither response claims genuine model behavior or recall.
            text = "Startup timing protocol fixture: hello." if "sessions_search" in names else "NONE"
            return {"role": "assistant", "content": text}, {
                "prompt_tokens": 100, "completion_tokens": 10,
                "total_tokens": 110, "fixture": True,
            }

    root = Path(tempfile.mkdtemp(prefix=".lab-test-startup-profile-", dir=FOUNDATION))
    demo = None
    passed = False
    try:
        demo = NativeChatDemo(FOUNDATION, root, ImmediateModelProtocolFixture(),
                              client_factory=TimedClient)
        record["hostConstructionSeconds"] = elapsed()
        if warmup:
            begin = elapsed()
            demo.start_warmup()
            deadline = time.monotonic() + 90
            while True:
                connection = demo.state().get("memory", {}).get("connection", {})
                status = connection.get("status")
                if status == "ready":
                    break
                if status == "failed":
                    raise RuntimeError("Native warmup failed: " + str(connection.get("error", "unknown error")))
                if time.monotonic() >= deadline:
                    raise TimeoutError("Native warmup did not finish within 90 seconds.")
                time.sleep(0.05)
            record["warmupSeconds"] = round(elapsed() - begin, 6)
            record["warmupModelCalls"] = len(record["modelCalls"])
            if record["warmupModelCalls"] != 0:
                raise AssertionError("Background preparation dispatched a model request.")
            emit("warmup-completed", elapsedSeconds=record["warmupSeconds"], modelCalls=0)

        for number, prompt in enumerate(PROMPTS, 1):
            begin = elapsed()
            models_before = len(record["modelCalls"])
            reply = demo.chat(prompt)
            turn = {
                "number": number,
                "startedSeconds": begin,
                "elapsedSeconds": round(elapsed() - begin, 6),
                "reply": reply,
                "nativeTranscriptPersisted": demo.conversation["native"]["transcriptPersisted"],
                "newModelCalls": len(record["modelCalls"]) - models_before,
            }
            if len(record["modelCalls"]) > models_before:
                turn["untilFirstModelSeconds"] = round(
                    record["modelCalls"][models_before]["startedSeconds"] - begin, 6)
            record["turns"].append(turn)
            emit("turn-completed", **turn)
        record["ok"] = passed = True
    except BaseException as error:
        record["ok"], record["error"] = False, repr(error)
        record["diagnosticRoot"] = str(root)
        raise
    finally:
        begin = elapsed()
        try:
            if demo is not None:
                demo.close()
        except BaseException as error:
            passed = record["ok"] = False
            record["cleanupError"] = repr(error)
            record["diagnosticRoot"] = str(root)
            raise
        finally:
            record["closeSeconds"] = round(elapsed() - begin, 6)
            record["totalSeconds"] = elapsed()
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(record, indent=2) + "\n")
            if passed:
                shutil.rmtree(root)
            emit("profile-finished", output=str(output), ok=passed)
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path,
                        default=FOUNDATION / ".bootstrap" / "memory-chat-startup-profile.json")
    parser.add_argument("--warmup", action="store_true",
                        help="Wait for background native preparation before sending the first probe message.")
    args = parser.parse_args()
    profile(output=args.output, warmup=args.warmup)


if __name__ == "__main__":
    main()

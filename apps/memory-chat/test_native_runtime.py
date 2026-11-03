"""Actual native chat/session integration with a labelled model wire fixture.

The installed SDK, Gateway, transcripts, search, history and index are real.
Only model responses are a protocol fixture; no external model call is made.
"""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import shutil
import tempfile
import time
import unittest

from provider import MODEL, Provider, _encoded
from server import NativeChatDemo


FOUNDATION = Path(__file__).resolve().parents[2]
FACT = "I take my coffee without sugar."
QUESTION = "How do I take my coffee?"
PRIVATE_REASONING = "NATIVE_OPAQUE_REASONING_PROTOCOL_FIXTURE"


def records(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from records(child)
    elif isinstance(value, list):
        for child in value:
            yield from records(child)


class NativeModelProtocolFixture:
    """Choose native tools; accept the fact only from their actual results."""

    evidence_kind = "protocol-fixture"
    ready = True

    def __init__(self):
        self.calls = []
        self.reads = []
        self.reasoning_diagnostics = []

    def status(self):
        return {"ready": True, "reason": None}

    def state(self):
        return {"limitUsd": 0, "reservedUsd": 0, "remainingUsd": 0,
                "requests": len(self.calls), "fixture": True}

    def tool(self, name, **arguments):
        call_id = "native-fixture-" + str(len(self.calls))
        return {"role": "assistant", "content": None, "tool_calls": [{
            "id": call_id, "type": "function",
            "function": {"name": name, "arguments": json.dumps(arguments)},
        }], "reasoning_details": [{"type": "reasoning.encrypted", "id": call_id,
                                    "data": PRIVATE_REASONING, "format": "openai-responses-v1"}]}

    def complete(self, messages, tools):
        Provider._validate_input(messages, tools)
        payload = {"model": MODEL, "messages": messages, "tools": tools,
                   "max_completion_tokens": 512, "reasoning": {"effort": "low"}}
        body_bytes = len(_encoded(payload))
        names = {tool["function"]["name"] for tool in tools}
        self.calls.append({"tools": sorted(names), "requestBytes": body_bytes,
                           "estimatedReservationUsd": round((body_bytes + 1024) * 0.000009 + 512 * 0.000020, 9)})
        if "sessions_search" not in names:
            # Native Active Memory helper, if its intent policy selects it.
            return {"role": "assistant", "content": "NONE"}, {"fixture": True}
        user = next(message["content"] for message in reversed(messages) if message["role"] == "user")
        if QUESTION not in user:
            assert FACT in user
            answer = {"role": "assistant", "content": "Protocol fixture: received your coffee preference."}
        elif messages[-1]["role"] != "tool":
            # A fresh native session must not inherit the first chat's input.
            assert not any(FACT in (message.get("content") or "")
                           for message in messages if message["role"] == "user")
            answer = self.tool("sessions_search", query="coffee")
        else:
            source = json.loads(messages[-1]["content"])
            self.reads.append(deepcopy(source))
            previous = next(message for message in reversed(messages[:-1])
                            if message["role"] == "assistant" and message.get("tool_calls"))
            call_id = previous["tool_calls"][0]["id"]
            expected = [{"type": "reasoning.encrypted", "id": call_id,
                         "data": PRIVATE_REASONING, "format": "openai-responses-v1"}]
            diagnostic = {"expected": expected, "actual": previous.get("reasoning_details"),
                          "assistantFields": sorted(previous)}
            self.reasoning_diagnostics.append(diagnostic)
            assert diagnostic["actual"] == expected, json.dumps(diagnostic)
            name = previous["tool_calls"][0]["function"]["name"]
            if name == "sessions_search":
                hit = next(record for record in records(source)
                           if all(key in record for key in ["sessionKey", "sessionId", "messageId"])
                           and "without sugar" in json.dumps(record).lower())
                answer = self.tool("sessions_history", sessionKey=hit["sessionKey"],
                                   sessionId=hit["sessionId"], messageId=hit["messageId"], limit=8)
            else:
                assert name == "sessions_history"
                assert FACT in json.dumps(source)
                answer = {"role": "assistant", "content": "Protocol fixture: you take your coffee without sugar, verified through native session search and history."}
        return answer, {"prompt_tokens": 100, "completion_tokens": 10, "total_tokens": 110}


class NativeRuntimeAcceptance(unittest.TestCase):
    def test_production_host_uses_native_transcripts_and_recall_in_a_fresh_context(self):
        root = Path(tempfile.mkdtemp(prefix=".lab-test-native-chat-production-", dir=FOUNDATION))
        provider = NativeModelProtocolFixture()
        demo = None
        passed = False
        receipt = {"kind": "actual-native-runtime-labelled-model-fixture",
                   "genuineModel": False, "paidProviderCalls": 0}
        started = time.monotonic()
        try:
            demo = NativeChatDemo(FOUNDATION, root, provider)
            first_scope = demo.scope
            demo.chat(FACT)
            self.assertTrue(demo.conversation["native"]["transcriptPersisted"])
            self.assertIn(FACT, json.dumps(demo.memory.session_history(first_scope)))
            receipt["firstNativeSession"] = deepcopy(demo.conversation["native"])
            demo.new_conversation()
            self.assertNotEqual(demo.scope.session, first_scope.session)
            self.assertEqual(demo.scope.routing_workspace, first_scope.routing_workspace)
            self.assertEqual(demo.conversation["messages"], [])
            self.assertTrue(demo.conversations[-2]["native"]["indexed"])
            reply = demo.chat(QUESTION)
            self.assertIn("without sugar", reply)
            self.assertEqual(len(provider.reads), 2)
            self.assertEqual(provider.reads[1]["sessionKey"], receipt["firstNativeSession"]["sessionKey"])
            self.assertIn(FACT, json.dumps(provider.reads[1]))
            receipt["capture"] = demo.export()
            self.assertNotIn(PRIVATE_REASONING, json.dumps(receipt["capture"]))
            receipt["nativeToolReads"] = provider.reads
            receipt["normalizedRequests"] = provider.calls
            receipt["estimatedReservationUsd"] = round(sum(call["estimatedReservationUsd"] for call in provider.calls), 9)
            receipt["ok"] = passed = True
        except Exception as error:
            receipt["ok"], receipt["error"] = False, repr(error)
            receipt["diagnosticRoot"] = str(root)
            raise
        finally:
            if demo is not None:
                demo.close()
            receipt["elapsedSeconds"] = round(time.monotonic() - started, 2)
            receipt["normalizedRequests"] = provider.calls
            receipt["reasoningDiagnostics"] = provider.reasoning_diagnostics
            output = FOUNDATION / ".bootstrap" / "native-chat-production-fixture.json"
            output.parent.mkdir(exist_ok=True)
            output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
            if passed:
                shutil.rmtree(root)
            else:
                print(f"Native runtime diagnostics retained under {root}")


if __name__ == "__main__":
    unittest.main()

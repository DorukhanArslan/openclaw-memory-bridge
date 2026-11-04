"""Bound native model calls through the demo's existing retained allowance.

OpenClaw owns its messages, tools, sessions, recall and flush. This loopback
adapter supplies an OpenAI-compatible transport for the fixed demo Provider.
The upstream response is buffered, then encoded as genuine SSE deltas when
requested; it does not fabricate model text or implement a second agent loop.
"""
from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import secrets
import threading
import time
from urllib.parse import urlsplit
import uuid

from provider import MODEL, Provider


MAX_REQUEST_BYTES = 128_000
OUTPUT_TOKENS = 512


def _encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON fields are not supported.")
        result[key] = value
    return result


def _invalid_constant(_):
    raise ValueError("Non-finite JSON values are not supported.")


def native_request(payload):
    """Validate the fixed text transport; retain all message/tool semantics.

    Only text content parts are flattened. Developer instructions map to the
    system role supported by this demo transport. Unsupported request options
    are rejected instead of being silently dropped or forwarded upstream.
    """
    if not isinstance(payload, dict):
        raise ValueError("Supply a JSON object.")
    allowed = {"model", "messages", "tools", "stream", "stream_options", "store",
               "max_tokens", "max_completion_tokens", "tool_choice",
               "parallel_tool_calls", "reasoning", "reasoning_effort"}
    if set(payload) - allowed:
        raise ValueError("Unsupported native model request fields.")
    if payload.get("model") != MODEL:
        raise ValueError("Only the configured demo model is supported.")
    if type(payload.get("stream", False)) is not bool:
        raise ValueError("Stream must be a boolean.")
    options = payload.get("stream_options")
    if options is not None and (not isinstance(options, dict)
            or set(options) - {"include_usage"}
            or type(options.get("include_usage", False)) is not bool):
        raise ValueError("Unsupported streaming options.")
    if "store" in payload and payload["store"] is not False:
        raise ValueError("Stored provider completions are not supported.")
    if "max_tokens" in payload and "max_completion_tokens" in payload:
        raise ValueError("Supply only one native output bound.")
    output = payload.get("max_completion_tokens", payload.get("max_tokens", OUTPUT_TOKENS))
    if type(output) is not int or output != OUTPUT_TOKENS:
        raise ValueError("The native output bound must match the fixed 512-token demo policy.")
    if "tool_choice" in payload and payload["tool_choice"] != "auto":
        raise ValueError("Only automatic native tool selection is supported.")
    if "parallel_tool_calls" in payload and payload["parallel_tool_calls"] is not True:
        raise ValueError("Unsupported native parallel-tool override.")
    if "reasoning_effort" in payload and payload["reasoning_effort"] != "low":
        raise ValueError("The native reasoning setting must match the fixed demo policy.")
    if "reasoning" in payload and payload["reasoning"] != {"effort": "low"}:
        raise ValueError("The native reasoning setting must match the fixed demo policy.")
    messages = payload.get("messages")
    if not isinstance(messages, list) or not messages or len(messages) > 200:
        raise ValueError("Invalid native model conversation.")
    normalized = []
    for message in messages:
        if not isinstance(message, dict):
            raise ValueError("Invalid native model message.")
        item = deepcopy(message)
        if item.get("role") == "developer":
            item["role"] = "system"
        content = item.get("content")
        if isinstance(content, list):
            if any(not isinstance(part, dict) or set(part) != {"type", "text"}
                   or part["type"] != "text" or not isinstance(part["text"], str)
                   for part in content):
                raise ValueError("The native demo transport supports text content only.")
            item["content"] = "\n".join(part["text"] for part in content)
        normalized.append(item)
    tools = deepcopy(payload.get("tools", []))
    return normalized, tools


class NativeProviderBroker:
    """One loopback endpoint and one explicit native-operation admission window.

    Use ``with broker.turn():`` around a requested native operation. Model calls
    outside that window are denied. An uncertain provider failure closes that
    window to subsequent native retries before they can reserve or send again.
    ``on_completion(message, usage)`` receives visible content/tool calls, never
    private reasoning or the input prompt.
    """

    def __init__(self, provider, *, allow_request=None, on_completion=None):
        self.provider = provider
        self.allow_request = allow_request
        self.on_completion = on_completion
        self._state_lock = threading.Lock()
        self._request_lock = threading.Lock()
        self._window = None
        self._failed = False
        self._last_failure = None
        self._closed = False
        self._server = None
        self._worker = None
        self._prefix = "/" + secrets.token_urlsafe(32) + "/v1"
        self.base_url = None

    @property
    def last_failure(self):
        """Cached safe diagnostic; reading it never dispatches or reserves."""
        with self._state_lock:
            return self._last_failure

    def start(self):
        if self._closed:
            raise RuntimeError("The native provider transport is closed.")
        if self._server is not None:
            return self
        broker = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "MemoryChatProvider/1"

            def log_message(self, *_):
                pass

            def _send(self, status, payload, content_type="application/json"):
                body = payload if isinstance(payload, bytes) else _encoded(payload)
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    # The upstream attempt remains reserved if its native
                    # consumer disconnects before receiving the response.
                    pass

            def _route(self, suffix):
                hosts = self.headers.get_all("Host", [])
                parsed = urlsplit(self.path)
                return (len(hosts) == 1
                        and hosts[0] == f"127.0.0.1:{self.server.server_port}"
                        and self.headers.get("Origin") is None
                        and not parsed.query and not parsed.fragment
                        and secrets.compare_digest(parsed.path, broker._prefix + suffix))

            def do_GET(self):
                if not self._route("/models"):
                    self._send(404, {"error": {"message": "Not found."}})
                    return
                self._send(200, {"object": "list", "data": [
                    {"id": MODEL, "object": "model", "owned_by": "memory-chat"},
                ]})

            def do_POST(self):
                if not self._route("/chat/completions"):
                    self._send(404, {"error": {"message": "Not found."}})
                    return
                try:
                    lengths = self.headers.get_all("Content-Length", [])
                    if (len(lengths) != 1 or not lengths[0].isascii()
                            or not lengths[0].isdecimal()
                            or not 0 < int(lengths[0]) <= MAX_REQUEST_BYTES
                            or self.headers.get("Transfer-Encoding") is not None):
                        raise ValueError("Supply one bounded native request body.")
                    if self.headers.get_content_type() != "application/json":
                        raise ValueError("Supply a JSON native request body.")
                    self.connection.settimeout(10)
                    raw = self.rfile.read(int(lengths[0]))
                    if len(raw) != int(lengths[0]):
                        raise ValueError("Incomplete native request body.")
                    payload = json.loads(raw, object_pairs_hook=_unique_object,
                                         parse_constant=_invalid_constant)
                    messages, tools = native_request(payload)
                    message, usage = broker._complete(messages, tools)
                    response = broker._response(message, usage)
                    if payload.get("stream", False):
                        self._send(200, broker._sse(response, bool(
                            (payload.get("stream_options") or {}).get("include_usage"))),
                            "text/event-stream; charset=utf-8")
                    else:
                        self._send(200, response)
                except Exception as error:
                    # No upstream response body, credentials or request body is
                    # ever logged or included in transport diagnostics.
                    self._send(400, {"error": {"message": str(error)[:1500],
                                               "type": "invalid_request_error",
                                               "code": "native_provider_denied"}})

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        self.base_url = f"http://127.0.0.1:{self._server.server_port}{self._prefix}"
        self._worker = threading.Thread(target=self._server.serve_forever,
                                        kwargs={"poll_interval": 0.05}, daemon=True)
        self._worker.start()
        return self

    @contextmanager
    def turn(self):
        with self._state_lock:
            if self._closed or self._window is not None:
                raise RuntimeError("A native provider operation is already active or closed.")
            window = self._window = object()
            self._failed = False
            self._last_failure = None
        try:
            yield self
        finally:
            with self._state_lock:
                if self._window is window:
                    self._window = None

    def _complete(self, messages, tools):
        # Bind before queueing so an old request cannot adopt a newer turn.
        with self._state_lock:
            if self._closed or self._window is None or self._failed:
                raise RuntimeError("No active native model operation permits this request.")
            window = self._window
        with self._request_lock:
            with self._state_lock:
                if self._closed or self._window is not window or self._failed:
                    raise RuntimeError("No active native model operation permits this request.")
            provider_failure = None
            try:
                if self.allow_request is not None and self.allow_request() is False:
                    raise RuntimeError("The native model operation was stopped.")
                # Provider.complete keeps its exact fixed policy, durable
                # reservation, price preflight and single upstream dispatch.
                try:
                    message, usage = self.provider.complete(messages, tools)
                except RuntimeError as error:
                    # The fixed Provider emits bounded, actionable diagnostics
                    # rather than credential values or raw upstream bodies.
                    # Unknown/custom peers do not get to publish arbitrary text.
                    if type(self.provider) is Provider:
                        provider_failure = str(error)[:1500]
                    raise
                with self._state_lock:
                    if self._closed or self._window is not window or self._failed:
                        raise RuntimeError("The native model operation is no longer active.")
                    # Check Stop and capture under the same window. The paid
                    # reservation stays consumed even when output is withheld.
                    if self.allow_request is not None and self.allow_request() is False:
                        raise RuntimeError("The native model operation was stopped.")
                    if self.on_completion is not None:
                        visible = {key: deepcopy(value) for key, value in message.items()
                                   if key in {"role", "content", "tool_calls"}}
                        try:
                            self.on_completion(visible, deepcopy(usage))
                        except Exception:
                            # Optional capture must not trigger a paid retry.
                            pass
            except Exception:
                with self._state_lock:
                    if self._window is window:
                        self._failed = True
                        self._last_failure = provider_failure or "The native model request failed or was stopped."
                raise
            return message, usage

    @staticmethod
    def _response(message, usage):
        finish = ("tool_calls" if message.get("tool_calls") else
                  "length" if usage and usage.get("completion_truncated") else "stop")
        response = {"id": "chatcmpl-" + uuid.uuid4().hex,
                    "object": "chat.completion", "created": int(time.time()), "model": MODEL,
                    "choices": [{"index": 0, "message": deepcopy(message), "finish_reason": finish}]}
        clean_usage = {key: value for key, value in (usage or {}).items()
                       if key in {"prompt_tokens", "completion_tokens", "total_tokens"}}
        if clean_usage:
            response["usage"] = clean_usage
        return response

    @staticmethod
    def _sse(response, include_usage):
        base = {key: value for key, value in response.items() if key not in {"choices", "usage"}}
        base["object"] = "chat.completion.chunk"
        choice = response["choices"][0]
        message = choice["message"]
        delta = {key: deepcopy(value) for key, value in message.items() if key != "role"}
        if delta.get("tool_calls"):
            for index, call in enumerate(delta["tool_calls"]):
                call["index"] = index
        chunks = [
            {**base, "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}]},
            {**base, "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
            {**base, "choices": [{"index": 0, "delta": {}, "finish_reason": choice["finish_reason"]}]},
        ]
        if include_usage and "usage" in response:
            chunks.append({**base, "choices": [], "usage": response["usage"]})
        return b"".join(b"data: " + _encoded(chunk) + b"\n\n" for chunk in chunks) + b"data: [DONE]\n\n"

    def close(self):
        with self._state_lock:
            self._closed = True
            self._window = None
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._worker.join(timeout=2)
            self._server = None


"""Fixed genuine-model transport and a retained local demo allowance.

Requests reserve conservative estimates; validated replies settle to reported
cost. Unknown/failed dispatches remain reserved. No SDK paid gate is changed.
The demo server owns the state directory exclusively; this adapter serializes
its own callers and never recreates a lost consumed allowance.
"""
from __future__ import annotations

from copy import deepcopy
from decimal import Decimal, InvalidOperation, ROUND_CEILING
import hashlib
import json
from math import isfinite
import os
from pathlib import Path
import re
import ssl
import stat
import tempfile
from threading import Lock
import urllib.error
import urllib.request

from https_trust import create_tls_context


MODEL = "openai/gpt-6-sol"
_ORIGIN = "https://openrouter.ai"
_NANOS = 1_000_000_000
_INPUT_NANOS = 9_000  # 9 USD / million conservatively bounded input units.
_OUTPUT_NANOS = 20_000
_FRAMING = 1024
_MAX_BODY = 96 * 1024
_MAX_RESPONSE = 1024 * 1024
_MAX_METADATA = 8 * 1024 * 1024
_MAX_LEDGER = 1024 * 1024
_MAX_ATTEMPTS = 10000
_NAME = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError("Model provider redirects are not allowed.")


def _encoded(value) -> bytes:
    try:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True,
                          allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, UnicodeError):
        raise RuntimeError("Invalid model request data.") from None


def _integer(value) -> bool:
    return type(value) is int and value >= 0


def _money(value) -> int:
    try:
        if isinstance(value, bool):
            raise ValueError
        amount = Decimal(str(value))
        scaled = amount * _NANOS
        if not amount.is_finite() or amount < 0 or scaled != scaled.to_integral_value():
            raise ValueError
        return int(scaled)
    except (InvalidOperation, ValueError, OverflowError):
        raise ValueError("Demo budget must be finite, nonnegative, and have at most nine decimal places.") from None


def _price(value) -> Decimal:
    try:
        if isinstance(value, bool) or not isinstance(value, (str, int, float)):
            raise ValueError
        number = Decimal(str(value))
        if not number.is_finite() or number < 0:
            raise ValueError
        return number
    except (InvalidOperation, ValueError):
        raise RuntimeError("Selected model pricing is unavailable or invalid.") from None


class Provider:
    def __init__(self, ledger: Path, budget_usd: float, *, key: str | None = None,
                 max_output_tokens: int = 512, timeout_seconds: float = 30):
        self.ledger = Path(ledger).absolute()
        self.admission = self.ledger.with_name(self.ledger.name + ".admission")
        self._limit = _money(budget_usd)
        if type(max_output_tokens) is not int or not 1 <= max_output_tokens <= 512:
            raise ValueError("Output bound must be an integer from 1 to 512.")
        self._output = max_output_tokens
        if (isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, (int, float))
                or not isfinite(timeout_seconds) or not 1 <= timeout_seconds <= 120):
            raise ValueError("Provider timeout must be finite and between 1 and 120 seconds.")
        self._timeout = float(timeout_seconds)
        self._key = os.environ.get("OPENROUTER_API_KEY") if key is None else key
        if self._key is not None and (not isinstance(self._key, str)
                or len(self._key) > 16384 or any(c in self._key for c in "\r\n\0")):
            raise ValueError("Invalid provider credential configuration.")
        self._lock = Lock()
        self._prices_checked = False
        self._accounting_failed = False
        self._policy = {"version": 1, "model": MODEL, "limitNanos": self._limit,
                        "maxOutputTokens": self._output,
                        "inputNanosPerUnit": _INPUT_NANOS,
                        "outputNanosPerToken": _OUTPUT_NANOS,
                        "framingUnits": _FRAMING}
        self._policy_hash = hashlib.sha256(_encoded(self._policy)).hexdigest()
        # Validate HTTPS support before creating any persistent allowance.
        context = create_tls_context()
        # ProxyHandler preserves inherited proxy/NO_PROXY selection. Native OS
        # trust and public roots keep both chain and hostname checks enabled.
        self._http = urllib.request.build_opener(
            urllib.request.ProxyHandler(),
            urllib.request.HTTPSHandler(context=context), _NoRedirect())
        self._prepare_directory()
        # An inspection-only launch consumes no admission. Enabling the same
        # fresh root later with an explicit positive budget remains possible.
        self._empty_zero = (self._limit == 0 and not os.path.lexists(self.ledger)
                            and not os.path.lexists(self.admission) and not self._grants())
        if not self._empty_zero:
            self._initialize()
        self._cached_counts = self._read()

    @property
    def ready(self) -> bool:
        return self.status()["ready"]

    def status(self) -> dict:
        """Configuration/allowance snapshot; never wait on an in-flight request.

        This does not claim that the server credential has been authenticated.
        Ledger authorization still rereads the durable counters before dispatch.
        """
        if not self._key or not self._key.strip():
            reason = "missing_api_key"
        elif self._limit <= 0:
            reason = "budget_disabled"
        elif self._accounting_failed or any("overageNanos" in row for row in self._cached_counts.get("attempts", [])):
            reason = "allowance_unavailable"
        elif self._committed(self._cached_counts) >= self._limit:
            reason = "allowance_exhausted"
        else:
            reason = None
        return {"ready": reason is None, "reason": reason}

    def _prepare_directory(self):
        parent = self.ledger.parent
        try:
            parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if any(item.is_symlink() for item in (parent, *parent.parents)):
                raise ValueError
            info = parent.stat()
            if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) & 0o077:
                raise ValueError
        except (OSError, ValueError):
            raise RuntimeError("Provider state requires a private directory without symlinks.") from None

    def _sync_directory(self):
        fd = os.open(self.ledger.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def _read_json(self, path: Path):
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                info = os.fstat(fd)
                if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                        or info.st_size > _MAX_LEDGER or stat.S_IMODE(info.st_mode) & 0o077):
                    raise ValueError
                with os.fdopen(fd, "rb", closefd=False) as stream:
                    value = json.loads(stream.read(_MAX_LEDGER + 1).decode("utf-8"))
            finally:
                os.close(fd)
            if not isinstance(value, dict):
                raise ValueError
            return value
        except (OSError, ValueError, UnicodeError):
            raise RuntimeError("Provider allowance record is unavailable or unsafe; no reset was attempted.") from None

    def _create(self, path: Path, value):
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            with os.fdopen(fd, "wb", closefd=False) as stream:
                stream.write(_encoded(value))
                stream.flush()
                os.fsync(fd)
        finally:
            os.close(fd)
        self._sync_directory()

    def _grants(self):
        return list(self.ledger.parent.glob(self.ledger.name + ".limit-*.json"))

    def _retained_limit(self):
        limit = self._policy["limitNanos"]
        for path in self._grants():
            grant = self._read_json(path)
            total = grant.get("limitNanos")
            if (set(grant) != {"version", "basePolicySha256", "limitNanos"}
                    or type(grant["version"]) is not int or grant["version"] != 1
                    or grant["basePolicySha256"] != self._policy_hash
                    or not _integer(total) or total <= self._policy["limitNanos"]
                    or path.name != self.ledger.name + f".limit-{total}.json"):
                raise RuntimeError("Existing provider allowance grant is invalid; it was not reset.")
            limit = max(limit, total)
        return limit

    def _publish(self, path, value):
        """Publish complete private JSON atomically, including total-ceiling grants."""
        raw = _encoded(value)
        if len(raw) > _MAX_LEDGER:
            raise RuntimeError("Provider allowance history is full; no request was sent.")
        temporary = None
        try:
            fd, temporary = tempfile.mkstemp(prefix=".provider-", dir=self.ledger.parent)
            with os.fdopen(fd, "wb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            temporary = None
            self._sync_directory()
        finally:
            if temporary:
                os.unlink(temporary)

    def _initialize(self):
        try:
            if not os.path.lexists(self.admission) and not os.path.lexists(self.ledger):
                if self._grants():
                    raise RuntimeError("Provider allowance artifacts are incomplete; no reset was attempted.")
                # The immutable admission is durable first. A crash between
                # these writes cannot reopen a zeroed allowance automatically.
                self._create(self.admission, self._policy)
                self._create(self.ledger, {"policySha256": self._policy_hash,
                                          "reservedNanos": 0, "requests": 0})
            original = self._read_json(self.admission)
            if (set(original) != set(self._policy) or not _integer(original.get("limitNanos"))
                    or _encoded({**original, "limitNanos": self._limit}) != _encoded(self._policy)):
                raise RuntimeError("Existing provider allowance uses a different budget or policy; it was not reset.")
            self._policy = original
            self._policy_hash = hashlib.sha256(_encoded(original)).hexdigest()
            retained = self._retained_limit()
            # Check consumed state under the *retained* ceiling before granting
            # anything. Missing or corrupt state cannot be repaired by raising.
            self._validate_record(self._read_json(self.ledger), retained)
            if self._limit < retained:
                raise RuntimeError(f"Requested budget is lower than the retained total limit ${retained / _NANOS:g}; "
                                   f"restart with --budget-usd {retained / _NANOS:g}. No reset was attempted.")
            if self._limit > retained:
                if os.path.lexists(self.ledger.parent / "chat.lock"):
                    raise RuntimeError("Stop the running chat before increasing its total budget.")
                grant = self.ledger.with_name(self.ledger.name + f".limit-{self._limit}.json")
                self._publish(grant, {"version": 1, "basePolicySha256": self._policy_hash,
                                      "limitNanos": self._limit})
            self._read()
        except OSError:
            raise RuntimeError("Provider allowance initialization failed; no reset was attempted.") from None

    @staticmethod
    def _charges(value):
        if "attempts" not in value:
            return 0, value["reservedNanos"]
        reported = sum(row.get("actualNanos", 0) for row in value["attempts"])
        held = value["legacy"]["reservedNanos"] + sum(
            row["estimateNanos"] for row in value["attempts"] if "actualNanos" not in row)
        return reported, held

    @classmethod
    def _committed(cls, value):
        return sum(cls._charges(value))

    def _validate_record(self, value, limit):
        try:
            if (set(value) not in ({"policySha256", "reservedNanos", "requests"},
                                   {"policySha256", "reservedNanos", "requests", "legacy", "attempts"})
                    or value["policySha256"] != self._policy_hash
                    or not _integer(value["reservedNanos"]) or not _integer(value["requests"])):
                raise ValueError
            if "attempts" in value:
                legacy, attempts = value["legacy"], value["attempts"]
                if (not isinstance(legacy, dict) or set(legacy) != {"reservedNanos", "requests"}
                        or not all(_integer(v) for v in legacy.values())
                        or not isinstance(attempts, list) or not 1 <= len(attempts) <= _MAX_ATTEMPTS):
                    raise ValueError
                for row in attempts:
                    if (not isinstance(row, dict) or set(row) not in (
                            {"estimateNanos"}, {"estimateNanos", "actualNanos"}, {"estimateNanos", "overageNanos"})
                            or not _integer(row["estimateNanos"]) or row["estimateNanos"] == 0):
                        raise ValueError
                    if "actualNanos" in row and (not _integer(row["actualNanos"])
                                                  or row["actualNanos"] > row["estimateNanos"]):
                        raise ValueError
                    if "overageNanos" in row and (not _integer(row["overageNanos"])
                                                   or row["overageNanos"] <= row["estimateNanos"]):
                        raise ValueError
                if (value["requests"] != legacy["requests"] + len(attempts)
                        or value["reservedNanos"] != legacy["reservedNanos"] + sum(row["estimateNanos"] for row in attempts)):
                    raise ValueError
            if self._committed(value) > limit:
                raise ValueError
        except (KeyError, TypeError, ValueError):
            raise RuntimeError("Existing provider allowance is invalid; it was not reset.") from None
        return value

    def _read(self):
        if self._empty_zero:
            if os.path.lexists(self.ledger) or os.path.lexists(self.admission) or self._grants():
                raise RuntimeError("Provider allowance changed; restart the demo explicitly.")
            return {"policySha256": self._policy_hash, "reservedNanos": 0, "requests": 0}
        if _encoded(self._read_json(self.admission)) != _encoded(self._policy):
            raise RuntimeError("Existing provider allowance uses a different budget or policy; it was not reset.")
        if self._retained_limit() != self._limit:
            raise RuntimeError("Provider total allowance changed; restart the demo explicitly.")
        return self._validate_record(self._read_json(self.ledger), self._limit)

    @staticmethod
    def _validate_transition(current, value):
        """Only append one reservation or finalize one existing attempt."""
        baseline = current.get("legacy", {"reservedNanos": current["reservedNanos"], "requests": current["requests"]})
        previous = current.get("attempts", [])
        following = value.get("attempts", [])
        if value.get("legacy") != baseline:
            raise RuntimeError("Provider allowance history cannot be changed.")
        if len(following) == len(previous) + 1:
            valid = following[:-1] == previous and set(following[-1]) == {"estimateNanos"}
        elif len(following) == len(previous):
            changed = [(before, after) for before, after in zip(previous, following) if before != after]
            valid = len(changed) == 1 and set(changed[0][0]) == {"estimateNanos"}
            if valid:
                before, after = changed[0]
                valid = (after["estimateNanos"] == before["estimateNanos"]
                         and set(after) in ({"estimateNanos", "actualNanos"}, {"estimateNanos", "overageNanos"}))
        else:
            valid = False
        if (not valid or value["requests"] < current["requests"]
                or value["reservedNanos"] < current["reservedNanos"]):
            raise RuntimeError("Provider allowance history cannot be changed.")

    def _write(self, value):
        try:
            # Revalidate the actual destination before replacing it. The demo
            # server also retains exclusive ownership of this private root.
            current = self._read()
            self._validate_record(value, self._limit)
            self._validate_transition(current, value)
            self._publish(self.ledger, value)
            self._cached_counts = deepcopy(value)
        except (OSError, ValueError):
            raise RuntimeError("Provider allowance could not be retained; request was not sent.") from None

    def state(self) -> dict:
        with self._lock:
            value = self._read()
            self._cached_counts = deepcopy(value)
            reported, held = self._charges(value)
            return {"limitUsd": self._limit / _NANOS,
                    "reservedUsd": value["reservedNanos"] / _NANOS,
                    "remainingUsd": (self._limit - reported - held) / _NANOS,
                    "providerReportedCostUsd": reported / _NANOS,
                    "unsettledEstimateUsd": held / _NANOS,
                    "requests": value["requests"]}

    def _response_json(self, request, limit: int):
        try:
            with self._http.open(request, timeout=self._timeout) as response:
                if response.status != 200:
                    raise RuntimeError("Model provider returned an unsuccessful response.")
                raw = response.read(limit + 1)
                if len(raw) > limit:
                    raise RuntimeError("Model provider response exceeded the size limit.")
            value = json.loads(raw.decode("utf-8"))
            if not isinstance(value, dict):
                raise ValueError
            return value
        except urllib.error.HTTPError as error:
            hints = {
                401: "Check OPENROUTER_API_KEY in the server environment.",
                402: "Check the provider balance and the API key's spending limit.",
                403: "Check the API key's access to the selected model.",
                404: "The selected model or provider endpoint is unavailable.",
                429: "The provider is rate limiting requests; wait before sending another message.",
            }
            hint = hints.get(error.code, "Check the provider service and server connection.")
            raise RuntimeError(f"Model provider returned HTTP {error.code}. {hint} No retry was made.") from None
        except TimeoutError:
            raise RuntimeError(f"Model provider timed out after {self._timeout:g} seconds; no retry was made.") from None
        except urllib.error.URLError as error:
            if isinstance(error.reason, TimeoutError):
                raise RuntimeError(f"Model provider timed out after {self._timeout:g} seconds; no retry was made.") from None
            if isinstance(error.reason, ssl.SSLCertVerificationError):
                reason = getattr(error.reason, "verify_message", "certificate chain was not trusted")
                reason = re.sub(r"[\x00-\x1f\x7f]", " ", str(reason))[:160]
                raise RuntimeError(
                    "Model provider TLS verification failed: " + reason + ". "
                    "The connection was rejected by the system/public trust store. "
                    "If a VPN or HTTPS proxy inspects TLS, its root certificate must be trusted "
                    "by macOS Keychain/Windows or supplied through SSL_CERT_FILE/NODE_EXTRA_CA_CERTS. "
                    "No retry was made."
                ) from None
            raise RuntimeError("Model provider connection failed; check the server's network, proxy, and CA settings. No retry was made.") from None
        except (OSError, ssl.SSLError):
            raise RuntimeError("Model provider connection failed; check the server's network, proxy, and CA settings. No retry was made.") from None
        except (ValueError, UnicodeError):
            raise RuntimeError("Model provider returned invalid JSON.") from None

    def _verify_prices(self):
        if self._prices_checked:
            return
        listing = self._response_json(urllib.request.Request(
            _ORIGIN + "/api/v1/models", headers={"Accept": "application/json"}), _MAX_METADATA)
        data = listing.get("data")
        if not isinstance(data, list):
            raise RuntimeError("Selected model pricing is unavailable or invalid.")
        matches = [row for row in data if isinstance(row, dict) and row.get("id") == MODEL]
        if len(matches) != 1 or not isinstance(matches[0].get("pricing"), dict):
            raise RuntimeError("Selected model pricing is unavailable or ambiguous.")
        base = matches[0]["pricing"]
        overrides = base.get("overrides", [])
        if not isinstance(overrides, list) or len(overrides) > 128:
            raise RuntimeError("Selected model pricing tiers are invalid.")
        for override in overrides:
            if not isinstance(override, dict) or not _integer(override.get("min_prompt_tokens")):
                raise RuntimeError("Selected model pricing tiers are invalid.")
        for tier in [base, *({**base, **row} for row in overrides)]:
            required = {"prompt", "completion", "input_cache_write", "input_cache_read"}
            if not required <= set(tier) or _price(tier.get("request", 0)) != 0:
                raise RuntimeError("Selected model prices or request fees are unsupported.")
            input_rate = _price(tier["prompt"]) + max(_price(tier["input_cache_write"]), _price(tier["input_cache_read"]))
            if input_rate > Decimal("0.000009") or _price(tier["completion"]) > Decimal("0.000020"):
                raise RuntimeError("Selected model prices exceed the demo's estimated allowance policy.")
        self._prices_checked = True

    @staticmethod
    def _reasoning_fields(message):
        """Retain opaque provider continuation data only in private history.

        OpenRouter may require these exact reasoning blocks beside assistant
        tool calls on the following request. They are never synthesized or
        interpreted here; the chat server excludes them from visible exports.
        """
        result = {}
        for name in ("reasoning", "reasoning_details"):
            value = message.get(name)
            if value is None:
                continue
            valid = isinstance(value, str) if name == "reasoning" else (
                isinstance(value, list) and all(isinstance(block, dict) for block in value))
            if not valid:
                raise RuntimeError("Model reasoning continuation metadata is invalid.")
            result[name] = value
        if len(_encoded(result)) > _MAX_RESPONSE:
            raise RuntimeError("Model reasoning continuation metadata exceeded the size limit.")
        return deepcopy(result)

    @staticmethod
    def _validate_input(messages, tools):
        if not isinstance(messages, list) or not messages or len(messages) > 200:
            raise RuntimeError("Invalid model conversation.")
        for message in messages:
            if (not isinstance(message, dict) or not isinstance(message.get("role"), str)
                    or message.get("role") not in {"system", "user", "assistant", "tool"}
                    or message.get("content") is not None and not isinstance(message.get("content"), str)):
                raise RuntimeError("The demo supports text messages only.")
            if message["role"] != "assistant" and not isinstance(message.get("content"), str):
                raise RuntimeError("The demo supports text messages only.")
            allowed = {"role", "content", "tool_calls", "tool_call_id", "name"}
            if message["role"] == "assistant":
                allowed |= {"reasoning", "reasoning_details"}
                Provider._reasoning_fields(message)
            if set(message) - allowed:
                raise RuntimeError("Unsupported model message fields.")
        if not isinstance(tools, list) or len(tools) > 16:
            raise RuntimeError("Invalid model tools.")
        names = set()
        for tool in tools:
            function = tool.get("function") if isinstance(tool, dict) else None
            name = function.get("name") if isinstance(function, dict) else None
            if (not isinstance(tool, dict) or tool.get("type") != "function" or not isinstance(name, str)
                    or not _NAME.fullmatch(name) or name in names):
                raise RuntimeError("Only distinct local function tools are supported.")
            names.add(name)
        return names

    @staticmethod
    def _message(value, tool_names):
        choices = value.get("choices")
        if not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict):
            raise RuntimeError("Model provider returned no unambiguous completion.")
        choice = choices[0]
        if not isinstance(choice.get("finish_reason"), str) or choice.get("finish_reason") not in {"stop", "tool_calls", "length"}:
            raise RuntimeError("Model response stopped before completion.")
        source = choice.get("message")
        if not isinstance(source, dict) or source.get("role") != "assistant":
            raise RuntimeError("Model provider returned an invalid assistant message.")
        content = source.get("content")
        if content is not None and not isinstance(content, str):
            raise RuntimeError("Model provider returned unsupported content.")
        calls = source.get("tool_calls", [])
        if not isinstance(calls, list) or len(calls) > 16:
            raise RuntimeError("Model provider returned invalid tool calls.")
        result = {"role": "assistant", "content": content,
                  **Provider._reasoning_fields(source)}
        truncated = choice["finish_reason"] == "length"
        if truncated and calls:
            raise RuntimeError("The model reached its response token limit during a tool call; no truncated tool was executed.")
        if truncated and (not isinstance(content, str) or not content.strip()):
            raise RuntimeError("The model reached its response token limit without producing a visible answer. No automatic continuation was sent.")
        clean_calls, identifiers = [], set()
        for call in calls:
            if not isinstance(call, dict):
                raise RuntimeError("Model provider returned invalid tool calls.")
            function = call.get("function")
            identifier = call.get("id")
            if (call.get("type") != "function" or not isinstance(identifier, str)
                    or not 1 <= len(identifier) <= 128 or identifier in identifiers
                    or not isinstance(function, dict) or not isinstance(function.get("name"), str)
                    or function.get("name") not in tool_names
                    or not isinstance(function.get("arguments"), str)):
                raise RuntimeError("Model provider returned an invalid or unavailable tool call.")
            try:
                arguments = json.loads(function["arguments"])
                if not isinstance(arguments, dict):
                    raise ValueError
            except ValueError:
                raise RuntimeError("Model provider returned invalid tool arguments.") from None
            identifiers.add(identifier)
            clean_calls.append({"id": identifier, "type": "function", "function": {
                "name": function["name"], "arguments": function["arguments"]}})
        if clean_calls:
            if choice["finish_reason"] != "tool_calls":
                raise RuntimeError("Model provider returned ambiguous tool completion metadata.")
            result["tool_calls"] = clean_calls
        elif not isinstance(content, str) or not content.strip():
            raise RuntimeError("Model provider returned an empty answer.")
        elif choice["finish_reason"] not in {"stop", "length"}:
            raise RuntimeError("Model provider returned ambiguous completion metadata.")
        usage = value.get("usage")
        clean_usage = {}
        if isinstance(usage, dict):
            for name in ("prompt_tokens", "completion_tokens", "total_tokens", "cost"):
                number = usage.get(name)
                if isinstance(number, (int, float)) and not isinstance(number, bool) and 0 <= number < 1e15:
                    clean_usage[name] = number
        if truncated:
            # This is actual model text, clearly marked incomplete. The host
            # displays the limit notice; it must not auto-continue or execute
            # partially returned tools.
            clean_usage["completion_truncated"] = True
        return result, clean_usage or None

    def complete(self, messages: list, tools: list) -> tuple[dict, dict | None]:
        with self._lock:
            if not self.ready:
                if self.status()["reason"] == "allowance_exhausted":
                    raise RuntimeError("The retained estimated demo allowance is exhausted; no model request was sent.")
                if self.status()["reason"] == "allowance_unavailable":
                    raise RuntimeError("Provider cost accounting needs attention; no new model request was sent.")
                raise RuntimeError("A server-side OpenRouter key and an explicit positive demo budget are required.")
            names = self._validate_input(messages, tools)
            payload = {"model": MODEL, "messages": messages,
                       "max_completion_tokens": self._output, "reasoning": {"effort": "low"}}
            if tools:
                payload["tools"] = tools
            body = _encoded(payload)
            if len(body) > _MAX_BODY:
                raise RuntimeError("Conversation exceeds the demo request size; start a new conversation.")
            current = self._read()
            estimate = (len(body) + _FRAMING) * _INPUT_NANOS + self._output * _OUTPUT_NANOS
            if self._committed(current) + estimate > self._limit:
                raise RuntimeError("The retained estimated demo allowance is exhausted; no model request was sent.")
            try:
                self._verify_prices()
            except RuntimeError as error:
                raise RuntimeError(f"Model pricing preflight failed: {error} No completion request was sent.") from None
            current = self._read()
            if any("overageNanos" in row for row in current.get("attempts", [])):
                raise RuntimeError("Provider cost accounting needs attention; no new model request was sent.")
            if self._committed(current) + estimate > self._limit:
                raise RuntimeError("The retained estimated demo allowance is exhausted; no model request was sent.")
            reserved = deepcopy(current)
            if "attempts" not in reserved:
                reserved["legacy"] = {"reservedNanos": current["reservedNanos"], "requests": current["requests"]}
                reserved["attempts"] = []
            index = len(reserved["attempts"])
            reserved["attempts"].append({"estimateNanos": estimate})
            reserved["reservedNanos"] += estimate
            reserved["requests"] += 1
            self._write(reserved)
            request = urllib.request.Request(_ORIGIN + "/api/v1/chat/completions", data=body,
                headers={"Authorization": "Bearer " + self._key, "Content-Type": "application/json"})
            message, usage = self._message(self._response_json(request, _MAX_RESPONSE), names)
            if usage and "cost" in usage:
                actual = int((Decimal(str(usage["cost"])) * _NANOS).to_integral_value(rounding=ROUND_CEILING))
                try:
                    # Never finalize from a stale pre-dispatch snapshot or
                    # credit an older request whose outcome remains unknown.
                    settled = deepcopy(self._read())
                    if (settled["legacy"] != reserved["legacy"]
                            or settled["attempts"][index] != {"estimateNanos": estimate}):
                        raise RuntimeError("Provider reservation changed during completion.")
                    if actual > estimate:
                        self._accounting_failed = True
                        settled["attempts"][index]["overageNanos"] = actual
                        usage["cost_settlement_pending"] = True
                    else:
                        settled["attempts"][index]["actualNanos"] = actual
                    self._write(settled)
                except (RuntimeError, OSError, ValueError, KeyError, IndexError):
                    # A real answer must survive local accounting trouble.
                    # Reservation publication preceded dispatch; no retry or
                    # historical refund is authorized by this failure.
                    self._accounting_failed = True
                    usage["cost_settlement_pending"] = True
            return message, usage

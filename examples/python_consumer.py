"""Standard-library consumer of the real foundation JSONL process; no memory algorithm."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from queue import Empty, Queue
import subprocess
import tempfile
from threading import Thread
from typing import Any


class FoundationError(RuntimeError):
    pass


class FoundationClient:
    """One sequential request stream. Use a separate client for concurrent callers."""

    def __init__(self, foundation: Path | str, root: Path | str, timeout: float = 180):
        self.foundation = Path(foundation).resolve()
        self.root = Path(root).resolve()
        self.timeout = timeout
        self.sequence = 0
        self.responses: Queue[str | None] = Queue()
        node = self.foundation / "node_modules/node/bin/node"
        if not node.is_file():
            raise FoundationError("Install foundation dependencies with bash scripts/install.sh first.")
        self.process = subprocess.Popen(
            [str(node), str(self.foundation / "src/stdio.ts"), str(self.root)],
            cwd=self.foundation, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1,
            env={"PATH": str(node.parent) + os.pathsep + "/usr/bin:/bin", "LANG": "en_US.UTF-8"},
        )
        self.reader = Thread(target=self._read, daemon=True)
        self.reader.start()
        try:
            ready = self._receive(15)
            if ready.get("v") != 1 or ready.get("event") != "ready":
                raise FoundationError("Foundation did not acknowledge JSONL protocol v1.")
            self.engine = ready["engine"]
        except BaseException:
            self.process.terminate()
            self.process.wait(timeout=15)
            raise

    def _read(self) -> None:
        assert self.process.stdout is not None
        for line in self.process.stdout:
            self.responses.put(line)
        self.responses.put(None)

    def _receive(self, timeout: float | None = None) -> dict[str, Any]:
        try:
            line = self.responses.get(timeout=self.timeout if timeout is None else timeout)
        except Empty as error:
            raise FoundationError("Foundation response timed out; completion is not accepted.") from error
        if line is None:
            raise FoundationError(f"Foundation exited before a response (code {self.process.poll()}).")
        try:
            response = json.loads(line)
        except json.JSONDecodeError as error:
            raise FoundationError("Foundation emitted non-JSON protocol output.") from error
        if not isinstance(response, dict):
            raise FoundationError("Foundation emitted a non-object protocol response.")
        return response

    def call(self, op: str, workspace: str = "alpha", **args: Any) -> Any:
        if self.process.poll() is not None:
            raise FoundationError("Foundation process is not running.")
        self.sequence += 1
        request_id = f"python-{self.sequence}"
        assert self.process.stdin is not None
        self.process.stdin.write(json.dumps({"v": 1, "id": request_id, "op": op, "workspace": workspace, "args": args}) + "\n")
        self.process.stdin.flush()
        response = self._receive()
        if response.get("v") != 1 or response.get("id") != request_id:
            raise FoundationError("Foundation response did not match this request.")
        if response.get("ok") is not True:
            raise FoundationError(str(response.get("error", "Unknown foundation error")))
        return response["result"]

    def close(self) -> None:
        if self.process.poll() is None:
            try:
                self.call("shutdown")
                self.process.wait(timeout=15)
            except (FoundationError, subprocess.TimeoutExpired, BrokenPipeError):
                self.process.terminate()
                try:
                    self.process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=5)
        for stream in [self.process.stdin, self.process.stdout]:
            if stream is not None:
                stream.close()
        self.reader.join(timeout=2)

    def __enter__(self) -> FoundationClient:
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


def smoke(foundation: Path, root: Path) -> dict[str, Any]:
    with FoundationClient(foundation, root) as client:
        client.call("write", noteId="observatory", text="Synthetic Aurora uses cobalt telescopes every Tuesday.")
        client.call("index")
        recall = client.call("search", query="cobalt")
        assert recall["provider"] == "none"
        assert any(hit["path"] == "memory/observatory.md" for hit in recall["results"])
        source = client.call("get", path="memory/observatory.md")
        assert "cobalt" in source["text"]
        client.call("restart")
        assert client.call("search", query="cobalt")["results"]
        try:
            client.call("unsupported")
        except FoundationError:
            pass
        else:
            raise AssertionError("Unsupported operation was accepted")
        client.call("index", "beta")
        assert not client.call("search", "beta", query="cobalt")["results"]
    with FoundationClient(foundation, root) as client:
        assert client.call("search", query="cobalt")["results"]
        client.call("delete", noteId="observatory")
        client.call("index")
        assert not client.call("search", query="cobalt")["results"]
        return {"engine": client.engine, "real_engine": True, "provider": "none", "checks": ["write/index/recall", "source", "gateway restart", "error correlation", "workspace isolation", "host restart", "delete/index/no recall"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--foundation", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--root", type=Path)
    options = parser.parse_args()
    if options.root:
        print(json.dumps(smoke(options.foundation, options.root), indent=2))
    else:
        with tempfile.TemporaryDirectory(prefix="foundation-consumer-") as directory:
            print(json.dumps(smoke(options.foundation, Path(directory)), indent=2))

"""Separate Python app using an installed wheel and the real native bridge."""
import argparse
import json
from pathlib import Path
from openclaw_memory_bridge import BridgeConfig, FoundationError, MemoryClient, MemoryScope


def exercise(foundation: Path, root: Path):
    config = BridgeConfig(foundation, root)
    alex = MemoryScope("observatory", "alex", "first")
    later = MemoryScope("observatory", "alex", "later")
    other = MemoryScope("observatory", "sam", "first")
    separate = MemoryScope("separate", "alex", "first")
    checks = []
    with MemoryClient(config) as client:
        client.configure(alex, ingestion=True)
        client.write(alex, "filters", "Synthetic Vega uses cobalt filters on Tuesday.")
        client.index(alex)
        hits = client.search(alex, "cobalt")
        assert hits["provider"] == "none"
        assert any(h["path"] == "memory/filters.md" for h in hits["results"])
        checks.append("native keyword recall")
        source = client.get(alex, "memory/filters.md")
        assert "cobalt" in source["text"]
        checks.append("native source read")
        client.write(alex, "filters", "Synthetic Vega uses amber filters on Friday.")
        client.index(alex)
        assert client.search(alex, "amber")["results"]
        assert not client.search(alex, "cobalt")["results"]
        checks.append("update and stale keyword removal")
        context = "\n".join(f'{h["path"]}:{h["startLine"]} {h["snippet"]}' for h in client.search(later, "amber")["results"])
        prompt = f"Use these recalled sources:\n{context}\nQuestion: Which filter does Vega use?"
        assert "amber" in prompt
        checks.append("app inserts recalled content into its prompt")
        client.restart(alex)
        assert client.search(later, "amber")["results"]
        checks.append("Gateway restart and new session recall")
        for scope in [other, separate]:
            client.index(scope)
            assert not client.search(scope, "amber")["results"]
        checks.append("user and workspace routing isolation")
        fixture = client.inject_fixture(alex, "Synthetic fixture: Vega records charts on copper paper.")
        assert fixture["modelExecuted"] is False
        history = client.session_history(alex)
        assert history
        state = client.session_state(alex)
        assert state["nativeMaintenance"]["source"]
        capture = client.reset_session(alex)
        assert capture["native"] == "session-memory hook"
        assert "copper" in capture["content"]
        checks.append("native reset hook from explicit fixture; no model extraction")
        assert isinstance(client.dream_status(alex), dict)
        assert isinstance(client.dream_diary(alex), dict)
        checks.append("native lifecycle inspection")
        try:
            client.call("unsupported", alex.routing_workspace)
        except FoundationError as error:
            assert error.code == "invalid_request"
        else:
            raise AssertionError("Unsupported operation accepted")
        checks.append("structured operation error")
    with MemoryClient(config) as client:
        assert client.search(later, "amber")["results"]
        checks.append("host reconnect persistence")
        client.delete(alex, "filters")
        client.index(alex)
        assert not client.search(alex, "amber")["results"]
        checks.append("delete and no recall")
    return {"real_engine": True, "engine": "OpenClaw 2026.9.9", "provider": "none", "checks": checks, "prompt_example": prompt}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--foundation", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(exercise(args.foundation, args.root), indent=2))

"""SDK-01 executable example. Synthetic data; output is a prompt, not a model reply."""
import argparse
import json
from pathlib import Path
from openclaw_memory_bridge import BridgeConfig, MemoryClient, MemoryScope


def prepare_agent_prompt(memory, scope):
    memory.write(scope, "filters", "Synthetic Vega uses cobalt filters on Tuesday.")
    memory.index(scope)
    recall = memory.search(scope, "cobalt")
    context = "\n".join(hit["snippet"] for hit in recall["results"])
    return {
        "provider": recall["provider"],
        "sources": [{"path": h["path"], "startLine": h["startLine"], "endLine": h["endLine"]} for h in recall["results"]],
        "agent_prompt": f"Use these recalled sources:\n{context}\nWhich filter does Vega use?",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--foundation", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    scope = MemoryScope("observatory", "alex", "first")
    with MemoryClient(BridgeConfig(args.foundation, args.root)) as memory:
        print(json.dumps(prepare_agent_prompt(memory, scope), indent=2))

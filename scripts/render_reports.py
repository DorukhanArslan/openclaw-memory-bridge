"""Regenerate five HTML views from tracked JSON without running acceptance flows."""
from __future__ import annotations

import argparse
import importlib.util
import html
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import quote


REPORTS = (
    ("test-report", "test-rounds"),
    ("host-agent-memory", "host-agent-memory"),
    ("residence-memory", "residence-memory"),
    ("native-sdk-parity", "native-sdk-parity"),
    ("chatbot-memory-demo", "chatbot-memory-demo"),
)
CONVERSATION_SOURCE_LINKS = {
    "../README.md": "README.md",
    "chatbot-memory-demo.json": "reports/chatbot-memory-demo.json",
    "memory-capabilities.json": "reports/memory-capabilities.json",
    "memory-story.json": "reports/memory-story.json",
}


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rebase_conversation_links(page, foundation, output):
    """Keep retained-source links usable from the selected HTML directory."""
    for original, relative in CONVERSATION_SOURCE_LINKS.items():
        destination = quote(os.path.relpath(foundation / relative, output), safe="/")
        page = page.replace(f'href="{original}"', f'href="{html.escape(destination, quote=True)}"')
    return page


def validate_output(foundation, output):
    if output.resolve() == (foundation / "reports").resolve():
        raise ValueError("Use a separate output directory; canonical reports must be preserved.")
    if output.exists() and not output.is_dir():
        raise ValueError("Output directory is not a directory.")
    for stem, _ in REPORTS:
        target = output / f"{stem}.html"
        if target.is_symlink() or (target.exists() and (
            not target.is_file() or target.stat().st_nlink != 1
        )):
            raise ValueError(f"Output must be an independent regular file: {target.name}")


def render_reports(foundation, output):
    foundation, output = Path(foundation).resolve(), Path(output).absolute()
    validate_output(foundation, output)
    records = {}
    for stem, source in REPORTS:
        path = foundation / "reports" / f"{source}.json"
        record = json.loads(path.read_text())
        expected = list if stem == "test-report" else dict
        if not isinstance(record, expected):
            raise ValueError(f"{path.name}: expected {expected.__name__}")
        records[stem] = record
    for name in ["memory-story", "conversation-validation"]:
        path = foundation / "reports" / f"{name}.json"
        record = json.loads(path.read_text())
        if not isinstance(record, dict):
            raise ValueError(f"{path.name}: expected dict")
        records[name] = record

    # The existing render functions are pure consumers of supplied records.
    # Local SDK source satisfies their imports in a dependency-free checkout;
    # no client, Provider, .env loader, acceptance main, or Gateway is invoked.
    previous_path = sys.path[:]
    try:
        sys.path[:0] = [str(foundation / "examples"), str(foundation / "python/src")]
        renderers = {
            "test-report": load_module(foundation / "scripts/render-test-report.py", "retained_test_report").render,
            "host-agent-memory": load_module(foundation / "examples/host_agent.py", "retained_host_report").render,
            "residence-memory": load_module(foundation / "examples/residence_acceptance.py", "retained_residence_report").render,
            "native-sdk-parity": load_module(foundation / "examples/parity/report.py", "retained_parity_report").render,
            "chatbot-memory-demo": load_module(foundation / "examples/conversation_report.py", "retained_conversation_report").render,
        }
        rendered = {}
        with tempfile.TemporaryDirectory(prefix="bridge-report-render-") as folder:
            for stem, _ in REPORTS:
                stage = Path(folder) / f"{stem}.html"
                if stem == "test-report":
                    stage.write_text(renderers[stem](records[stem]))
                elif stem == "chatbot-memory-demo":
                    page = renderers[stem](records[stem], records["memory-story"],
                                           records["conversation-validation"])
                    stage.write_text(rebase_conversation_links(page, foundation, output))
                else:
                    renderers[stem](records[stem], stage)
                rendered[stem] = stage.read_bytes()
    finally:
        sys.path[:] = previous_path

    # No destination writes happen until every record has rendered successfully.
    validate_output(foundation, output)
    output.mkdir(parents=True, exist_ok=True)
    paths = []
    for stem, _ in REPORTS:
        target = output / f"{stem}.html"
        target.write_bytes(rendered[stem])
        paths.append(target)
    return paths


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--foundation", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        outputs = render_reports(args.foundation, args.output_dir)
    except (OSError, ValueError, KeyError, TypeError, AttributeError, ImportError) as error:
        parser.exit(2, f"Cannot reproduce retained reports: {error}\n")
    print(json.dumps({"kind": "retained-record-render", "liveModelCalls": 0,
                      "outputs": [str(path) for path in outputs]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

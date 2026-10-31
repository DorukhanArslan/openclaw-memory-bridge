"""Render retained test rounds without running tests or contacting providers."""
import argparse
import html
import json
from pathlib import Path


def render(rounds):
    e = html.escape
    parts = []
    for item in rounds:
        fields = ''.join(f'<dt>{e(name)}</dt><dd>{e(str(item[name]))}</dd>' for name in ['Test goal', 'What we did', 'Expected result', 'Actual result', 'What this means for your app', 'Evidence', 'Commit'])
        parts.append(f'<article><h2>{e(item["Round"])}</h2><p class="status">{e(item["Status"])}</p><dl>{fields}</dl></article>')
    return '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OpenClaw memory test report</title><style>body{font:17px/1.6 system-ui,sans-serif;margin:0;background:#f3f5f8;color:#16202a}main{max-width:850px;margin:auto;padding:24px}article{background:white;padding:24px;border-radius:12px;margin:20px 0;box-shadow:0 2px 8px #0001}h1,h2{line-height:1.25}.status{font-weight:700;color:#135488}dt{font-weight:700;margin-top:14px}dd{margin:0;overflow-wrap:anywhere}footer{font-size:14px;color:#455} @media(max-width:500px){main{padding:12px}article{padding:16px}}</style><main><h1>OpenClaw memory test report</h1><p>All test data is synthetic. The runtime is OpenClaw 2026.9.9. A source is the file and line range that support a recalled fact.</p>''' + ''.join(parts) + '''<footer>Short sentences and plain terms follow basic STE writing principles. This report does not claim formal ASD-STE100 certification. PASS means the stated check passed. It does not guarantee every conversation will create or consolidate memory. Workspace routing does not provide enterprise security.</footer></main></html>'''


def main(argv=None):
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=root / "reports/test-rounds.json")
    outputs = parser.add_mutually_exclusive_group()
    outputs.add_argument("--output", type=Path)
    outputs.add_argument("--output-dir", type=Path)
    args = parser.parse_args(argv)
    output = args.output or ((args.output_dir or root / "reports") / "test-report.html")
    try:
        if output.resolve() == args.input.resolve() or (
            output.exists() and args.input.exists() and output.samefile(args.input)
        ):
            raise ValueError("Output must differ from input evidence.")
        if output.is_symlink() or (output.exists() and (
            not output.is_file() or output.stat().st_nlink != 1
        )):
            raise ValueError("Output must be an independent regular file.")
        value = render(json.loads(args.input.read_text()))
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        parser.exit(2, f"Cannot render retained test report: {error}\n")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(value)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Render a portable HTML report. All report text is escaped. No remote assets."""
import html
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
rounds = json.loads((root / 'reports/test-rounds.json').read_text())
e = html.escape
parts = []
for item in rounds:
    fields = ''.join(f'<dt>{e(name)}</dt><dd>{e(str(item[name]))}</dd>' for name in ['Test goal', 'What we did', 'Expected result', 'Actual result', 'What this means for your app', 'Evidence', 'Commit'])
    parts.append(f'<article><h2>{e(item["Round"])}</h2><p class="status">{e(item["Status"])}</p><dl>{fields}</dl></article>')
(root / 'reports/test-report.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OpenClaw memory test report</title><style>body{font:17px/1.6 system-ui,sans-serif;margin:0;background:#f3f5f8;color:#16202a}main{max-width:850px;margin:auto;padding:24px}article{background:white;padding:24px;border-radius:12px;margin:20px 0;box-shadow:0 2px 8px #0001}h1,h2{line-height:1.25}.status{font-weight:700;color:#135488}dt{font-weight:700;margin-top:14px}dd{margin:0;overflow-wrap:anywhere}footer{font-size:14px;color:#455} @media(max-width:500px){main{padding:12px}article{padding:16px}}</style><main><h1>OpenClaw memory test report</h1><p>All test data is synthetic. The runtime is OpenClaw 2026.9.9. A source is the file and line range that support a recalled fact.</p>''' + ''.join(parts) + '''<footer>Short sentences and plain terms follow basic STE writing principles. This report does not claim formal ASD-STE100 certification. PASS means the stated check passed. It does not guarantee every conversation will create or consolidate memory. Workspace routing does not provide enterprise security.</footer></main></html>''')

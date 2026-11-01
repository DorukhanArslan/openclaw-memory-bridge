"""Pure HTML views of retained conversation and feature-tour records.

Rendering accepts already curated JSON dictionaries. It never reads raw evidence,
loads environment settings, calls a model, or changes workspace memory.
"""
import html
import json


def esc(s):
    return html.escape(str(s))

def render_step(s):
    left = f'<span class="tag">{esc(s["kind"])}</span><h2>{esc(s["id"])}</h2>'
    if s.get('user'): left += '<p class="label">User</p><p>' + esc(s['user']) + '</p>'
    if s.get('bot'): left += '<p class="label">Real assistant output</p><p class="answer">' + esc(s['bot']) + '</p>'
    elif s.get('failure'): left += '<p class="failed">' + esc(s['failure']) + '</p>'
    else: left += '<p>No assistant response is attributed to this operator/read step.</p>'
    for key in ['eventTrigger', 'boundary', 'adapter', 'currentTruthWarning']:
        if s.get(key): left += '<p class="note">' + esc(s[key]) + '</p>'
    right = '<h3>Files before / after</h3>'
    if not s['changes']: right += '<p>Workspace memory files unchanged.</p>'
    for c in s['changes']:
        right += '<details open><summary>' + esc(c['path']) + '</summary><div class="diff"><div><b>Before</b><pre>' + esc(c['before'] if c['before'] is not None else '[absent]') + '</pre></div><div><b>After</b><pre>' + esc(c['after']) + '</pre></div></div></details>'
    for key, title in [('toolCalls', 'Observed native tool calls'), ('toolResults', 'Native results matched by tool call ID'), ('bootstrapTrace', 'Actual native prompt-load trace'), ('diaryPhaseEvents', 'Native diary publication events'), ('sdk', 'Actual SDK retrieval'), ('responseEvidence', 'Real model response evidence')]:
        if s.get(key): right += '<details><summary>' + title + '</summary><pre>' + esc(json.dumps(s[key], indent=2, ensure_ascii=False)) + '</pre></details>'
    return '<section class="row"><article>' + left + '</article><aside>' + right + '</aside></section>'


def render_conversation(report):
    """Return the original replay view from its curated conversation record."""
    steps = report['steps']
    page = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenClaw conversation replay</title><style>body{margin:0;background:#f4f6f7;color:#172b38;font:16px/1.55 system-ui}main{max-width:1380px;margin:auto;padding:32px}h1{font-size:34px}h2{font-size:22px}.row{display:grid;grid-template-columns:38% 62%;background:white;border:1px solid #d6e0e4;border-radius:12px;margin:24px 0;overflow:hidden}article,aside{padding:24px;min-width:0}aside{border-left:1px solid #e1e7eb;background:#fafcfc}.tag{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#14636a}.label{font-size:13px;font-weight:700}.answer{background:#e9f5ef;padding:16px;border-radius:8px}.note{font-size:14px;color:#476170}.failed{background:#fff1dd;padding:16px}.diff{display:grid;grid-template-columns:1fr 1fr;gap:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace;background:#edf2f4;padding:12px;border-radius:6px}summary{cursor:pointer;font-weight:600}details{margin:12px 0}dt{font-weight:700}dd{margin:0 0 12px}a{color:#156773}@media(max-width:800px){.row,.diff{grid-template-columns:1fr}aside{border-left:0;border-top:1px solid #ddd}main{padding:16px}}</style><main><h1>One conversation. Real memory changes.</h1><p>Maya is a fictional gardener. Every shown assistant message is real model output. The harness did not prewrite workspace notes. Read the conversation on the left and exact file changes on the right.</p><p>Chat → preference update → new-session recall → native dreaming → SDK recall → application answer. Failed attempts remain visible. Automatic flush was not observed.</p><details><summary>Capabilities, boundaries and request ledger</summary><pre>' + esc(json.dumps({k: report[k] for k in ['status', 'limits', 'ledger', 'retainedPriorLedger']}, indent=2)) + '</pre><dl>' + ''.join('<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>' for k, v in report['roles'].items()) + '</dl></details>' + ''.join(render_step(s) for s in steps) + '<details><summary>Developer coverage and existing atomic checks</summary><p><a href="../README.md">Applied README</a> · <a href="test-report.html">Existing verification rounds</a> · <a href="chatbot-memory-demo.json">Sanitized replay JSON</a></p><p>This recorded replay does not replace the underlying atomic engine tests.</p></details></main></html>'
    return page


def render_verifications(validations):
    """Preserve historical verification notes transcribed from the former HTML."""
    sections = []
    for record in validations['verifications']:
        counts = []
        for key in ['typeScript', 'python']:
            check = record[key]
            text = (f"{esc(check['passed'])} passed / {esc(check['skipped'])} skipped / "
                    f"{esc(check['failed'])} failed")
            if record['emphasizeCounts']:
                text = '<strong>' + text + '</strong>'
            counts.append(text + f" ({esc(check['total'])} total)")
        checks = 'TypeScript ' + counts[0] + '; Python ' + counts[1]
        sections.append('<article id="' + esc(record['id']) + '"><h2>'
                        + esc(record['title']) + '</h2><p>Code commit <code>'
                        + esc(record['commit']) + '</code>: ' + checks
                        + '. Lint and typecheck ' + esc(record['lintAndTypecheck'])
                        + '.</p><p>' + esc(record['note']) + '</p></article>')
    return ''.join(sections)


def render(report, story, validations):
    """Return the replay, feature tour and historical verification notes."""
    cases = story['cases']
    status = story['gaps']
    capabilities = story['capabilityInventory']['features']
    page = render_conversation(report)
    page = page.replace('href="readme-proposal.html">README and case matrix proposal', 'href="../README.md">Applied README')
    page = page.replace('<title>OpenClaw conversation replay</title>', '<title>OpenClaw memory feature tour</title>')
    summary = '<!-- memory-feature-tour:start --><section><h1>Memory feature tour</h1><p>'+esc(story['narrative'])+'</p><p><a href="memory-story.json">Complete transferable case payload</a> · <a href="memory-capabilities.json">Pinned capability inventory</a></p><table style="width:100%;border-collapse:collapse"><tr><th>Case</th><th>Gain</th><th>Evidence status</th></tr>'
    for c in cases:
        summary += '<tr><td style="padding:10px;border:1px solid #ddd">'+esc(c['id']+' '+c['title'])+'</td><td style="padding:10px;border:1px solid #ddd">'+esc(c['gain'])+'</td><td style="padding:10px;border:1px solid #ddd">'+esc(c['status'])+'</td></tr>'
    summary += '</table><details><summary>Native options and explicit gaps</summary><pre>'+esc(json.dumps({'gaps':status,'features':capabilities},indent=2))+'</pre></details><h2>Separate recorded evidence and fresh app cases</h2><p>These exhibits do not continue Maya’s chat session. Null bot fields mean that no assistant reply is claimed.</p>'
    for c in cases:
        if c['runId'] == 'maya-chat-2026-10-12' or c['runId'] == 'inventory-only':
            continue
        left='<span class="tag">'+esc(c['runId'])+'</span><h2>'+esc(c['title'])+'</h2><p class="label">Actual input or operator request</p><pre>'+esc(c['input'])+'</pre>'
        left+='<p class="label">Real assistant output</p><p class="answer">'+esc(c['bot'])+'</p>' if c['bot'] else '<p>No assistant response is attributed to this operator/search step.</p>'
        left+='<p class="note">'+esc(c['trigger'])+'</p><p>'+esc(c['gain'])+'</p><p class="note">'+esc(c['status'])+'</p>'
        right='<h3>Recorded file changes</h3>'
        if c['changes'] is None:
            right+='<p>A Markdown diff was not sampled at this step. See native result evidence.</p>'
        elif not c['changes']:
            right+='<p>No recorded Markdown changes.</p>'
        else:
            for change in c['changes']:
                right+='<details><summary>'+esc(change['path'])+'</summary><div class="diff"><div><b>Before</b><pre>'+esc(change['before'] if change['before'] is not None else '[absent]')+'</pre></div><div><b>After</b><pre>'+esc(change['after'] if change['after'] is not None else '[absent]')+'</pre></div></div></details>'
        right+='<details><summary>Actual native/app result</summary><pre>'+esc(json.dumps(c['output'],indent=2,ensure_ascii=False))+'</pre></details>'
        summary+='<section class="row"><article>'+left+'</article><aside>'+right+'</aside></section>'
    summary+='</section><!-- memory-feature-tour:end -->'
    page=page.replace('<main>', '<main>'+summary+render_verifications(validations), 1)
    if story['gaps'].get('continuation'):
        page=page.replace('<h1>One conversation. Real memory changes.</h1>', '<h1>Original October 12 conversation</h1><p>The failed calls and unobserved flush below are preserved historical results. The linked October 13 native continuation appears above.</p>')
    return page

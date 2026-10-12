"""Replay recorded synthetic evidence; this script never calls a model or writes memory."""
import html
import json
from pathlib import Path

foundation = Path(__file__).resolve().parents[1]
evidence = foundation / 'evidence/e2e-conversation'
raw = json.loads((evidence / 'conversation.json').read_text())
sdk = json.loads((evidence / 'sdk-recall.json').read_text())
workspace = foundation / '.lab-test-e2e-conversation' / sdk['route'] / 'workspace'

def clean(value):
    text = json.dumps(value, ensure_ascii=False)
    text = text.replace(str(workspace), '<workspace>').replace(str(foundation), '<foundation>')
    assert '/Users/' not in text
    assert 'sk-or-' not in text and 'Bearer ' not in text
    return json.loads(text)

steps = []
for s in raw['steps']:
    item = {k: s.get(k) for k in ['id', 'kind', 'session', 'user', 'bot', 'changes', 'writeActor', 'eventTrigger', 'maintenance']}
    item['before'] = s.get('before')
    item['after'] = s.get('after')
    if s.get('native'):
        item['responseEvidence'] = s['native']['payloads']
    item['toolCalls'] = s.get('toolCalls', [])
    item['toolResults'] = [{k: m.get(k) for k in ['toolCallId', 'toolName', 'content', 'isError']} for m in s.get('historyDelta', []) if m.get('role') == 'toolResult']
    trace = s.get('bootstrapTrace')
    if trace:
        item['bootstrapTrace'] = {'source': trace['source'], 'provider': trace['provider'], 'model': trace['model'], 'systemPrompt': trace['systemPrompt'], 'files': [{k: f[k] for k in ['name', 'missing', 'rawChars', 'injectedChars', 'truncated']} for f in trace['injectedWorkspaceFiles']]}
    if s['id'] == 'dreaming':
        item['sweep'] = {k: s['sweep'][k] for k in ['ok', 'completed', 'status', 'completionStatus']}
        item['diaryPhaseEvents'] = [json.loads(line).get('1') for line in raw['nativeDiagnostics'] if 'dream diary entry written for' in line]
        item['currentTruthWarning'] = 'The diary mentions the older mint-tea fragment. USER.md still says rooibos. Dream narrative is not authoritative current-preference evidence.'
    steps.append(clean(item))

question = 'After the native memory maintenance, what is my current morning drink? Check saved memory, and tell me the source. Please do not guess.'
steps.append({'id': 'turn-5-native-blocked', 'kind': 'blocked native chat', 'session': 'later-after-dream', 'user': question, 'bot': None, 'changes': [], 'before': clean(raw['finalWorkspace']), 'after': clean(raw['finalWorkspace']), 'failure': 'Native agent failed after the shared aggregate input-byte admission bound denied its next request. No terminal assistant answer is claimed.'})
current = {p: (workspace / p).read_text() if (workspace / p).exists() else None for p in raw['finalWorkspace']}
assert current == raw['finalWorkspace'], 'Read/completion adapter changed workspace memory'
steps.append({'id': 'sdk-recall', 'kind': 'Python application recall', 'user': None, 'bot': None, 'changes': [], 'before': clean(current), 'after': clean(current), 'sdk': clean(sdk), 'eventTrigger': 'Application requested keyword search; source configuration mismatch required an explicit no-key native reindex. No memory content was written.', 'boundary': 'SDK provides memory access, not chat generation, flush or dreaming triggers. Native USER.md search worked; this bridge get path currently excludes USER.md.'})
final_path = evidence / 'final-answer.json'
final = json.loads(final_path.read_text()) if final_path.exists() else None
steps.append({'id': 'application-final-answer', 'kind': 'Application source context to native llm-task', 'user': question, 'bot': final['bot'] if final else None, 'changes': [], 'before': clean(current), 'after': clean(current), 'adapter': 'Application passes real SDK search sources to the existing native llm-task. This is not an SDK chat or automatic lifecycle feature.', 'responseEvidence': clean(final['native']) if final else None, 'failure': None if final else 'Final adapter has no accepted answer yet. Initial local connection failure occurred before any model dispatch.'})
ledger = json.loads((evidence / 'request-ledger.json').read_text())
report = {'title': 'One synthetic conversation, real OpenClaw memory', 'model': raw['model'], 'initialWorkspace': raw['initialWorkspace'], 'steps': steps, 'limits': raw['limits'], 'ledger': ledger, 'retainedPriorLedger': raw['priorAttempt']['requestLedger'], 'measuredProviderUsageBeforeFinal': raw['afterBudget'], 'status': {'native_chat_write': 'passed', 'preference_update': 'passed', 'new_session_recall_before_dream': 'passed', 'native_dreaming_promotion': 'passed: Added 1 / Merged 0 / Superseded 0', 'automatic_flush': 'not observed; not counted as passed', 'post_dream_native_agent_answer': 'failed: input-byte admission bound', 'sdk_keyword_recall_after_dream': 'passed after explicit no-key reindex', 'post_dream_application_answer': 'passed' if final else 'unaccepted', 'changed_fact_supersession': 'unverified'}, 'roles': {'USER.md': 'Agent-maintained profile and current preference; actual native prompt-load traces included.', 'memory/2026-10-12.md': 'Agent-written daily event source.', 'MEMORY.md': 'Native dreaming durable promotion with source reference.', 'DREAMS.md': 'Native diary and consolidation history; narrative can retain older fragments.', 'BOOTSTRAP.md': 'Absent throughout this scenario; native trace injected zero characters.', 'AGENTS.md / SOUL.md / IDENTITY.md': 'Absent; native prompt includes missing-file placeholders, not file contents.'}}
report = clean(report)
output = foundation / 'reports/chatbot-memory-demo.json'
output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')

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

page = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenClaw conversation replay</title><style>body{margin:0;background:#f4f6f7;color:#172b38;font:16px/1.55 system-ui}main{max-width:1380px;margin:auto;padding:32px}h1{font-size:34px}h2{font-size:22px}.row{display:grid;grid-template-columns:38% 62%;background:white;border:1px solid #d6e0e4;border-radius:12px;margin:24px 0;overflow:hidden}article,aside{padding:24px;min-width:0}aside{border-left:1px solid #e1e7eb;background:#fafcfc}.tag{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#14636a}.label{font-size:13px;font-weight:700}.answer{background:#e9f5ef;padding:16px;border-radius:8px}.note{font-size:14px;color:#476170}.failed{background:#fff1dd;padding:16px}.diff{display:grid;grid-template-columns:1fr 1fr;gap:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace;background:#edf2f4;padding:12px;border-radius:6px}summary{cursor:pointer;font-weight:600}details{margin:12px 0}dt{font-weight:700}dd{margin:0 0 12px}a{color:#156773}@media(max-width:800px){.row,.diff{grid-template-columns:1fr}aside{border-left:0;border-top:1px solid #ddd}main{padding:16px}}</style><main><h1>One conversation. Real memory changes.</h1><p>Maya is a fictional gardener. Every shown assistant message is real model output. The harness did not prewrite workspace notes. Read the conversation on the left and exact file changes on the right.</p><p>Chat → preference update → new-session recall → native dreaming → SDK recall → application answer. Failed attempts remain visible. Automatic flush was not observed.</p><details><summary>Capabilities, boundaries and request ledger</summary><pre>' + esc(json.dumps({k: report[k] for k in ['status', 'limits', 'ledger', 'retainedPriorLedger']}, indent=2)) + '</pre><dl>' + ''.join('<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>' for k, v in report['roles'].items()) + '</dl></details>' + ''.join(render_step(s) for s in steps) + '<details><summary>Developer coverage and existing atomic checks</summary><p><a href="readme-proposal.html">README and case matrix proposal</a> · <a href="test-report.html">Existing verification rounds</a> · <a href="chatbot-memory-demo.json">Sanitized replay JSON</a></p><p>This recorded replay does not replace the underlying atomic engine tests.</p></details></main></html>'
(foundation / 'reports/chatbot-memory-demo.html').write_text(page)
print(output)
print('Actual model final answer:', bool(final))

"""Replay recorded synthetic evidence; this script never calls a model or writes memory."""
import json
from pathlib import Path
import sys

foundation = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(foundation / 'scripts'))
from evidence_status import EvidenceInputError, evidence_path, require_json_inputs
from conversation_report import render_conversation
from render_reports import rebase_conversation_links

evidence = evidence_path(foundation, 'evidence/e2e-conversation')
inputs = [evidence / name for name in ['conversation.json', 'sdk-recall.json', 'request-ledger.json']]
if (evidence / 'final-answer.json').exists():
    inputs.append(evidence / 'final-answer.json')
try:
    records = require_json_inputs(inputs)
except EvidenceInputError as error:
    raise SystemExit(str(error)) from None
raw = records[evidence / 'conversation.json']
sdk = records[evidence / 'sdk-recall.json']
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
steps.append({'id': 'sdk-recall', 'kind': 'Python application recall', 'user': None, 'bot': None, 'changes': [], 'before': clean(current), 'after': clean(current), 'sdk': clean(sdk), 'eventTrigger': 'Application requested keyword search; source configuration mismatch required an explicit no-key native reindex. No memory content was written.', 'boundary': 'SDK provides memory access, not chat generation, flush or dreaming triggers. Native USER.md search worked; the bridge version used in this recorded run rejected USER.md reads.'})
final_path = evidence / 'final-answer.json'
final = records.get(final_path)
steps.append({'id': 'application-final-answer', 'kind': 'Application source context to native llm-task', 'user': question, 'bot': final['bot'] if final else None, 'changes': [], 'before': clean(current), 'after': clean(current), 'adapter': 'Application passes real SDK search sources to the existing native llm-task. This is not an SDK chat or automatic lifecycle feature.', 'responseEvidence': clean(final['native']) if final else None, 'failure': None if final else 'Final adapter has no accepted answer yet. Initial local connection failure occurred before any model dispatch.'})
ledger = records[evidence / 'request-ledger.json']
report = {'title': 'One synthetic conversation, real OpenClaw memory', 'model': raw['model'], 'initialWorkspace': raw['initialWorkspace'], 'steps': steps, 'limits': raw['limits'], 'ledger': ledger, 'retainedPriorLedger': raw['priorAttempt']['requestLedger'], 'measuredProviderUsageBeforeFinal': raw['afterBudget'], 'status': {'native_chat_write': 'passed', 'preference_update': 'passed', 'new_session_recall_before_dream': 'passed', 'native_dreaming_promotion': 'passed: Added 1 / Merged 0 / Superseded 0', 'automatic_flush': 'not observed; not counted as passed', 'post_dream_native_agent_answer': 'failed: input-byte admission bound', 'sdk_keyword_recall_after_dream': 'passed after explicit no-key reindex', 'post_dream_application_answer': 'passed' if final else 'unaccepted', 'changed_fact_supersession': 'unverified'}, 'roles': {'USER.md': 'Agent-maintained profile and current preference; actual native prompt-load traces included.', 'memory/2026-10-12.md': 'Agent-written daily event source.', 'MEMORY.md': 'Native dreaming durable promotion with source reference.', 'DREAMS.md': 'Native diary and consolidation history; narrative can retain older fragments.', 'BOOTSTRAP.md': 'Absent throughout this scenario; native trace injected zero characters.', 'AGENTS.md / SOUL.md / IDENTITY.md': 'Absent; native prompt includes missing-file placeholders, not file contents.'}}
report = clean(report)
output = foundation / 'reports/chatbot-memory-demo.json'

page = render_conversation(report)
html_output = foundation / '.bootstrap/rendered-reports/chatbot-memory-demo.html'
page = rebase_conversation_links(page, foundation, html_output.parent)
# Render both outputs before replacing either historical report.
payload = json.dumps(report, indent=2, ensure_ascii=False) + '\n'
output.write_text(payload)
html_output.parent.mkdir(parents=True, exist_ok=True)
html_output.write_text(page)
print(output)
print('Actual model final answer:', bool(final))

"""Build a feature tour from real records. Never dispatch models or modify memory."""
import json
from pathlib import Path

foundation = Path(__file__).resolve().parents[1]
reports = foundation / 'reports'

def load(path):
    return json.loads((foundation / path).read_text())

def clean(value):
    text = json.dumps(value, ensure_ascii=False).replace(str(foundation), '<foundation>')
    assert '/Users/' not in text and 'sk-or-' not in text and 'Bearer ' not in text
    return json.loads(text)

maya = load('reports/chatbot-memory-demo.json')
lifecycle = load('evidence/lifecycle-acceptance/acceptance.json')
merge = load('evidence/provenance-merge-acceptance/acceptance.json')
semantic = load('evidence/live-smoke/acceptance.json')
app = load('reports/maya-app-cases.json')
by_id = {s['id']:s for s in maya['steps']}

capabilities = []
def feature(id, native, sdk, operator, coverage, code, limit=''):
    capabilities.append({'id':id,'native':native,'sdk':sdk,'labOperator':operator,'coverage':coverage,'pinnedCode':code,'boundary':limit})
feature('keyword', 'FTS5/BM25 retrieval', 'search', 'search/index/status', 'real no-key engine and Maya', ['memory-schema-SE7C0M3V.mjs','memory-tool-contract-DOz26L8b.mjs'])
feature('vector-hybrid', 'Embedding vectors and hybrid retrieval', 'search uses configured native engine; no provider selector', 'vector/native-vector; gated smoke', 'historical genuine Zephyr embedding + source pass', ['memory-search-CIhUURbE.mjs','memory-embedding-adapter-BpxrOoe_.mjs'], 'No new embedding run. Local provider availability is not proved by config.')
feature('source', 'memory_get exact bounded excerpts and citations', 'get for allowed notes', 'get; ReadyGateway.get also accepts USER.md', 'Maya native USER.md get passes; Python USER.md get rejects', ['memory-tool-contract-DOz26L8b.mjs'], 'Session transcript hits use history, not memory_get.')
feature('persistence', 'Per-agent SQLite index and Markdown sources', 'restart and reconnect with same root', 'restart/status/index', 'fresh SDK + historical Vega restart recall', ['openclaw-agent-schema-CV4V4sh3.mjs','memory-schema-SE7C0M3V.mjs'])
feature('bootstrap-profile', 'Native prompt loads workspace profile/template context', 'no bootstrap or profile-write API', 'native agent CLI; lab skipBootstrap=true', 'actual USER.md prompt trace; other files absent', ['bootstrap-files-CgqY-7GK.mjs','workspace-bootstrap-policy-DaS4N8nC.mjs'], 'BOOTSTRAP.md creation/load is not demonstrated here; absent templates have placeholders.')
feature('agent-note', 'Agent read/write/edit tools can maintain profile/daily files', 'no chat/extraction method', 'real native chat', 'Maya real tool calls + exact diffs', ['memory-tool-contract-DOz26L8b.mjs','memory-workspace-files-CC0bKS3d.mjs'], 'Explicit app write is not automatic extraction.')
feature('flush-compaction', 'Threshold-based pre-compaction memory flush and native summary compaction', 'state inspection only', 'flush-config/chat/compact; paid guarded runners', 'separate real Borealis flush + compaction; absent in Maya E2E', ['memory-flush-session-BjKZkw5O.mjs','compaction-DG39GCC7.mjs'], 'Existing runner uses low test thresholds. Not a per-message guarantee; no new run fits retained budget.')
feature('session-capture', 'Native reset hook captures bounded session material', 'configure(ingestion=True), reset_session, session_history/state; labelled fixture', 'ingestion/session-reset/lifecycle-demo', 'separate real Borealis capture + SDK no-key fixture checks', ['session-ingestion-Dy5uAq-_.mjs'], 'Fixture injection generates no model reply. Reset capture differs from model extraction.')
feature('dreaming', 'Light stages, REM reflects, deep promotes grounded sources', 'dream_status/dream_diary inspection only', 'dream-run; rem-preview/rem-stage/promote/explain', 'Maya Add 1; Vega duplicate Merged 1; model diary phase events', ['dreaming-phases-rmgXNBLP.mjs','dreaming-narrative-B8Hp3Mc_.mjs'], 'Operator-triggered sweeps; thresholds are explicit test settings. Diary is not a current truth source.')
feature('consolidation-lineage', 'Adds, merges and eligible supersessions with provenance', 'inspect outputs only', 'native deep sweep/explain', 'addition + duplicate merge passed; changed-fact supersession unverified', ['memory-artifact-provenance-DhnyWiV1.mjs','memory-entry-origins-BCQSIB3X.mjs'], 'App file replacement does not prove lineage-based supersession.')
feature('app-crud-scopes', 'Native reindex reflects source changes', 'write/delete/index and workspace/user route', 'note/delete/use', 'fresh Maya app write/update/delete and symmetric scope checks', ['memory-schema-SE7C0M3V.mjs'], 'Writes/deletes/routing are app adapters. No authorization or secure-erasure claim.')
feature('ranking', 'Native relevance/importance/recency/project ranking, MMR and query expansion', 'search preserves native ordering; no ranking knobs', 'native config; promotion explanation', 'installed implementation; individual ranking policies not accepted separately', ['memory-search-CIhUURbE.mjs','dreaming-phases-rmgXNBLP.mjs'])
feature('trusted-pre-reply', 'Curated trigger/project recall with provenance gating', 'no active-recall control', 'native agent configuration', 'installed capability; no dedicated demo', ['memory-path-provenance-C84vBRrO.mjs','memory-tool-contract-DOz26L8b.mjs'], 'No learned relevance reranker or active-memory claim.')
feature('index-maintenance', 'Incremental sync, file watchers, replacement index, cache and derived-index recovery', 'index/status/restart; no derived reset method', 'official memory index/status/reset', 'explicit reindex after source-config mismatch passed; watcher/cache/reset behavior not individually tested', ['memory-rebuild-notice-9mxFMQoD.mjs','memory-schema-SE7C0M3V.mjs'], 'Do not remove the shared agent database to reset memory.')
feature('historical-backfill', 'Grounded REM/session backfill, reversible staging and rollback', 'not exposed', 'rem-preview/rem-stage; further official CLI controls', 'existing labelled fixture backfill tests; no complete same-user chat demo', ['session-backfill-CqTlHwCA.mjs','session-ingestion-Dy5uAq-_.mjs'])
feature('admission-forget', 'Native exclusion policy and provenance-based forget/dry-run', 'not exposed', 'official native CLI, not a lab wrapper', 'installed capability; not exercised', ['cli.runtime-CVRN4xUp.mjs','session-ingestion-Dy5uAq-_.mjs'], 'Deleting one app note does not purge every session-derived copy.')
feature('extra-multimodal-cjk', 'Extra paths, optional image/audio embeddings, trigram CJK tokenization', 'no configuration API', 'native operator configuration outside current wrappers', 'not exercised; native config/source inventory only', ['memory-search-CIhUURbE.mjs','memory-schema-SE7C0M3V.mjs'])
feature('session-wiki-corpora', 'Optional semantic session corpus and registered wiki supplements', 'search wrapper fixes corpus=memory', 'native memory_search supports sessions/wiki/all', 'not exercised through this bridge', ['memory-tool-contract-DOz26L8b.mjs'], 'Honcho/LanceDB/active-memory/wiki plugin integration is outside this lab.')
for c in capabilities:
    for name in c['pinnedCode']:
        assert (foundation / 'node_modules/openclaw/dist' / name).is_file(), name
inventory = {'engine':'OpenClaw 2026.9.9','runtime':'Node 24.16.0','scope':'Installed builtin Memory Core and current bridge access; not every OpenClaw plugin or option is a tested demo.','sourceNote':'Pinned package code and bundled docs were inspected. Online docs may describe newer behavior. No internal engine module is imported by the bridge.','repositoryAccess':['src/lab.ts','src/stdio.ts','src/gateway.ts','python/src/openclaw_memory_bridge/client.py'],'features':capabilities}
(reports / 'memory-capabilities.json').write_text(json.dumps(inventory, indent=2)+'\n')

cases=[]
def case(id, title, run, input, bot, trigger, changes, gain, status, features, output=None):
    cases.append(clean({'id':id,'title':title,'runId':run,'input':input,'bot':bot,'trigger':trigger,'changes':changes,'output':output,'gain':gain,'status':status,'featureIds':features}))
def maya_case(id,title,step,gain,features):
    s=by_id[step]
    case(id,title,'maya-chat-2026-10-12',s.get('user'),s.get('bot'),s.get('eventTrigger') or s.get('adapter'),s['changes'],gain,'real recorded',features, {k:s[k] for k in ['toolCalls','toolResults','bootstrapTrace','responseEvidence','sweep','diaryPhaseEvents','currentTruthWarning'] if k in s})
trace=by_id['turn-4']['bootstrapTrace']
case('C01','Load saved profile before a reply','maya-chat-2026-10-12',by_id['turn-4']['user'],by_id['turn-4']['bot'],'Native agent system prompt load; measured report, not file-existence inference',[],'The profile is available before recall. USER.md injected 262 characters; BOOTSTRAP.md absent/injected zero.','partial: USER.md verified; bootstrap templates not demonstrated',['bootstrap-profile'],trace)
maya_case('C02','Save identity and daily event','turn-2','Agent-maintained profile and dated event survive the conversation.',['agent-note'])
# The full first turn remains in the immutable Maya run payload below.
maya_case('C03','Keyword recall and exact native source','turn-4','A new session can answer from the saved current preference and schedule.',['keyword','source'])
case('C04','Find different wording with real embeddings','zephyr-semantic-2026-10-11',semantic['semantic_query'],None,'Native index and memory_search with text-embedding-3-small',[{'path':'memory/resident.md','before':None,'after':semantic['source_get']['verified_text'],'actor':'Explicit application synthetic fixture, not chat extraction'}],'Semantic search finds bicycle text without shared query words. No assistant reply is invented.','historical real pass; separate run',['vector-hybrid','source'],{'chatUtility':semantic['chat'],'recall':semantic['recall'],'source':semantic['source_get'],'embeddingModel':semantic['embedding_model']})
maya_case('C05','Change the preference','turn-3-continuation','The current profile changes from mint tea to rooibos; gardener details remain.',['agent-note','consolidation-lineage'])
conversations=[]
for key in ['firstConversation','secondConversation']:
    d=lifecycle[key]
    users=[m['content'] for m in d['history']['messages'] if m.get('role')=='user']
    conversations.append({'input':users[0] if key=='firstConversation' else users[-1],'bot':d['completion']['terminalReply']['text'],'nativeReceipt':d['completion']['terminalReceipt']})
case('C06','Flush before shortening context','borealis-lifecycle-2026-10-11',conversations[1]['input'],conversations[1]['bot'],'Configured native automatic flush; transcript threshold lowered to 1024 bytes for this test',[{'path':p,'before':lifecycle['afterFirstConversation'].get(p),'after':text,'actor':'native flush model/agent'} for p,text in lifecycle['afterFlush'].items()],'The native flush writes a daily fact, with a succeeded maintenance marker.','historical stage pass; later REM failure makes the entire run partial',['flush-compaction','agent-note'],{'conversations':conversations,'flush':lifecycle['secondConversation']['state']['nativeMaintenance']['memoryFlush'],'beforeFirstConversation':lifecycle['beforeConversation'],'afterFirstConversation':lifecycle['afterFirstConversation']})
case('C07','Compact the conversation','borealis-lifecycle-2026-10-11','Operator requests native compaction with explicit test retention',None,'Explicit native compact; not an SDK operation',None,'A committed summary shortens stored conversation context. No new Markdown diff snapshot was sampled for this step.','historical stage pass; separate from Maya',['flush-compaction'],{'compacted':lifecycle['compaction']['native']['compacted'],'summary':lifecycle['compaction']['native']['result']['summary'],'compactionCount':lifecycle['compaction']['state']['nativeMaintenance']['compactionCount']})
capture=lifecycle['resetCapture']
case('C08','Capture and reset a real session','borealis-lifecycle-2026-10-11','Operator sessions.reset with native session-memory hook enabled',None,'Native reset hook; modelSummary=false',[{'path':capture['captured'],'before':None,'after':capture['content'],'actor':'native session-memory reset hook'}],'A bounded capture preserves the real transcript for later indexing.','historical real pass; separate run',['session-capture'],{'reset':capture['reset'],'modelSummary':capture['modelSummary']})
maya_case('C09','Light → REM → deep maintenance','dreaming','Native deep promotes one grounded orchid event. The diary still mentions older mint tea; it is not current preference truth.',['dreaming','consolidation-lineage'])
vega_inputs=[m['content'] for m in merge['sourceHistory']['messages'] if m.get('role')=='user']
vega_bot='\n'.join(p['text'] for p in merge['conversation']['payloads'] if p.get('text'))
case('C10','Merge a duplicate with source lineage','vega-merge-2026-10-11',vega_inputs[-1],vega_bot,'Official local agent write then native dreaming sweep; explicit duplicate baseline fixture',[{'path':p,'before':merge['before'].get(p),'after':text,'actor':'native agent/sweep; prior duplicate is labelled application fixture'} for p,text in merge['after'].items()],'Native merge keeps one duplicate fact, source references and unrelated entries. All three diary phase publishers complete.','historical real pass; Added 0 / Merged 1 / Superseded 0',['dreaming','consolidation-lineage'],{'baselineAdapter':merge['baselineAdapter'],'recallAfterRestart':merge['recallAfterRestart'],'sourceSessionPreserved':merge['sourceSession']['session']['sessionId']==merge['sessionAfterRestart']['session']['sessionId']})
maya_case('C11','Answer after maintenance with app context','application-final-answer','Actual Python SDK recall is inserted by the app into native llm-task; this is a real model answer, not SDK chat.',['keyword','source'])
case('C12','Restart, update, delete and separate scopes','maya-app-tour',[s['input'] for s in app['steps']],None,'Explicit SDK calls in a fresh temporary root; no model executed',[c for s in app['steps'] for c in s['changes']],'Notes persist after restart; app replacement/deletion changes current hits; other user/workspace has no copied fact.','fresh real no-key pass; independent app run',['persistence','app-crud-scopes'],app)
case('C13','Remaining native options','inventory-only',None,None,'No execution',None,'Ranking, backfill, trusted trigger recall, policy/forget and extended corpora are described with their access limits.','not a passed demonstration',['ranking','trusted-pre-reply','index-maintenance','historical-backfill','admission-forget','extra-multimodal-cjk','session-wiki-corpora'])
status={'sameMayaContinuousAllFeatures':False,'bootstrapTemplateLoad':'not demonstrated; USER.md load verified','MayaAutomaticFlush':'not observed','MayaCompaction':'not run','MayaPostDreamNativeAgent':'blocked by input-byte admission; bot is null','PythonUSERGet':'rejected adapter path; native get and Python search evidence retained','changedFactSupersession':'unverified','diaryCurrentPreference':'older mint fragment remains','newPaidRuns':0,'historicalRunsAreNotContinuousWithMaya':True,'budget':{'cumulativeLimitUsd':5,'lastMeasuredUsedUsdBeforeFinalAnswer':maya['measuredProviderUsageBeforeFinal']['usedUsd'],'retainedE2ERequests':maya['ledger']['requests'],'remainingSerializedInputBytes':maya['limits']['inputBytes']-maya['ledger']['inputBytes'],'existingFullFlushEnvelopeUsd':4.83,'minimumTotalWithLastMeasuredUsageUsd':round(maya['measuredProviderUsageBeforeFinal']['usedUsd']+4.83,8),'note':'Final answer cost was not resampled. No new envelope or ledger reset was introduced.'}}
maintenance_path=reports / 'maya-maintenance.json'
maintenance=json.loads(maintenance_path.read_text()) if maintenance_path.exists() else None
if maintenance:
    for index, step in enumerate(maintenance['steps'], start=14):
        case(f'C{index:02}', step['id'].replace('-', ' ').capitalize(), maintenance['runId'], step.get('input'), step.get('bot'), step['trigger'], step.get('changes'), 'Linked real Maya continuation: native maintenance or source-grounded recall; source files stay authoritative.', 'real continuation pass', ['flush-compaction'] if index in [14,15,16,17] else ['dreaming','persistence','source'], step)
    status['MayaAutomaticFlush']='native succeeded marker observed in linked continuation; no distinct flush-only file write isolated'
    status['MayaCompaction']='committed; 9447 → 1182 tokens; summary contains older state'
    status['MayaPostDreamNativeAgent']='passed in new session after restart; historical blocked call retained'
    status['newPaidRuns']=1
    status['sameMayaContinuousAllFeatures']=False
    status['continuation']='Same retained Maya main session and workspace, across a later linked phase; other optional feature runs remain separate.'
    status['budget']=maintenance['budget']
    for f in capabilities:
        if f['id']=='flush-compaction':
            f['coverage']='real same-Maya continuation: native flush succeeded, compaction committed, current-source recall passed'
            f['boundary']='Thresholds/retention are explicit test settings. No SDK trigger. Summary may describe older state; no separate flush-only note write was isolated.'
        if f['id']=='persistence':f['coverage']='new native Maya session after dreaming/Gateway restart passed; fresh SDK and Vega evidence also retained'
    (reports / 'memory-capabilities.json').write_text(json.dumps(inventory,indent=2)+'\n')
coverage={'scope':inventory['scope'],'cases':[{k:c[k] for k in ['id','title','runId','status','featureIds']} for c in cases],'gaps':status}
(reports / 'memory-case-coverage.json').write_text(json.dumps(coverage,indent=2)+'\n')
story=clean({'title':'OpenClaw memory feature tour','narrative':'Maya is the main recorded conversation. Separate Zephyr, Borealis and Vega records demonstrate optional capabilities; the app tour is a fresh no-key run. Case order is a learning path, not a stitched continuous transcript. The October 13 maintenance is a real continuation of the retained Maya main session, with earlier failures left visible.','readmeMarkdown':(foundation / 'README.md').read_text(),'cases':cases,'runs':{'maya-chat-2026-10-12':maya, **({maintenance['runId']:maintenance} if maintenance else {})},'capabilityInventory':inventory,'gaps':status})
(reports / 'memory-story.json').write_text(json.dumps(story,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'cases':len(cases),'capabilities':len(capabilities),'newPaidRuns':status['newPaidRuns']}))

# Update only the presentation. The original Maya replay JSON remains unchanged.
import html
import re
page_path = reports / 'chatbot-memory-demo.html'
page = page_path.read_text()
page = re.sub(r'<!-- memory-feature-tour:start -->.*?<!-- memory-feature-tour:end -->', '', page, flags=re.S)
page = page.replace('href="readme-proposal.html">README and case matrix proposal', 'href="../README.md">Applied README')
page = page.replace('<title>OpenClaw conversation replay</title>', '<title>OpenClaw memory feature tour</title>')
esc = lambda value: html.escape(str(value))
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
page=page.replace('<main>', '<main>'+summary, 1)
if maintenance:
    page=page.replace('<h1>One conversation. Real memory changes.</h1>', '<h1>Original October 12 conversation</h1><p>The failed calls and unobserved flush below are preserved historical results. The linked October 13 native continuation appears above.</p>')
page_path.write_text(page)

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const foundation = fileURLToPath(new URL("../", import.meta.url));

async function isolatedFollowup(
  mode: "failure" | "success" | "repair" | "completion",
) {
  const root = await mkdtemp(join(tmpdir(), "one-user-followup-lab-"));
  const isolated = join(root, "foundation");
  try {
    await cp(join(foundation, "src"), join(isolated, "src"), {
      recursive: true,
    });
    await copyFile(
      join(foundation, "package.json"),
      join(isolated, "package.json"),
    );
    await symlink(
      join(foundation, "node_modules"),
      join(isolated, "node_modules"),
    );
    // Only the driver and WebSocket edge are synthetic. Actual Lab controls,
    // provisioning, predecessor binding and durable admissions remain in use.
    await writeFile(
      join(isolated, "src/one-user-followup.ts"),
      "export async function runOneUserFollowup(lab, controls) { return globalThis.__syntheticFollowup(lab, controls); }\n",
    );
    await writeFile(
      join(isolated, "src/one-user-owner-turn.ts"),
      "export async function oneUserFollowupOwnerTurn(input) { return globalThis.__syntheticFollowupOwner(input); }\n",
    );
    await mkdir(join(isolated, ".lab"), { mode: 0o700 });
    const program = [
      `const mode=${JSON.stringify(mode)};`,
      `const previewError=${JSON.stringify(`Unexpected token 's', "[secrets] m"... is not valid JSON`)};`,
      "import assert from 'node:assert/strict';",
      "import {createHash} from 'node:crypto';",
      "import {existsSync} from 'node:fs';",
      "import {mkdir,readFile,writeFile} from 'node:fs/promises';",
      "import {join,resolve} from 'node:path';",
      `import {Lab,PROJECT} from ${JSON.stringify(pathToFileURL(join(isolated, "src/lab.ts")).href)};`,
      `import {ONE_USER_DIRECTORY,ONE_USER_LEDGER,ONE_USER_REPORT,createOneUserAdmission,inspectOneUserQuota,claimOneUserActivation,admitOneUserRequest} from ${JSON.stringify(pathToFileURL(join(isolated, "src/one-user-budget.ts")).href)};`,
      `import {ONE_USER_FOLLOWUP_DIRECTORY,ONE_USER_FOLLOWUP_LEDGER,ONE_USER_FOLLOWUP_REPORT,ONE_USER_FOLLOWUP_PREPARATION_REPAIR,ONE_USER_FOLLOWUP_PREPARATION_REPAIR_REPORT,ONE_USER_FOLLOWUP_COMPLETION,inspectOneUserFollowupQuota,createOneUserFollowupAdmission,claimOneUserFollowupActivation,claimOneUserFollowupPreparationRepair,admitOneUserFollowupRequest,readOneUserFollowupLedger} from ${JSON.stringify(pathToFileURL(join(isolated, "src/one-user-followup-budget.ts")).href)};`,
      `assert.equal(resolve(PROJECT),${JSON.stringify(isolated)});`,
      `
const usage=()=>({usage:{updatedAt:Date.now(),providers:[{provider:'openrouter',billing:[{type:'budget',label:'API key budget',unit:'USD',limit:50,used:0,period:'weekly'}]}]}});
const endpoint='https://openrouter.ai/api/v1/chat/completions';
const boundedBody={method:'POST',body:JSON.stringify({model:'openai/gpt-6-sol',max_completion_tokens:512,messages:[{role:'user',content:'Synthetic reservation only; no transport.'}]})};
createOneUserAdmission(ONE_USER_DIRECTORY,inspectOneUserQuota(usage()));
claimOneUserActivation(ONE_USER_LEDGER);
admitOneUserRequest(ONE_USER_LEDGER,endpoint,boundedBody);
await writeFile(ONE_USER_REPORT,JSON.stringify({kind:'current-one-user-native-lifecycle',ok:false,error:'One-user nativeMaintenance: synthetic boundary',finishedAt:new Date().toISOString(),sourceSessionBefore:{session:{sessionId:'synthetic-main-id'}},stages:{nativeMaintenance:'fail: synthetic maintenance boundary'}}),{flag:'wx',mode:0o600});
const originals=['admission.json','activation.json','ledger.json','report.json'];
const originalHashes=async()=>Object.fromEntries(await Promise.all(originals.map(async name=>[name,createHash('sha256').update(await readFile(join(ONE_USER_DIRECTORY,name))).digest('hex')])));
const preserved=await originalHashes();
assert.notEqual(ONE_USER_FOLLOWUP_DIRECTORY,ONE_USER_DIRECTORY);
assert.equal(ONE_USER_FOLLOWUP_DIRECTORY,join(PROJECT,'.lab/one-user-maintenance-followup'));
assert.ok(!existsSync(ONE_USER_FOLLOWUP_DIRECTORY));
createOneUserFollowupAdmission(ONE_USER_FOLLOWUP_DIRECTORY,inspectOneUserFollowupQuota(usage()));
const corpus=join(ONE_USER_DIRECTORY,'corpus');
let failedFollowupHashes;
let completionEvidenceHashes,completionSourcePath,completionSourceText;
const completionPaths=['admission.json','activation.json','report.json','preparation-repair.json','preparation-repair-report.json'];
const completionHashes=async()=>Object.fromEntries(await Promise.all(completionPaths.map(async name=>[name,createHash('sha256').update(await readFile(join(ONE_USER_FOLLOWUP_DIRECTORY,name))).digest('hex')])));
const followupHashes=async()=>Object.fromEntries(await Promise.all(originals.map(async name=>[name,createHash('sha256').update(await readFile(join(ONE_USER_FOLLOWUP_DIRECTORY,name))).digest('hex')])));
if(mode==='repair'||mode==='completion'){
  claimOneUserFollowupActivation(ONE_USER_FOLLOWUP_LEDGER);
  const day=new Date().toISOString().slice(0,10);
  const snapshot={'USER.md':'Synthetic unchanged original profile'};
  await mkdir(join(corpus,'one-user/workspace/memory'),{recursive:true,mode:0o700});
  await writeFile(ONE_USER_FOLLOWUP_REPORT,JSON.stringify({schemaVersion:1,kind:'one-user-owner-maintenance-followup',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),nativeSourceDayUtc:day,sourcePath:'memory/'+day+'.md',sourceSessionKey:'agent:main:owner-followup',originalMainSessionKey:'agent:main:main',originalAttemptReplayed:false,harnessSourceWrites:false,ok:false,stages:{sourceOwnerWrite:'not-run',semanticRecall:'not-run',promotionEligible:'not-run',nativeMaintenance:'not-run',durablePromotion:'not-run',restartRecall:'not-run',sessionContinuity:'not-run',previousEvidencePreserved:'pass'},steps:[],initialWorkspace:snapshot,finalWorkspace:{...snapshot},error:'Memory not ready: '+JSON.stringify({results:[],disabled:true,unavailable:true,error:'index was built for model fts-only, expected openai/text-embedding-3-small'})+String.fromCharCode(10)+'Gateway diagnostics: ',requestLedger:readOneUserFollowupLedger(ONE_USER_FOLLOWUP_LEDGER)}),{flag:'wx',mode:0o600});
  failedFollowupHashes=await followupHashes();
}
if(mode==='completion'){
  claimOneUserFollowupPreparationRepair(ONE_USER_FOLLOWUP_LEDGER,inspectOneUserFollowupQuota(usage()));
  const startedAt=Date.now();
  for(let i=0;i<2;i++)admitOneUserFollowupRequest(ONE_USER_FOLLOWUP_LEDGER,endpoint,boundedBody);
  for(let i=0;i<3;i++)admitOneUserFollowupRequest(ONE_USER_FOLLOWUP_LEDGER,'https://openrouter.ai/api/v1/embeddings',{method:'POST',body:JSON.stringify({model:'openai/text-embedding-3-small',input:'Synthetic current routine'})});
  const day=new Date().toISOString().slice(0,10);
  const workspace=join(corpus,'one-user/workspace');
  completionSourcePath='memory/'+day+'.md';
  completionSourceText='Synthetic Sable reconfirmed rooibos and COBALT-LANTERN-0915.';
  await writeFile(join(workspace,completionSourcePath),completionSourceText,{flag:'wx',mode:0o600});
  const before={'USER.md':'Synthetic unchanged original profile'};
  const after={...before,[completionSourcePath]:completionSourceText};
  const source={version:1,workspaceKey:createHash('sha256').update(workspace).digest('hex'),relativePath:completionSourcePath,fileHash:createHash('sha256').update(completionSourceText).digest('hex'),originClass:'agent',observedAt:Date.now(),sessionId:'synthetic-owner-source-id',sessionKey:'agent:main:owner-followup',reservationId:'synthetic-native-reservation'};
  await writeFile(ONE_USER_FOLLOWUP_PREPARATION_REPAIR_REPORT,JSON.stringify({schemaVersion:1,kind:'one-user-owner-maintenance-followup',startedAt:new Date(startedAt).toISOString(),finishedAt:new Date().toISOString(),nativeSourceDayUtc:day,sourcePath:completionSourcePath,sourceSessionKey:'agent:main:owner-followup',originalMainSessionKey:'agent:main:main',originalAttemptReplayed:false,harnessSourceWrites:false,ok:false,stages:{sourceOwnerWrite:'pass',semanticRecall:'pass',promotionEligible:'not-run',nativeMaintenance:'not-run',durablePromotion:'not-run',restartRecall:'not-run',sessionContinuity:'not-run',previousEvidencePreserved:'pass'},steps:[{id:'owner-confirmed-new-day-source',session:'owner-followup',before,after,changes:[completionSourcePath]}],initialWorkspace:before,finalWorkspace:after,sourceProvenance:source,originalMainBefore:{session:{sessionId:'synthetic-main-id'}},sourceSession:{state:{session:{key:'agent:main:owner-followup',sessionId:source.sessionId,parentSessionKey:'agent:main:main',parentSessionId:'synthetic-main-id'}},initialMessages:[]},error:previewError,requestLedger:readOneUserFollowupLedger(ONE_USER_FOLLOWUP_LEDGER)}),{flag:'wx',mode:0o600});
  completionEvidenceHashes=await completionHashes();
}
const config=async lab=>JSON.parse(await readFile(lab.config,'utf8'));
const environment=lab=>Reflect.get(lab,'env').call(lab);
const secretRef={source:'env',provider:'bridge-env',id:'OPENROUTER_API_KEY'};
let driverCalls=0,helperCalls=0,gatewayStarts=0,configValidations=0,nativeCalls=0;
let activationBytes;
const checkpoints=[];
const labs=[];
function assertScopedRecall(cfg){
  assert.equal(cfg.plugins.entries['active-memory'].enabled,false);
  assert.equal(cfg.memory.search.rememberAcrossConversations,false);
  assert.ok(cfg.tools.allow.includes('memory_search'));
  assert.ok(cfg.tools.allow.includes('memory_get'));
}
function assertEnvironment(lab,active){
  const env=environment(lab);
  assert.equal(env.BRIDGE_ONE_USER_FOLLOWUP_LEDGER,active?ONE_USER_FOLLOWUP_LEDGER:undefined);
  assert.equal(env.BRIDGE_ONE_USER_LEDGER,undefined);
  assert.equal(env.OPENCLAW_LAB_LIFECYCLE_LEDGER,undefined);
  assert.equal(env.UNSELECTED_API_KEY,undefined);
  assert.equal(env.OPENROUTER_API_KEY,active?'synthetic-followup-controller-key':undefined);
}
globalThis.__syntheticFollowupOwner=async input=>{
  helperCalls++;
  assert.deepEqual(input,{url:'ws://127.0.0.1:18766',token:'synthetic-followup-owner-token',sessionKey:mode==='completion'||helperCalls!==1?'agent:main:followup-recall':'agent:main:owner-followup',message:'Synthetic owner follow-up'});
  return {syntheticOwner:true};
};
globalThis.__syntheticFollowup=async(lab,controls)=>{
  driverCalls++;
  assert.equal(controls.ledgerPath,ONE_USER_FOLLOWUP_LEDGER);
  assert.equal(controls.evidenceDirectory,ONE_USER_FOLLOWUP_DIRECTORY);
  activationBytes=await readFile(join(ONE_USER_FOLLOWUP_DIRECTORY,'activation.json'),'utf8');
  assert.equal(JSON.parse(activationBytes).state,'consumed-before-controller');
  if(mode==='completion'){
    assert.ok(existsSync(join(lab.directory,'lab.lock')));
    assertEnvironment(lab,false);
    assert.equal(controls.completionCheckpoint,ONE_USER_FOLLOWUP_PREPARATION_REPAIR_REPORT);
    const receipt=JSON.parse(await readFile(ONE_USER_FOLLOWUP_COMPLETION,'utf8'));
    assert.equal(receipt.state,'consumed-before-completion');
    assert.equal(receipt.newAllowanceCreated,false);assert.equal(receipt.sourceReplayAllowed,false);
    assert.equal(receipt.checkpointLedger.requests,5);
    assert.equal(receipt.partialReportSha256,completionEvidenceHashes['preparation-repair-report.json']);
    assert.equal(readOneUserFollowupLedger(ONE_USER_FOLLOWUP_LEDGER).requests,5);
    await controls.activate(ONE_USER_FOLLOWUP_LEDGER);
    assertScopedRecall(await config(lab));
    await assert.rejects(controls.ownerTurn('owner-followup','Synthetic owner follow-up'),/invalid/i);
    assert.equal(gatewayStarts,0);assert.equal(helperCalls,0);
    await controls.phase('recall');
    assertScopedRecall(await config(lab));
    assert.deepEqual(await controls.ownerTurn('followup-recall','Synthetic owner follow-up'),{syntheticOwner:true});
    assert.equal(gatewayStarts,1);assert.equal(helperCalls,1);
    admitOneUserFollowupRequest(ONE_USER_FOLLOWUP_LEDGER,endpoint,boundedBody);
    await controls.finish();
    await controls.checkpoint({ok:true,requestLedger:{requests:-99}});
    return {ok:true,requestLedger:{requests:-999}};
  }
  if(mode==='repair'){
    assert.ok(existsSync(join(lab.directory,'lab.lock')),'Corpus lock must precede repair permission.');
    const repair=JSON.parse(await readFile(ONE_USER_FOLLOWUP_PREPARATION_REPAIR,'utf8'));
    assert.equal(repair.state,'consumed-before-preparation-repair');
    assert.equal(repair.newAllowanceCreated,false);
    assert.equal(repair.automaticReplayAllowed,false);
    assert.equal(repair.failedReportSha256,failedFollowupHashes['report.json']);
    assert.equal(repair.activationSha256,failedFollowupHashes['activation.json']);
    assert.equal(repair.initialLedgerSha256,failedFollowupHashes['ledger.json']);
    assert.equal(readOneUserFollowupLedger(ONE_USER_FOLLOWUP_LEDGER).requests,0);
  }
  assertEnvironment(lab,false);
  await assert.rejects(controls.phase('semantic'),/not active/i);
  await assert.rejects(controls.ownerTurn('owner-followup','Synthetic owner follow-up'),/not active/i);
  await assert.rejects(controls.activate(ONE_USER_LEDGER),/invalid/i);
  await controls.activate(ONE_USER_FOLLOWUP_LEDGER);
  await assert.rejects(controls.activate(ONE_USER_FOLLOWUP_LEDGER),/invalid/i);
  assertEnvironment(lab,true);
  assertScopedRecall(await config(lab));
  for(const session of ['main','other','agent:main:owner-followup'])
    await assert.rejects(controls.ownerTurn(session,'Synthetic owner follow-up'),/invalid/i);
  await assert.rejects(controls.ownerTurn('owner-followup',' '),/invalid/i);
  await assert.rejects(controls.ownerTurn('owner-followup','x'.repeat(64001)),/invalid/i);
  assert.equal(helperCalls,0);assert.equal(gatewayStarts,0);
  await assert.rejects(controls.phase('unexpected'),/invalid/i);
  await controls.phase('semantic');
  let cfg=await config(lab);
  assertScopedRecall(cfg);
  assert.equal(cfg.agents.defaults.params.maxTokens,512);
  assert.equal(cfg.models.providers.openrouter.models[0].maxTokens,2048);
  assert.equal(cfg.agents.defaults.model.primary,'openrouter/openai/gpt-6-sol');
  assert.deepEqual(cfg.agents.defaults.model.fallbacks,[]);
  assert.equal(cfg.memory.search.provider,'openai-compatible');
  assert.equal(cfg.memory.search.model,'openai/text-embedding-3-small');
  assert.equal(cfg.memory.search.remote.baseUrl,'https://openrouter.ai/api/v1');
  assert.deepEqual(cfg.memory.search.remote.apiKey,secretRef);
  assert.equal(cfg.agents.defaults.compaction.memoryFlush.forceFlushTranscriptBytes,'2mb');
  assert.ok(['read','write','edit'].every(name=>cfg.tools.allow.includes(name)));
  assert.equal(cfg.cron.enabled,false);
  assert.equal(cfg.plugins.entries['memory-core'].config.dreaming.enabled,false);
  assert.equal(JSON.stringify(cfg).includes('synthetic-followup-controller-key'),false);
  assert.deepEqual(await controls.ownerTurn('owner-followup','Synthetic owner follow-up'),{syntheticOwner:true});
  assert.equal(gatewayStarts,1);assert.equal(helperCalls,1);
  await controls.phase('maintenance');
  cfg=await config(lab);
  assertScopedRecall(cfg);
  assert.equal(cfg.cron.enabled,true);
  const dreaming=cfg.plugins.entries['memory-core'].config.dreaming;
  assert.equal(dreaming.enabled,true);
  assert.equal(dreaming.execution.defaults.model,'openrouter/openai/gpt-6-sol');
  for(const phase of ['light','rem','deep'])assert.equal(dreaming.phases[phase].execution.model,'openrouter/openai/gpt-6-sol');
  assert.equal(cfg.agents.defaults.compaction.memoryFlush.enabled,false);
  assert.ok(['read','write','edit'].every(name=>!cfg.tools.allow.includes(name)));
  await controls.phase('recall');
  cfg=await config(lab);
  assertScopedRecall(cfg);
  assert.equal(cfg.cron.enabled,false);
  assert.equal(cfg.plugins.entries['memory-core'].config.dreaming.enabled,false);
  assert.equal(cfg.agents.defaults.compaction.memoryFlush.enabled,false);
  assert.ok(['read','write','edit'].every(name=>!cfg.tools.allow.includes(name)));
  assert.deepEqual(await controls.ownerTurn('followup-recall','Synthetic owner follow-up'),{syntheticOwner:true});
  assert.equal(gatewayStarts,2);assert.equal(helperCalls,2);
  if(mode==='success'){
    admitOneUserFollowupRequest(ONE_USER_FOLLOWUP_LEDGER,endpoint,boundedBody);
    await controls.checkpoint({phase:'active',selectedKey:'synthetic-followup-controller-key',requestLedger:{requests:-1}});
    admitOneUserFollowupRequest(ONE_USER_FOLLOWUP_LEDGER,endpoint,boundedBody);
  }
  await controls.finish();
  assertEnvironment(lab,false);
  await assert.rejects(controls.ownerTurn('owner-followup','Synthetic owner follow-up'),/not active/i);
  assert.equal(gatewayStarts,2);assert.equal(helperCalls,2);
  if(mode==='failure')throw new Error('Synthetic follow-up controller failure');
  await controls.checkpoint({ok:true,requestLedger:{requests:-2}});
  return {ok:true,requestLedger:{requests:-3}};
};
async function prepared(){
  const lab=await new Lab('one-user',corpus).init();labs.push(lab);
  lab.validateConfig=async()=>{configValidations++;assertEnvironment(lab,true);assertScopedRecall(await config(lab));assert.ok(existsSync(join(ONE_USER_FOLLOWUP_DIRECTORY,'activation.json')));return {valid:true};};
  lab.start=async()=>{gatewayStarts++;assertEnvironment(lab,true);Reflect.set(lab,'port',18766);Reflect.set(lab,'token','synthetic-followup-owner-token');};
  Reflect.set(lab,'native',async()=>{nativeCalls++;throw new Error('Unexpected native transport in synthetic controller fixture');});
  return lab;
}
try{
  const lab=await prepared();
  if(mode==='failure')await assert.rejects(lab.boundedOneUserFollowup(value=>{checkpoints.push(value);}),/Synthetic follow-up controller failure/);
  else if(mode==='success'){
    const result=await lab.boundedOneUserFollowup(value=>{checkpoints.push(value);});
    assert.equal(result.ok,true);
    assert.deepEqual(checkpoints.map(value=>value.requestLedger.requests),[1,2]);
    assert.equal(checkpoints[0].selectedKey,'[REDACTED]');
    assert.equal(checkpoints[0].requestLedger.outputTokens,512);
    assert.equal(result.requestLedger.requests,2);
    assert.equal(result.requestLedger.outputTokens,1024);
    assert.deepEqual(result.requestLedger,readOneUserFollowupLedger(ONE_USER_FOLLOWUP_LEDGER));
    assert.deepEqual(checkpoints[1],result);
  }
  else if(mode==='repair'){
    await assert.rejects(lab.boundedOneUserFollowup(async()=>{}),/already activated|automatic resume denied/i);
    assert.equal(driverCalls,0);assert.ok(!existsSync(ONE_USER_FOLLOWUP_PREPARATION_REPAIR));
    Reflect.set(lab,'child',{});
    await assert.rejects(lab.repairOneUserFollowupPreparation(inspectOneUserFollowupQuota(usage()),async()=>{}),/inactive corpus/i);
    Reflect.set(lab,'child',undefined);
    assert.equal(driverCalls,0);assert.ok(!existsSync(ONE_USER_FOLLOWUP_PREPARATION_REPAIR));
    const result=await lab.repairOneUserFollowupPreparation(inspectOneUserFollowupQuota(usage()),value=>{checkpoints.push(value);});
    assert.equal(result.ok,true);assert.equal(result.requestLedger.requests,0);
    assert.deepEqual(checkpoints.map(value=>value.requestLedger.requests),[0]);
    assert.deepEqual(result.requestLedger,readOneUserFollowupLedger(ONE_USER_FOLLOWUP_LEDGER));
    assert.deepEqual(await followupHashes(),failedFollowupHashes);
  }
  else{
    await assert.rejects(lab.boundedOneUserFollowup(async()=>{}),/already dispatched|automatic resume denied/i);
    await assert.rejects(lab.repairOneUserFollowupPreparation(inspectOneUserFollowupQuota(usage()),async()=>{}),/nonzero attempts/i);
    assert.equal(driverCalls,0);assert.ok(!existsSync(ONE_USER_FOLLOWUP_COMPLETION));
    const result=await lab.completeOneUserFollowup(inspectOneUserFollowupQuota(usage()),value=>{checkpoints.push(value);});
    assert.equal(result.ok,true);assert.equal(result.requestLedger.requests,6);
    assert.deepEqual(checkpoints.map(value=>value.requestLedger.requests),[6]);
    assert.deepEqual(result.requestLedger,readOneUserFollowupLedger(ONE_USER_FOLLOWUP_LEDGER));
    assert.deepEqual(await completionHashes(),completionEvidenceHashes);
    assert.equal(await readFile(join(lab.directory,'workspace',completionSourcePath),'utf8'),completionSourceText);
  }
  assertEnvironment(lab,false);
  assert.equal(Reflect.get(lab,'oneUserFollowupLedger'),undefined);
  assert.equal(Reflect.get(lab,'oneUserLedger'),undefined);
  assert.equal(Reflect.get(lab,'oneUserMaintenance'),false);
  const clean=await config(lab);
  assert.equal(clean.memory.search.provider,'none');
  assert.equal(clean.plugins.entries['active-memory'],undefined);
  assert.equal(clean.models,undefined);assert.equal(clean.secrets,undefined);
  assert.equal(clean.plugins.entries['memory-core'].config.dreaming.enabled,false);
  assert.deepEqual(clean.tools.allow,['memory_search','memory_get']);
  assert.equal(configValidations,1);assert.equal(driverCalls,1);assert.equal(nativeCalls,0);
  assert.equal(await readFile(join(ONE_USER_FOLLOWUP_DIRECTORY,'activation.json'),'utf8'),activationBytes);
  assert.deepEqual(await originalHashes(),preserved);
  await lab.close();
  const reopened=await prepared();
  await assert.rejects(reopened.boundedOneUserFollowup(async()=>{}),/already activated|already dispatched|automatic resume denied/i);
  if(mode==='repair'){
    await assert.rejects(reopened.repairOneUserFollowupPreparation(inspectOneUserFollowupQuota(usage()),async()=>{}),/already consumed|uncertain/i);
    assert.deepEqual(await followupHashes(),failedFollowupHashes);
    assert.equal(readOneUserFollowupLedger(ONE_USER_FOLLOWUP_LEDGER).requests,0);
  }
  if(mode==='completion'){
    await assert.rejects(reopened.completeOneUserFollowup(inspectOneUserFollowupQuota(usage()),async()=>{}),/already consumed|uncertain/i);
    assert.deepEqual(await completionHashes(),completionEvidenceHashes);
    assert.equal(readOneUserFollowupLedger(ONE_USER_FOLLOWUP_LEDGER).requests,6);
  }
  assert.equal(driverCalls,1);assert.equal(configValidations,1);assert.equal(helperCalls,mode==='completion'?1:2);assert.equal(nativeCalls,0);
  assertEnvironment(reopened,false);
  assert.deepEqual(await originalHashes(),preserved);
  console.log(JSON.stringify({mode,synthetic:true,ownerSessionBounds:true,distinctScope:true,originalEvidenceUnchanged:true,replayDenied:true,scopeCleared:true,freshCounters:mode==='success',actualNativeRequests:0}));
}finally{await Promise.all(labs.map(lab=>lab.close()));}
`,
    ].join("\n");
    const { stdout } = await execute(
      process.execPath,
      ["--input-type=module", "-e", program],
      {
        cwd: isolated,
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "en_US.UTF-8",
          OPENROUTER_API_KEY: "synthetic-followup-controller-key",
          UNSELECTED_API_KEY: "synthetic-unselected-host-key",
          BRIDGE_ONE_USER_LEDGER: "/synthetic/unselected-old-scope.json",
          BRIDGE_ONE_USER_FOLLOWUP_LEDGER:
            "/synthetic/unselected-followup.json",
          OPENCLAW_LAB_LIFECYCLE_LEDGER: "/synthetic/unselected-legacy.json",
        },
        timeout: 25000,
        maxBuffer: 16384,
      },
    );
    return JSON.parse(stdout);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const mode of ["failure", "success", "repair", "completion"] as const) {
  test(`ONE USER FOLLOWUP LAB: ${mode} preserves predecessor evidence and revokes bounded owner permission`, {
    timeout: 30000,
  }, async () => {
    assert.deepEqual(await isolatedFollowup(mode), {
      mode,
      synthetic: true,
      ownerSessionBounds: true,
      distinctScope: true,
      originalEvidenceUnchanged: true,
      replayDenied: true,
      scopeCleared: true,
      freshCounters: mode === "success",
      actualNativeRequests: 0,
    });
  });
}

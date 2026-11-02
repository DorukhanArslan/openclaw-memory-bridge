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
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const foundation = fileURLToPath(new URL("../", import.meta.url));

test("ONE USER LAB: scoped controls bound owner turns and clear permission after uncertain failure", {
  timeout: 30000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "one-user-lab-integration-"));
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
    // The copied controller is deliberately synthetic. All real Lab controls,
    // provisioning, admission and cleanup code below remain unchanged.
    await writeFile(
      join(isolated, "src/one-user-lifecycle.ts"),
      "export async function runOneUserLifecycle(lab, controls) { return globalThis.__syntheticOneUserDriver(lab, controls); }\n",
    );
    await writeFile(
      join(isolated, "src/one-user-owner-turn.ts"),
      "export async function oneUserOwnerTurn(input) { return globalThis.__syntheticOwnerTurn(input); }\n",
    );
    await mkdir(join(isolated, ".lab"), { mode: 0o700 });
    const program = [
      "import assert from 'node:assert/strict';",
      "import {existsSync} from 'node:fs';",
      "import {readFile} from 'node:fs/promises';",
      "import {join,resolve} from 'node:path';",
      `import {Lab,PROJECT} from ${JSON.stringify(pathToFileURL(join(isolated, "src/lab.ts")).href)};`,
      `import {ONE_USER_DIRECTORY,ONE_USER_LEDGER,createOneUserAdmission,inspectOneUserQuota,readOneUserLedger} from ${JSON.stringify(pathToFileURL(join(isolated, "src/one-user-budget.ts")).href)};`,
      `assert.equal(resolve(PROJECT),${JSON.stringify(resolve(isolated))});`,
      "assert.equal(ONE_USER_DIRECTORY,join(PROJECT,'.lab/one-user-lifecycle'));",
      "assert.ok(!existsSync(ONE_USER_DIRECTORY));",
      "const quota=inspectOneUserQuota({usage:{updatedAt:Date.now(),providers:[{provider:'openrouter',billing:[{type:'budget',label:'API key budget',unit:'USD',limit:50,used:0,period:'weekly'}]}]}});",
      "createOneUserAdmission(ONE_USER_DIRECTORY,quota);",
      "const corpus=join(ONE_USER_DIRECTORY,'corpus');",
      "let driverCalls=0, wouldDispatches=0, ownerDispatches=0, gatewayStarts=0, configValidations=0;",
      "let activationBytes, activeLedgerBytes;",
      "const labs=[];",
      "const config=async lab=>JSON.parse(await readFile(lab.config,'utf8'));",
      "const environment=lab=>Reflect.get(lab,'env').call(lab);",
      "const secret={source:'env',provider:'bridge-env',id:'OPENROUTER_API_KEY'};",
      "function assertEnvironment(lab,active){const env=environment(lab);assert.equal(env.BRIDGE_ONE_USER_LEDGER,active?ONE_USER_LEDGER:undefined);assert.equal(env.OPENCLAW_LAB_LIFECYCLE_LEDGER,undefined);assert.equal(env.UNSELECTED_API_KEY,undefined);assert.equal(env.OPENROUTER_API_KEY,active?'synthetic-one-user-controller-key':undefined);}",
      "globalThis.__syntheticOwnerTurn=async input=>{ownerDispatches++;assert.deepEqual(input,{url:'ws://127.0.0.1:18765',token:'synthetic-one-user-owner-token',sessionKey:'agent:main:main',message:'Synthetic owner controller check'});return {syntheticOwner:true};};",
      "globalThis.__syntheticOneUserDriver=async(lab,controls)=>{",
      "driverCalls++;",
      "assert.equal(controls.ledgerPath,ONE_USER_LEDGER);",
      "assert.equal(controls.evidenceDirectory,ONE_USER_DIRECTORY);",
      "assert.ok(existsSync(join(ONE_USER_DIRECTORY,'activation.json')),'Direct-method activation must precede controller permission.');",
      "activationBytes=await readFile(join(ONE_USER_DIRECTORY,'activation.json'),'utf8');",
      "assert.equal(JSON.parse(activationBytes).state,'consumed-before-controller');",
      "assertEnvironment(lab,false);",
      "await assert.rejects(controls.phase('profile'),/not active/);",
      "await assert.rejects(controls.ownerTurn('main','Synthetic owner controller check'),/not active|invalid/i);",
      "await assert.rejects(controls.activate('/synthetic/wrong-ledger.json'),/Invalid one-user activation/);",
      "await controls.activate(ONE_USER_LEDGER);",
      "await assert.rejects(controls.activate(ONE_USER_LEDGER),/Invalid one-user activation/);",
      "assertEnvironment(lab,true);",
      "await assert.rejects(controls.ownerTurn('other','Synthetic owner controller check'),/invalid|main/i);",
      "await assert.rejects(controls.ownerTurn('agent:main:main','Synthetic owner controller check'),/invalid|main/i);",
      "await assert.rejects(controls.ownerTurn('main','  '),/invalid|message/i);",
      "await assert.rejects(controls.ownerTurn('main','x'.repeat(64001)),/invalid|message/i);",
      "assert.equal(gatewayStarts,0);assert.equal(ownerDispatches,0);",
      "assert.deepEqual(await controls.ownerTurn('main','Synthetic owner controller check'),{syntheticOwner:true});",
      "assert.equal(gatewayStarts,1);assert.equal(ownerDispatches,1);",
      "let cfg=await config(lab);",
      "assert.equal(cfg.agents.defaults.params.maxTokens,512);",
      "assert.equal(cfg.models.providers.openrouter.models[0].maxTokens,2048);",
      "assert.equal(cfg.agents.defaults.model.primary,'openrouter/openai/gpt-6-sol');",
      "assert.deepEqual(cfg.agents.defaults.model.fallbacks,[]);",
      "assert.equal(cfg.cron.enabled,false);",
      "assert.equal(cfg.tools.codeMode,false);assert.equal(cfg.tools.toolSearch,false);",
      "assert.equal(cfg.plugins.entries['memory-core'].config.dreaming.enabled,false);",
      "assert.equal(cfg.agents.defaults.compaction.memoryFlush.forceFlushTranscriptBytes,'2mb');",
      "assert.equal(JSON.stringify(cfg).includes('synthetic-one-user-controller-key'),false);",
      "await lab.configureFlush('off');",
      "cfg=await config(lab);",
      "assert.equal(cfg.agents.defaults.compaction.memoryFlush.enabled,false);",
      "assert.ok(['read','write','edit'].every(name=>!cfg.tools.allow.includes(name)));",
      "await controls.phase('semantic');",
      "cfg=await config(lab);",
      "assert.equal(cfg.memory.search.provider,'openai-compatible');",
      "assert.equal(cfg.memory.search.model,'openai/text-embedding-3-small');",
      "assert.equal(cfg.memory.search.remote.baseUrl,'https://openrouter.ai/api/v1');",
      "assert.deepEqual(cfg.memory.search.remote.apiKey,secret);",
      "assert.equal(cfg.cron.enabled,false);",
      "await controls.phase('flush');",
      "cfg=await config(lab);",
      "assert.equal(cfg.agents.defaults.compaction.memoryFlush.enabled,true);",
      "assert.equal(cfg.agents.defaults.compaction.memoryFlush.forceFlushTranscriptBytes,1024);",
      "await controls.phase('maintenance');",
      "cfg=await config(lab);",
      "assert.equal(cfg.cron.enabled,true);",
      "const dreaming=cfg.plugins.entries['memory-core'].config.dreaming;",
      "assert.equal(dreaming.enabled,true);",
      "assert.equal(dreaming.execution.defaults.model,'openrouter/openai/gpt-6-sol');",
      "for(const phase of ['light','rem','deep'])assert.equal(dreaming.phases[phase].execution.model,'openrouter/openai/gpt-6-sol');",
      "const output=await controls.localTurn('main','Synthetic controller check');",
      "assert.equal(output.syntheticNative,true);",
      "activeLedgerBytes=await readFile(ONE_USER_LEDGER,'utf8');",
      "assert.equal(readOneUserLedger(ONE_USER_LEDGER).requests,0);",
      "await controls.finish();",
      "await assert.rejects(controls.ownerTurn('main','Synthetic owner controller check'),/not active|invalid/i);",
      "assert.equal(gatewayStarts,1);assert.equal(ownerDispatches,1);",
      "throw new Error('Synthetic controller failure before real native dispatch');",
      "};",
      "async function prepared(){const lab=await new Lab('one-user',corpus).init();labs.push(lab);",
      "lab.validateConfig=async()=>{configValidations++;assertEnvironment(lab,true);assert.ok(existsSync(join(ONE_USER_DIRECTORY,'activation.json')));return {valid:true};};",
      "lab.start=async()=>{gatewayStarts++;assertEnvironment(lab,true);Reflect.set(lab,'port',18765);Reflect.set(lab,'token','synthetic-one-user-owner-token');};",
      "Reflect.set(lab,'native',async(args,timeout,bounded,stdoutOnly)=>{wouldDispatches++;assertEnvironment(lab,true);assert.deepEqual(args,['agent','--local','--agent','main','--session-key','agent:main:main','--message','Synthetic controller check','--thinking','off','--timeout','120','--json']);assert.equal(timeout,150000);assert.equal(bounded,false);assert.equal(stdoutOnly,true);return JSON.stringify({syntheticNative:true});});return lab;}",
      "try{",
      "const first=await prepared();",
      "await assert.rejects(first.boundedOneUserLifecycle(async()=>{}),/Synthetic controller failure/);",
      "assert.equal(configValidations,1);assert.equal(wouldDispatches,1);assert.equal(driverCalls,1);assert.equal(ownerDispatches,1);",
      "assertEnvironment(first,false);",
      "assert.equal(Reflect.get(first,'oneUserLedger'),undefined);assert.equal(Reflect.get(first,'oneUserMaintenance'),false);",
      "const clean=await config(first);",
      "assert.equal(clean.memory.search.provider,'none');",
      "assert.equal(clean.agents.defaults.compaction.memoryFlush.enabled,false);",
      "assert.deepEqual(clean.tools.allow,['memory_search','memory_get']);",
      "assert.equal(clean.models,undefined);assert.equal(clean.secrets,undefined);",
      "assert.equal(clean.plugins.entries['memory-core'].config.dreaming.enabled,false);",
      "assert.equal(await readFile(ONE_USER_LEDGER,'utf8'),activeLedgerBytes);",
      "assert.equal(await readFile(join(ONE_USER_DIRECTORY,'activation.json'),'utf8'),activationBytes);",
      "await first.close();",
      "const second=await prepared();",
      "await assert.rejects(second.boundedOneUserLifecycle(async()=>{}),/already activated|automatic resume denied/);",
      "assert.equal(driverCalls,1);assert.equal(wouldDispatches,1);assert.equal(configValidations,1);assert.equal(ownerDispatches,1);",
      "assertEnvironment(second,false);",
      "console.log(JSON.stringify({synthetic:true,activationBeforePermission:true,finiteConfiguration:true,semanticSecretRef:true,cleanupAfterFailure:true,replayDenied:true,actualNativeRequests:0}));",
      "}finally{await Promise.all(labs.map(lab=>lab.close()));}",
    ].join("\n");
    const { stdout } = await execute(
      process.execPath,
      ["--input-type=module", "-e", program],
      {
        cwd: isolated,
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "en_US.UTF-8",
          OPENROUTER_API_KEY: "synthetic-one-user-controller-key",
          UNSELECTED_API_KEY: "synthetic-unselected-host-key",
          OPENCLAW_LAB_LIFECYCLE_LEDGER:
            "/synthetic/unselected-old-ledger.json",
        },
        timeout: 25000,
        maxBuffer: 16384,
      },
    );
    assert.deepEqual(JSON.parse(stdout), {
      synthetic: true,
      activationBeforePermission: true,
      finiteConfiguration: true,
      semanticSecretRef: true,
      cleanupAfterFailure: true,
      replayDenied: true,
      actualNativeRequests: 0,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ONE USER LAB: controller checkpoints and successful results use fresh durable request counters", {
  timeout: 30000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "one-user-lab-evidence-")),
    isolated = join(root, "foundation");
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
    await writeFile(
      join(isolated, "src/one-user-lifecycle.ts"),
      "export async function runOneUserLifecycle(lab, controls) { return globalThis.__syntheticEvidenceDriver(lab, controls); }\n",
    );
    await mkdir(join(isolated, ".lab"), { mode: 0o700 });
    const program = [
      "import assert from 'node:assert/strict';",
      "import {readFile} from 'node:fs/promises';",
      "import {join} from 'node:path';",
      `import {Lab} from ${JSON.stringify(pathToFileURL(join(isolated, "src/lab.ts")).href)};`,
      `import {ONE_USER_DIRECTORY,ONE_USER_LEDGER,createOneUserAdmission,inspectOneUserQuota,admitOneUserRequest,readOneUserLedger} from ${JSON.stringify(pathToFileURL(join(isolated, "src/one-user-budget.ts")).href)};`,
      "createOneUserAdmission(ONE_USER_DIRECTORY,inspectOneUserQuota({usage:{updatedAt:Date.now(),providers:[{provider:'openrouter',billing:[{type:'budget',label:'API key budget',unit:'USD',limit:50,used:0,period:'weekly'}]}]}}));",
      "const checkpoints=[];let nativeDispatches=0;",
      "const reserve=()=>admitOneUserRequest(ONE_USER_LEDGER,'https://openrouter.ai/api/v1/chat/completions',{method:'POST',body:JSON.stringify({model:'openai/gpt-6-sol',max_completion_tokens:512,messages:[{role:'user',content:'Synthetic local admission counter; never transported.'}]})});",
      "globalThis.__syntheticEvidenceDriver=async(lab,controls)=>{await controls.activate(ONE_USER_LEDGER);reserve();await controls.checkpoint({phase:'synthetic',requestLedger:{requests:-123}});reserve();await controls.finish();await controls.checkpoint({accepted:true,requestLedger:{requests:-234}});return {accepted:true,requestLedger:{requests:-456}};};",
      "const lab=await new Lab('one-user',join(ONE_USER_DIRECTORY,'corpus')).init();",
      "lab.validateConfig=async()=>({valid:true});",
      "Reflect.set(lab,'native',async()=>{nativeDispatches++;throw new Error('Unexpected synthetic native dispatch');});",
      "try{",
      "const report=await lab.boundedOneUserLifecycle(async value=>{checkpoints.push(value);});",
      "assert.equal(report.accepted,true);assert.equal(report.requestLedger.requests,2);assert.equal(report.requestLedger.outputTokens,1024);",
      "assert.deepEqual(checkpoints.map(value=>value.requestLedger.requests),[1,2]);",
      "assert.equal(checkpoints[0].requestLedger.outputTokens,512);assert.deepEqual(checkpoints[1],report);",
      "assert.deepEqual(report.requestLedger,readOneUserLedger(ONE_USER_LEDGER));assert.equal(nativeDispatches,0);",
      "const env=Reflect.get(lab,'env').call(lab);assert.equal(env.BRIDGE_ONE_USER_LEDGER,undefined);assert.equal(env.OPENROUTER_API_KEY,undefined);",
      "const cfg=JSON.parse(await readFile(lab.config,'utf8'));assert.equal(cfg.memory.search.provider,'none');assert.equal(cfg.models,undefined);",
      "console.log(JSON.stringify({synthetic:true,checkpointRequests:1,resultRequests:2,actualNativeRequests:0,scopeCleared:true}));",
      "}finally{await lab.close();}",
    ].join("\n");
    const { stdout } = await execute(
      process.execPath,
      ["--input-type=module", "-e", program],
      {
        cwd: isolated,
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "en_US.UTF-8",
          OPENROUTER_API_KEY: "synthetic-one-user-evidence-key",
        },
        timeout: 25000,
        maxBuffer: 16384,
      },
    );
    assert.deepEqual(JSON.parse(stdout), {
      synthetic: true,
      checkpointRequests: 1,
      resultRequests: 2,
      actualNativeRequests: 0,
      scopeCleared: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

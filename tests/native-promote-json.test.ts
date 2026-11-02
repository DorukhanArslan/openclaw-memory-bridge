import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const foundation = fileURLToPath(new URL("../", import.meta.url));

test("NATIVE PROMOTE JSON: real SecretRef diagnostics stay on stderr while the bridge parses stdout", {
  timeout: 45000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "native-promote-json-"));
  try {
    const program = [
      "import assert from 'node:assert/strict';",
      "import {execFile} from 'node:child_process';",
      "import {readFile,writeFile} from 'node:fs/promises';",
      "import {dirname,resolve} from 'node:path';",
      "import {fileURLToPath} from 'node:url';",
      "import {promisify} from 'node:util';",
      `import {Lab} from ${JSON.stringify(new URL("../src/lab.ts", import.meta.url).href)};`,
      `const root=${JSON.stringify(root)};`,
      `const preload=${JSON.stringify(fileURLToPath(new URL("../src/native-bootstrap.ts", import.meta.url)))};`,
      `
const lab=await new Lab('json',root).init();
try{
  const cfg=JSON.parse(await readFile(lab.config,'utf8'));
  // This unused fixture credential deliberately exercises native CLI SecretRef
  // resolution. The lab stays keyword-only and selects no paid model/key.
  cfg.models={catalogRefresh:{enabled:false},providers:{openrouter:{apiKey:{source:'env',provider:'bridge-env',id:'SYNTHETIC_PROMOTE_KEY'}}}};
  cfg.secrets={providers:{'bridge-env':{source:'env',allowlist:['SYNTHETIC_PROMOTE_KEY']}}};
  await writeFile(lab.config,JSON.stringify(cfg));
  const actualEnv=Reflect.get(lab,'env').bind(lab);
  Reflect.set(lab,'env',()=>({...actualEnv(),SYNTHETIC_PROMOTE_KEY:'synthetic-inactive-promote-key'}));
  const env=Reflect.get(lab,'env').call(lab);
  assert.equal(env.OPENROUTER_API_KEY,undefined);
  assert.equal(env.BRIDGE_ONE_USER_LEDGER,undefined);
  assert.equal(env.BRIDGE_ONE_USER_FOLLOWUP_LEDGER,undefined);
  assert.equal(env.OPENCLAW_LAB_LIFECYCLE_LEDGER,undefined);
  assert.equal(cfg.memory.search.provider,'none');
  const entry=resolve(dirname(fileURLToPath(import.meta.resolve('openclaw'))),'../openclaw.mjs');
  const args=['memory','promote','--agent','main','--json'];
  const raw=await promisify(execFile)(process.execPath,['--import',preload,entry,...args],{cwd:lab.directory,env,timeout:30000,maxBuffer:65536});
  assert.ok(raw.stderr.includes('[secrets] memory promote:'));
  assert.equal(raw.stdout.includes('[secrets]'),false);
  assert.equal((raw.stdout+raw.stderr).includes('synthetic-inactive-promote-key'),false);
  const native=JSON.parse(raw.stdout);
  assert.equal(native.workspaceDir,resolve(lab.directory,'workspace'));
  assert.deepEqual(native.candidates,[]);
  assert.throws(()=>JSON.parse(raw.stderr+raw.stdout),SyntaxError);
  const result=await lab.promote();
  assert.equal(result.workspaceDir,native.workspaceDir);
  assert.deepEqual(result.candidates,native.candidates);
  assert.equal(result.audit.entryCount,0);
  assert.equal(result.apply,undefined);
  console.log(JSON.stringify({actualNativeCli:true,keywordOnly:true,selectedProviderCredentials:false,stderrSecretDiagnostics:true,stdoutJson:true,bridgePromoteParsed:true,inferenceRequests:0}));
}finally{await lab.close();}
`,
    ].join("\n");
    const { stdout } = await execute(
      process.execPath,
      ["--input-type=module", "-e", program],
      {
        cwd: foundation,
        env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
        timeout: 40000,
        maxBuffer: 16384,
      },
    );
    assert.deepEqual(JSON.parse(stdout), {
      actualNativeCli: true,
      keywordOnly: true,
      selectedProviderCredentials: false,
      stderrSecretDiagnostics: true,
      stdoutJson: true,
      bridgePromoteParsed: true,
      inferenceRequests: 0,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** Pinned native template creation and prompt preparation; never a model run. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const foundation = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = join(foundation, 'node_modules/openclaw');
const node = join(foundation, 'node_modules/node/bin/node');
const filenames = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'BOOTSTRAP.md'];
const contracts = {
  'workspace-C0LMBmap.mjs': 'c39922b28d2d5f7893d7b2a19afbcba3392283af318ab3ecc72d57cf0ae765ba',
  'bootstrap-files-CgqY-7GK.mjs': '835205537668cf94a81d9c9828971e0a3f192866b54fea1858f611d1729db024',
  'system-prompt-params-BxQn8CFS.mjs': 'a2b7636601bddbacc9056a027c67a978a3773c1444c43cdc0a5c16906b457b41',
  'openclaw-tools-DIUCugPR.mjs': '459c9ecddf95e3e5d75ee6e4e7941ffb230ed07aa71bcd1bad833f1d5df6e402',
  'bootstrap-budget-CqFoeR-L.mjs': 'c98e894d987b22efa9860f451988a4a0c65c8a5588afa604b281302f6d70561a',
  'frontmatter-Bibn4xoJ.mjs': '988fcb7ffa2d6350c712fd4d9fc24da3916bf77e65e05f00cf7d1e23ec9284f9',
  'watched-sessions-prompt-5dt_UXy3.mjs': 'facff66aae8b76f2ba855696ef1020cf83029320f17696aeee90cdccdd5a9bee',
};
const hash = text => createHash('sha256').update(text).digest('hex');
const native = name => import(pathToFileURL(join(packageRoot, 'dist', name)).href);

function isolatedEnv(output, label) {
  const root = join(output, label);
  return {
    PATH: `${dirname(node)}:/usr/bin:/bin`, LANG: 'C.UTF-8',
    HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'),
    OPENCLAW_HOME: join(root, 'home'), OPENCLAW_STATE_DIR: join(root, 'state'),
    OPENCLAW_CONFIG_PATH: join(root, 'state/openclaw.json'),
    OPENCLAW_NO_AUTO_UPDATE: '1', OPENCLAW_NO_RESPAWN: '1',
    OPENCLAW_SKIP_CHANNELS: '1', OPENCLAW_DISABLE_BONJOUR: '1',
    OPENCLAW_EXEC_SHELL_SNAPSHOT: '0',
  };
}

async function verifyRuntime() {
  assert.equal(process.versions.node, '24.16.0', 'Use node_modules/node/bin/node.');
  assert.equal(JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version, '2026.9.9');
  for (const [name, expected] of Object.entries(contracts))
    assert.equal(hash(await readFile(join(packageRoot, 'dist', name))), expected, `Unverified native contract: ${name}`);
}

async function setup(output, label, skipBootstrap = false) {
  const env = isolatedEnv(output, label);
  for (const path of [env.HOME, env.TMPDIR, env.OPENCLAW_STATE_DIR]) await mkdir(path, { recursive: true, mode: 0o700 });
  const workspace = join(output, label, 'workspace');
  // --baseline is essential: ordinary setup may select a system-agent turn.
  const args = [join(packageRoot, 'openclaw.mjs'), 'setup', '--baseline', '--workspace', workspace, '--json'];
  if (skipBootstrap) args.push('--skip-bootstrap');
  const { stdout } = await exec(node, args, { env, cwd: foundation, timeout: 90000, maxBuffer: 1000000 });
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(resolve(result.workspaceDir), workspace);
  return { workspace, config: JSON.parse(await readFile(env.OPENCLAW_CONFIG_PATH, 'utf8')) };
}

/** Only called in the isolated child; private native imports stay diagnostic-only. */
export async function capture(outputArg) {
  await verifyRuntime();
  const output = resolve(outputArg);
  await mkdir(dirname(output), { recursive: true });
  // Exclusive creation rejects empty/reused directories as well as aliases.
  await mkdir(output, { mode: 0o700 });
  const seeded = await setup(output, 'seeded');
  const initial = Object.fromEntries(await Promise.all(filenames.map(async name => [name, await readFile(join(seeded.workspace, name), 'utf8')])));
  const frontmatter = await native('frontmatter-Bibn4xoJ.mjs');
  const officialMatches = {};
  for (const name of filenames) {
    const source = await readFile(join(packageRoot, 'docs/reference/templates', name), 'utf8');
    const expected = frontmatter.u(source)?.body.replace(/^\s+/, '') ?? source;
    officialMatches[name] = initial[name] === expected;
    assert.equal(officialMatches[name], true, `${name} must come from the actual bundled template body`);
  }
  await setup(output, 'seeded');
  const repeated = Object.fromEntries(await Promise.all(filenames.map(async name => [name, await readFile(join(seeded.workspace, name), 'utf8')])));
  const repeatPreserved = filenames.every(name => repeated[name] === initial[name]);
  assert.equal(repeatPreserved, true, 'Repeated baseline setup changed a template');

  const bootstrap = await native('bootstrap-files-CgqY-7GK.mjs');
  const workspaceModule = await native('workspace-C0LMBmap.mjs');
  const routingModule = await native('openclaw-tools-DIUCugPR.mjs');
  const promptModule = await native('system-prompt-params-BxQn8CFS.mjs');
  const budget = await native('bootstrap-budget-CqFoeR-L.mjs');
  const projectContext = await native('watched-sessions-prompt-5dt_UXy3.mjs');

  async function prepare(caseData, limits) {
    const config = limits ? { ...caseData.config, agents: { ...caseData.config.agents, defaults: { ...caseData.config.agents?.defaults, ...limits } } } : caseData.config;
    const params = { workspaceDir: caseData.workspace, config, agentId: 'main', sessionKey: 'agent:main:bootstrap-check' };
    const files = await bootstrap.s(params);
    const resolvedContext = bootstrap.n(files, params);
    const routing = await routingModule.p({
      isWorkspaceBootstrapPending: workspaceModule.i, bootstrapFiles: files,
      bootstrapFilesProvideAccess: false, bootstrapContextRunKind: 'default',
      trigger: 'manual', isPrimaryRun: true, isCanonicalWorkspace: true,
      effectiveWorkspace: caseData.workspace, resolvedWorkspace: caseData.workspace,
      hasBootstrapFileAccess: true,
    });
    // Mirror the final native preparation filter, not merely the renderer mode.
    const contextFiles = routing.includeBootstrapInSystemContext ? resolvedContext : resolvedContext.filter(file => !/(^|[\\/])BOOTSTRAP\.md$/iu.test(file.path.trim()));
    const statsFiles = routing.includeBootstrapInSystemContext ? files : files.filter(file => file.name !== 'BOOTSTRAP.md');
    const prompt = promptModule.i({
      config, agentId: 'main', workspaceDir: caseData.workspace,
      contextFiles, bootstrapMode: routing.bootstrapMode, toolNames: ['read'],
      runtimeInfo: { agentId: 'main', sessionKey: params.sessionKey },
    });
    const injected = budget.r({ bootstrapFiles: statsFiles, injectedFiles: contextFiles });
    const prepared = projectContext.o(contextFiles);
    const rows = filenames.map(name => {
      const raw = files.find(file => file.name === name);
      const item = prepared.find(item => item.path === join(caseData.workspace, name));
      const renderedContent = item ? projectContext.i([item]).at(-2) : '';
      const stats = injected.find(file => file.name === name);
      return {
        name, missing: raw?.missing ?? true, rawChars: stats?.rawChars ?? 0,
        injectedChars: stats?.injectedChars ?? 0, truncated: stats?.truncated ?? false,
        rawSha256: raw?.missing ? null : hash(raw?.content ?? ''),
        renderedSha256: renderedContent ? hash(renderedContent) : null,
        actualTemplateInPrompt: Boolean(raw && !raw.missing && renderedContent && prompt.includes(renderedContent)),
        placeholderInContext: Boolean(item?.file.content.startsWith('[MISSING]')),
      };
    });
    return { routing, files: rows, promptSha256: hash(prompt), promptChars: prompt.length,
      contextChars: contextFiles.reduce((sum, file) => sum + file.content.length, 0) };
  }

  const positive = await prepare(seeded);
  assert.equal(positive.routing.bootstrapMode, 'full');
  assert(positive.files.every(file => !file.missing && file.actualTemplateInPrompt && file.injectedChars > 0 && !file.placeholderInContext));
  const limited = await prepare(seeded, { bootstrapMaxChars: 128, bootstrapTotalMaxChars: 512 });
  assert(limited.contextChars <= 512);
  assert(limited.files.some(file => !file.missing && file.truncated));
  for (const name of filenames) assert.equal(hash(await readFile(join(seeded.workspace, name))), hash(initial[name]));
  const skipped = await setup(output, 'skipped', true);
  const negative = await prepare(skipped);
  assert.equal(negative.routing.bootstrapMode, 'none');
  assert(negative.files.every(file => file.missing && !file.actualTemplateInPrompt));
  assert(negative.files.some(file => file.placeholderInContext));
  assert.equal(negative.files.find(file => file.name === 'BOOTSTRAP.md').injectedChars, 0);
  const receipt = {
    kind: 'native-bootstrap-preparation', runtime: { node: process.versions.node, openclaw: '2026.9.9' },
    contractsVerified: true, sourceContracts: contracts,
    officialTemplateBodiesMatch: officialMatches, repeatSetupPreserved: repeatPreserved,
    positive, limited, skipped: negative,
    modelCalls: 0, gatewayStarted: false, modelResponseVerified: false, bootstrapWorkflowCompleted: false,
    scope: 'Official template creation and native prepared-context injection only; no model response or completed bootstrap workflow.',
  };
  await writeFile(join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return receipt;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output-dir') throw new Error('Usage: node_modules/node/bin/node examples/bootstrap_context.mjs --output-dir NEW_DIRECTORY');
  await verifyRuntime();
  const output = resolve(args[1]);
  const program = `import { capture } from ${JSON.stringify(import.meta.url)}; const receipt=await capture(${JSON.stringify(output)}); console.log(JSON.stringify({kind:receipt.kind,receipt:${JSON.stringify(join(output, 'receipt.json'))},templates:receipt.positive.files.length,modelCalls:receipt.modelCalls}));`;
  const { stdout } = await exec(node, ['--input-type=module', '--eval', program], {
    env: isolatedEnv(output, 'seeded'), cwd: foundation, timeout: 240000, maxBuffer: 1000000,
  });
  process.stdout.write(stdout);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main().catch(error => { process.stderr.write(`Bootstrap context diagnostic failed: ${error.message}\n`); process.exitCode = 1; });

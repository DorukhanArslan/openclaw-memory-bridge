// Offline diagnostic: real pinned Diary/scope/resource code; fixture completion only.
// This is neither model acceptance nor reproduction of the original paid run.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [foundationArg, outputArg, queueFlag] = process.argv.slice(2);
assert(foundationArg && outputArg, 'Usage: node offline-lifecycle.mjs FOUNDATION OUTPUT');
assert(queueFlag === undefined || queueFlag === '--background-queue');
const foundation = resolve(foundationArg), output = resolve(outputArg);
// A rerun needs a new directory; retain prior logs, Diary files and state unchanged.
await mkdir(output);
process.env.OPENCLAW_STATE_DIR = `${output}/private-state`;
process.env.OPENCLAW_CONFIG_PATH = `${output}/private-config.json`;
const files = {
  scope: 'node_modules/openclaw/dist/async-work-scope-BYeX3gh6.mjs',
  resources: 'node_modules/openclaw/dist/async-work-resources-Dpudqxo5.mjs',
  diary: 'node_modules/openclaw/dist/dreaming-narrative-B8Hp3Mc_.mjs',
  state: 'node_modules/openclaw/dist/dreaming-state-VYUvbU-n.mjs',
  store: 'node_modules/openclaw/dist/plugin-state-store-BPUaLoVD.mjs',
  queue: 'node_modules/openclaw/dist/background-work-DsUCV0EB.mjs',
  commandQueue: 'node_modules/openclaw/dist/command-queue-fmu8Xs-B.mjs',
};
const { t: Scope, i: scopeActiveHere } = await import(pathToFileURL(`${foundation}/${files.scope}`));
const { t: resources } = await import(pathToFileURL(`${foundation}/${files.resources}`));
const { n: diary } = await import(pathToFileURL(`${foundation}/${files.diary}`));
const { p: configureState } = await import(pathToFileURL(`${foundation}/${files.state}`));
const { r: openStore, u: closeStore } = await import(pathToFileURL(`${foundation}/${files.store}`));
// Match memory-core's real host store binding; use a new private native SQLite state.
configureState(options => openStore('memory-core', options));
const background = queueFlag ? (await import(pathToFileURL(`${foundation}/${files.queue}`)))
  .t({ owner: 'plugin:memory-core', maxConcurrent: 3 }) : undefined;
const hash = value => createHash('sha256').update(value).digest('hex');
const deferred = () => {
  let resolvePromise;
  const promise = new Promise(resolve => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
};
const modes = ['open-before-drain', 'closed-before-resources', 'closing-with-owned-anchor',
  'resources-before-drain', 'awaited-not-detached', 'outside-scope'];
const runs = [];
for (let repeat = 0; repeat < 3; repeat++) for (const mode of modes) {
  const owner = new Scope(), gate = deferred(), entered = deferred(), done = deferred();
  const resourceEntered = deferred();
  const anchorGate = deferred(), events = [], messages = [];
  const workspaceDir = `${output}/${repeat}-${mode}`;
  await mkdir(workspaceDir, { recursive: true });
  let calls = 0, completionRequest, draining, anchor;
  const event = kind => events.push({ kind, phase: owner.phase, pending: owner.pending.size,
    aborted: owner.signal.aborted, inspectedScopeActiveHere: scopeActiveHere(owner) });
  const logger = {
    warn: message => {
      messages.push(message);
      if (message.includes('narrative fallback failed')) {
        console.error(message); done.resolve();
      }
    },
    info: message => {
      messages.push(message);
      if (/dream diary entry written|narrative generation used fallback/.test(message)) done.resolve();
    },
  };
  const params = {
    agentId: 'synthetic-offline', detached: mode !== 'awaited-not-detached',
    workspaceDir, nowMs: 1792279854157, timezone: 'UTC', logger,
    data: { phase: 'deep', snippets: ['Synthetic Vega uses cobalt filters.'] },
    subagent: { complete: async request => {
      completionRequest = request;
      event('completion-adapter-enter'); entered.resolve();
      if (mode !== 'resources-before-drain') await gate.promise;
      event('before-native-resource-tracker');
      const run = () => resources(async () => {
        event('native-resource-body');
        resourceEntered.resolve();
        if (mode === 'resources-before-drain') await gate.promise;
        calls++;
        return { text: 'Offline fixture completion. Synthetic Vega uses cobalt filters.' };
      });
      return await (background ? background.enqueue(run) : run());
    } },
  };
  if (mode === 'closing-with-owned-anchor') anchor = owner.track(() => anchorGate.promise);
  if (mode === 'outside-scope') await owner.drain();
  const result = mode === 'outside-scope' ? diary(params)
    : mode === 'awaited-not-detached' ? owner.track(() => diary(params))
    : owner.run(() => diary(params));
  await entered.promise;
  if (mode === 'resources-before-drain') await resourceEntered.promise;
  event('adapter-waiting');
  if (mode === 'closed-before-resources') {
    await owner.drain(); event('drain-finished');
  } else if (['closing-with-owned-anchor', 'resources-before-drain', 'awaited-not-detached'].includes(mode)) {
    draining = owner.drain(); event('drain-started');
    assert.equal(owner.phase, 'closing');
  }
  gate.resolve();
  let timer;
  try {
    await Promise.race([done.promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Diary did not finish: ${mode}`)), 15000);
    })]);
  } finally { clearTimeout(timer); }
  anchorGate.resolve(); await anchor; await draining;
  const returned = await result;
  if (owner.phase !== 'closed') await owner.drain();
  event('final');
  const text = await readFile(`${workspaceDir}/DREAMS.md`, 'utf8');
  const closed = mode === 'closed-before-resources';
  assert.equal(calls, closed ? 0 : 1);
  assert.equal(messages.some(message => message.includes('Async work scope is closed')), closed);
  assert.equal(text.includes('A memory trace surfaced, but details were unavailable in this run.'), closed);
  assert.equal(text.includes('Offline fixture completion.'), !closed);
  assert.equal(returned.status, mode === 'awaited-not-detached' ? 'completed' : 'pending');
  assert.equal(events.find(item => item.kind === 'before-native-resource-tracker')
    .inspectedScopeActiveHere, mode !== 'outside-scope');
  runs.push({ repeat, mode, returned, completionRequestSha256: hash(JSON.stringify(completionRequest)),
    nativeCompletionBodyCalls: calls, diary: closed ? 'native fallback' : 'fixture text via native publication',
    events, messages, diarySha256: hash(text) });
}
assert.equal(new Set(runs.map(run => run.completionRequestSha256)).size, 1);
const receipt = {
  kind: 'offline native lifecycle diagnostic with a fixture completion adapter',
  harnessSha256: hash(await readFile(new URL(import.meta.url))),
  nativeBackgroundQueue: Boolean(background),
  originalPaidFailureReproduced: false, modelCalls: 0, providerCalls: 0,
  actualNativeFunctions: ['runDreamNarrative', 'runWithAsyncWorkResources', 'AsyncWorkScope',
    'appendNarrativeEntry', 'configureMemoryCoreDreamingState', 'createPluginStateKeyedStore'],
  matchingCompletionPayloads: true, runs,
  sourceHashes: Object.fromEntries(await Promise.all(Object.values(files).map(async file =>
    [file, hash(await readFile(`${foundation}/${file}`))]))),
  conclusion: 'A detached Diary can inherit an owner that closes before native resource registration. The same error occurs offline without any budget gate. Closing-but-not-closed accepts work; prior resource registration or awaiting keeps ownership alive in these controls. This establishes a possible mechanism, not the cause of the original paid failure or an SDK-specific defect.',
  limits: ['Completion and its delay are fixtures, not native model execution.',
    'No Gateway authorization, full embedded generation, native cron sweep or SDK transport is run here.',
    'The fixture ignores cancellation; successful closing-phase controls do not prove a real provider would succeed.',
    'No production runtime or scope policy was changed.'],
};
await writeFile(`${output}/receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);
await closeStore();
console.log(JSON.stringify({ runs: runs.length, matchingCompletionPayloads: true,
  closedOwnerFallbacks: runs.filter(run => run.nativeCompletionBodyCalls === 0).length,
  modelCalls: 0, output: `${output}/receipt.json` }));

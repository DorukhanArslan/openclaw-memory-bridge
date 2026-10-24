// No model or memory calls: compare real scope primitive semantics before using observers.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const [foundation,caseRoot]=process.argv.slice(2);
writeFileSync(`${caseRoot}/current-run.json`,JSON.stringify({run:'unit'}));
await import(pathToFileURL(`${caseRoot}/runtime/src/scope-observer.mjs`));
const original=await import(pathToFileURL(`${foundation}/node_modules/openclaw/dist/async-work-scope-BYeX3gh6.mjs`));
const observed=await import(pathToFileURL(`${caseRoot}/runtime/node_modules/openclaw/dist/async-work-scope-BYeX3gh6.mjs`));
const outcomes=[];
for(const source of [original,observed]) {
 const scope=new source.t();
 const result={run:scope.run(()=>42),track:await scope.track(async()=>23)};
 await scope.drain();
 try{scope.run(()=>99);}catch(error){result.runError={type:error.name,message:error.message};}
 try{await scope.track(async()=>99);}catch(error){result.trackError={type:error.name,message:error.message};}
 outcomes.push(result);
}
assert.deepEqual(outcomes[0],outcomes[1]);
const events=readFileSync(`${caseRoot}/scope-events.jsonl`,'utf8').trim().split('\n').map(JSON.parse);
assert(events.some(e=>e.kind==='reject-run' && e.exceptionStack?.startsWith('Error: Async work scope is closed')));
assert(events.some(e=>e.kind==='reject-track' && e.exceptionStack?.startsWith('Error: Async work scope is closed')));
assert(events.some(e=>e.kind==='closed'));
const result={primitiveSemanticsEqual:true,actualRejectionStacksCaptured:true,scopeCreateAndCloseCaptured:true,modelCalls:0,outcomes};
writeFileSync(`${caseRoot}/observer-check.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify(result));

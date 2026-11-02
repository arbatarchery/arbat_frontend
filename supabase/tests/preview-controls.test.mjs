import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {install}=createRequire(import.meta.url)('../scripts/preview-controls.cjs');
const id='a0000000-0000-4000-8000-000000000001';
function setup({remoteArrows=['a','b'],pending=0,changed=false}={}){
 const requests=[],events=[];let reads=0;
 const window={ArbatTrainingSyncConfig:{url:'https://test.supabase.co',publishableKey:'public-only'},location:{href:'http://localhost:8000/entrenamiento/'},Event,
  dispatchEvent:e=>events.push(e.type),fetch:async(url,options)=>{requests.push({url,options});return Response.json(url.includes('training_sessions')?[{id,revision:3}]:remoteArrows.map(id=>({id})));},
  ArbatTrainingSync:{settled:async()=>{},lastStatus:{pending,state:'synced'},store:{recoverCurrent:async()=>({id,confirmedRevision:3,fingerprint:changed&&++reads>1?'new':'old',projection:{arrows:[{id:'a'},{id:'b'}]}})},
  engine:{identity:async()=>({supabaseToken:'test-user-token',accountKey:null})}}};
 return {window,requests,events,api:install(window)};
}
test('preview pause blocks only Supabase requests and resume wakes the engine',async()=>{
 const {window,requests,events,api}=setup();api.setOffline(true);
 await assert.rejects(window.fetch('https://test.supabase.co/functions/v1/training-sync'),/preview_offline/);assert.equal(requests.length,0);
 await window.fetch('http://localhost:8000/entrenamiento/js/sync-ui.js');assert.equal(requests.length,1);
 api.setOffline(false);await window.fetch('https://test.supabase.co/rest/v1/training_sessions');assert.deepEqual(events,['offline','online']);assert.equal(requests.length,2);
});
test('verification reads the real row revision and exact arrow UUID set without exposing tokens',async()=>{
 const {requests,api}=setup();const result=await api.verify();assert.deepEqual(result,{arrows:2,revision:3});assert.equal(requests.length,2);
 assert.ok(requests.every(r=>r.options.method==='GET'));assert.ok(requests.every(r=>r.options.headers.apikey==='public-only'));
 assert.ok(!JSON.stringify(result).includes('test-user-token'));
});
test('verification cannot pass while pending, offline or mismatched',async()=>{
 const pending=setup({pending:1});await assert.rejects(pending.api.verify(),/barra esté verde/);assert.equal(pending.requests.length,0);
 const offline=setup();offline.api.setOffline(true);await assert.rejects(offline.api.verify(),/Restaura/);assert.equal(offline.requests.length,0);
 await assert.rejects(setup({remoteArrows:['a','b','unexpected']}).api.verify(),/no coincide/);
 await assert.rejects(setup({changed:true}).api.verify(),/cambiaron/);
});

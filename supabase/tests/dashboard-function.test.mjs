import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import vm from 'node:vm';
const code=await readFile(new URL('../setup/training-sync-dashboard.ts',import.meta.url),'utf8');
function load(values={},fetchImpl=()=>assert.fail('must not request')){
 let handler;const context={Deno:{env:{get:key=>values[key]},serve:fn=>{handler=fn;}},fetch:fetchImpl,Request,Response,AbortSignal,AbortController,TextEncoder,TextDecoder,crypto:globalThis.crypto,setTimeout,clearTimeout};
 vm.runInNewContext(code,context);assert.equal(typeof handler,'function');return handler;
}
const request=headers=>new Request('https://test.supabase.co/functions/v1/training-sync',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:8000',...headers},body:JSON.stringify({schema_version:1,action:'claim'})});
test('single-file dashboard artifact contains no imports and stays disabled without configuration',async()=>{
 assert.ok(!/^import /m.test(code));assert.ok(!code.includes('sb_secret_'));const handler=load();const response=await handler(request());
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'sync_disabled'});
});
test('configured dashboard artifact still requires a Supabase user token',async()=>{
 const handler=load({SUPABASE_URL:'https://test.supabase.co',TRAINING_PUBLIC_KEY:'public-test',TRAINING_SERVER_KEY:'server-test',TRAINING_ALLOWED_ORIGINS:'http://localhost:8000',TRAINING_SYNC_ENABLED:'true'});
 const response=await handler(request());assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:'supabase_session_required'});
});
test('dashboard artifact rejects an invalid user token before invoking SQL or Buddy',async()=>{
 let requests=0;const handler=load({SUPABASE_URL:'https://test.supabase.co',TRAINING_PUBLIC_KEY:'public-test',TRAINING_SERVER_KEY:'server-test',TRAINING_ALLOWED_ORIGINS:'http://localhost:8000',TRAINING_SYNC_ENABLED:'true'},async url=>{
  requests++;assert.equal(url,'https://test.supabase.co/auth/v1/user');return Response.json({error:'invalid_token'},{status:401});
 });
 const response=await handler(request({Authorization:'Bearer test-token'}));assert.equal(response.status,401);assert.equal(requests,1);
});

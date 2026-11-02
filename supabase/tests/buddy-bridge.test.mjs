import {test} from 'node:test';import assert from 'node:assert/strict';
import {createTrainingHandler} from '../functions/_shared/training-handler.mjs';
const publicKey='sb_publishable_test',serverKey='sb_secret_test',origin='http://localhost:8000',id='20000000-0000-4000-8000-000000000001';
const request=(action='buddy.session',extra={})=>new Request('https://example.supabase.co/functions/v1/training-sync',{method:'POST',headers:{origin,'Content-Type':'application/json',Authorization:`Bearer ${publicKey}`,'x-buddy-access-token':'buddy-token'},body:JSON.stringify({schema_version:1,action,...extra})});
const make=fetchImpl=>createTrainingHandler({url:'https://example.supabase.co',publicKey,serverKey,allowedOrigins:[origin],enabled:true,fetchImpl});
test('Buddy-only requests resolve server ownership after live verification; never accept a caller ID',async()=>{
 const calls=[];const handler=make(async(url,init)=>{
  calls.push(url);if(url.includes('api.statetty.com'))return Response.json({ok:true,authenticated:true,user:{id:'A'}});
  assert.equal(init.headers.apikey,serverKey);
  if(url.endsWith('training_buddy_lookup')){assert.deepEqual(JSON.parse(init.body),{p_subject:'A'});return Response.json({status:'accepted',principal_id:id});}
  if(url.endsWith('training_history_context'))return Response.json({status:'accepted',role:'user'});
  assert.ok(url.endsWith('training_claim'));assert.equal(JSON.parse(init.body).p_principal,id);return Response.json({status:'accepted',owner_id:id});
 });
 const r=await handler(request());assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'accepted',principal_id:id,subject:'A'});
 assert.equal(calls.length,2);assert.equal((await handler(request('buddy.session',{principal_id:id}))).status,400);
 assert.equal((await handler(request('claim'))).status,200);
});
test('invalid Buddy never reaches Auth admin or database, even with the public key',async()=>{
 let calls=0;const handler=make(async url=>{calls++;assert.ok(url.includes('api.statetty.com'));return Response.json({ok:true,authenticated:false});});
 assert.equal((await handler(request())).status,401);assert.equal(calls,1);
});
test('first verified Buddy creates one deterministic server principal without minting tokens or sending email',async()=>{
 let created,claimed=false;const handler=make(async(url,init)=>{
  if(url.includes('api.statetty.com'))return Response.json({ok:true,authenticated:true,user:{id:'new-Buddy'}});
  assert.equal(init.headers.apikey,serverKey);
  if(url.endsWith('training_buddy_lookup'))return Response.json({status:'accepted',principal_id:claimed?created.id:null});
  if(url.includes('/admin/users/'))return Response.json({error:'not found'},{status:404});
  if(url.endsWith('/admin/users')){created=JSON.parse(init.body);assert.equal(created.email_confirm,true);assert.match(created.email,/@buddy\.arbat\.invalid$/);return Response.json(created);}
  if(url.endsWith('training_history_context'))return Response.json({status:'accepted',role:'user'});
  assert.ok(url.endsWith('training_claim'));assert.equal(JSON.parse(init.body).p_principal,created.id);claimed=true;return Response.json({status:'accepted',owner_id:created.id});
 });
 const response=await handler(request());assert.equal(response.status,200);const text=await response.text();assert.ok(!text.includes('password'));assert.ok(!text.includes('access_token'));assert.ok(!text.includes(serverKey));
});
test('a pre-existing deterministic user with the wrong server marker is never adopted',async()=>{
 const handler=make(async url=>{
  if(url.includes('api.statetty.com'))return Response.json({ok:true,authenticated:true,user:{id:'A'}});
  if(url.endsWith('training_buddy_lookup'))return Response.json({status:'accepted',principal_id:null});
  if(url.includes('/admin/users/'))return Response.json({id:url.split('/').at(-1),app_metadata:{arbat_buddy_bridge:'wrong'}});
  assert.fail('must not claim');
 });assert.equal((await handler(request())).status,503);
});
test('a concurrent anonymous claim keeps its canonical owner instead of transferring a permanent bridge account',async()=>{
 let reads=0,created;const handler=make(async(url,init)=>{
  if(url.includes('api.statetty.com'))return Response.json({ok:true,authenticated:true,user:{id:'racing-Buddy'}});
  if(url.endsWith('training_buddy_lookup'))return Response.json({status:'accepted',principal_id:++reads===1?null:id});
  if(url.includes('/admin/users/'))return Response.json({error:'not found'},{status:404});
  if(url.endsWith('/admin/users')){created=JSON.parse(init.body);return Response.json(created);}
  if(url.endsWith('training_history_context'))return Response.json({status:'accepted',role:'user'});
  assert.ok(url.endsWith('training_claim'));return Response.json({code:'28000',message:'source_not_anonymous'},{status:400});
 });const response=await handler(request());assert.equal(response.status,200);assert.equal((await response.json()).principal_id,id);assert.notEqual(created.id,id);
});

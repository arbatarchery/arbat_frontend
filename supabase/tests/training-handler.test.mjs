import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTrainingHandler} from '../functions/_shared/training-handler.mjs';
const id='20000000-0000-4000-8000-000000000001';
const origin='https://arbatarchery.com';
const token='supabase.user.token', buddy='buddy.access.token', secret='sb_secret_test_server_only';
const operation={operation_id:id,session_id:id,entity_id:id,kind:'session.upsert',base_revision:0,payload:{local_date:'2026-11-01'}};
const sync={schema_version:1,action:'sync',operations:[operation]};
const calls=[];
const auth=()=>Response.json({id,is_anonymous:true});
const make=(fetchImpl,options={})=>createTrainingHandler({url:'https://example.supabase.co',publicKey:'sb_publishable_test',serverKey:secret,
 allowedOrigins:[origin],enabled:true,fetchImpl,...options});
const request=(body=sync,headers={},method='POST')=>new Request('https://example.supabase.co/functions/v1/training-sync',{
 method,headers:{origin,'Content-Type':'application/json',Authorization:`Bearer ${token}`,...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
const result=async response=>({status:response.status,body:await response.json()});

test('disabled handler and denied origins never call upstream services',async()=>{
 const fetchImpl=async()=>assert.fail('must not request');
 assert.equal((await make(fetchImpl,{enabled:false})(request())).status,503);
 assert.equal((await make(fetchImpl)(request(sync,{origin:'https://attacker.test'}))).status,403);
 assert.equal((await make(fetchImpl)(request(sync,{origin:''}))).status,403);
});
test('CORS preflight is explicit and does not require credentials',async()=>{
 const response=await make(async()=>assert.fail('must not request'))(request(undefined,{},'OPTIONS'));
 assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),origin);
 assert.ok(!response.headers.get('access-control-allow-origin').includes('*'));
});
test('invalid schema, impersonation fields, giant bodies and batches are rejected before auth',async()=>{
 const handler=make(async()=>assert.fail('must not request'));
 for(const body of [null,{}, {...sync,owner_id:id},{...sync,operations:[]},{...sync,operations:Array(33).fill(operation)},
  {...sync,operations:[{...operation,base_revision:1.5}]},{...sync,operations:[{...operation,entity_id:'date'}]},
  {...sync,operations:[{...operation,payload:{notes:'x'.repeat(40000)}}]}]) assert.equal((await handler(request(body))).status,400);
 assert.equal((await handler(request({...sync,padding:'x'.repeat(140000)}))).status,413);
 assert.equal((await handler(request(sync,{'Content-Type':'text/plain'}))).status,415);
 assert.equal((await handler(request(sync,{Authorization:''}))).status,401);
});
test('only Auth-verified id reaches server RPC, never client supplied roles or owner',async()=>{
 calls.length=0;
 const handler=make(async(url,init)=>{
  calls.push({url,init});
  if(url.endsWith('/auth/v1/user')){
   assert.equal(init.headers.Authorization,`Bearer ${token}`);return auth();
  }
  assert.ok(url.endsWith('/rpc/training_apply_operation'));
  assert.equal(init.headers.apikey,secret);assert.equal(init.headers.Authorization,undefined);
  const body=JSON.parse(init.body);assert.equal(body.p_principal,id);assert.equal(body.p_buddy_subject,null);
  return Response.json({status:'accepted',revision:1,replayed:false});
 });
 const r=await handler(request());assert.equal(r.status,200);
 const text=await r.text();for(const value of [secret,token,buddy])assert.ok(!text.includes(value));
 assert.equal(calls.length,2);
});
test('a public key or unverified JWT cannot act as a user',async()=>{
 let count=0;
 const handler=make(async()=>{count++;return Response.json({error:'invalid token'},{status:401});});
 assert.equal((await handler(request())).status,401);assert.equal(count,1);
});
test('claim requires both live sessions; ignores roles returned by Buddy',async()=>{
 const handler=make(async(url,init)=>{
  if(url.endsWith('/auth/v1/user'))return auth();
  if(url==='https://api.statetty.com/api/buddy/auth/session')return Response.json({ok:true,authenticated:true,user:{id:'buddy-verified',role:'superadmin'}});
  if(url.endsWith('/rpc/training_history_context'))return Response.json({status:'accepted',role:'user'});
  assert.ok(url.endsWith('/rpc/training_claim'));
  const body=JSON.parse(init.body);assert.equal(body.p_principal,id);assert.equal(body.p_buddy_subject,'buddy-verified');
  assert.match(body.p_proof_hash,/^[a-f0-9]{64}$/);assert.equal(Object.keys(body).length,3);
  return Response.json({status:'accepted',owner_id:id,sessions_claimed:2,replayed:false});
 });
 assert.equal((await handler(request({schema_version:1,action:'claim'}))).status,401);
 const r=await result(await handler(request({schema_version:1,action:'claim'},{'x-buddy-access-token':buddy})));
 assert.equal(r.status,200);assert.equal(r.body.sessions_claimed,2);
});
test('Buddy outage/unauthenticated response never reaches claim RPC',async()=>{
 for(const fetchBuddy of [async()=>{throw new Error(buddy);},async()=>Response.json({ok:true,authenticated:false})]){
  const handler=make(async url=>{if(url.endsWith('/auth/v1/user'))return auth();if(url.includes('api.statetty.com'))return fetchBuddy();assert.fail('must not call RPC');});
  const r=await handler(request({schema_version:1,action:'claim'},{'x-buddy-access-token':buddy}));
  assert.equal(r.status,401);assert.ok(!(await r.text()).includes(buddy));
 }
});
test('a batch verifies Auth once and uses one database RPC while preserving partial ACKs',async()=>{
 let authCalls=0,dbCalls=0;
 const operations=[operation,{...operation,operation_id:id.replace(/1$/,'2')},{...operation,operation_id:id.replace(/1$/,'3')}];
 const handler=make(async(url,init)=>{
  if(url.endsWith('/auth/v1/user')){authCalls++;return auth();}
  dbCalls++;assert.ok(url.endsWith('/rpc/training_apply_batch'));const args=JSON.parse(init.body);
  assert.deepEqual(args.p_operations,operations);assert.equal(args.p_principal,id);assert.equal(args.p_buddy_subject,null);
  return Response.json({results:operations.map((op,i)=>({operation_id:op.operation_id,status:['accepted','conflict','not_attempted'][i],revision:i?4:1}))});
 });
 const r=await result(await handler(request({...sync,operations})));
 assert.deepEqual(r.body.results.map(x=>x.status),['accepted','conflict','not_attempted']);assert.equal(authCalls,1);assert.equal(dbCalls,1);
});
test('batch RPC failures are sanitized without claiming that anything was confirmed',async()=>{
 const handler=make(async url=>url.endsWith('/auth/v1/user')?auth():Response.json({code:'42501',message:`private details ${secret}`},{status:403}));
 const r=await result(await handler(request({...sync,operations:[operation,{...operation,operation_id:id.replace(/1$/,'2')}]})));
 assert.deepEqual(r,{status:403,body:{error:'not_owner'}});assert.ok(!JSON.stringify(r).includes(secret));
});
test('cross-session batches and malformed batch replies are rejected',async()=>{
 const handler=make(async url=>url.endsWith('/auth/v1/user')?auth():Response.json({results:[]}));
 assert.equal((await handler(request({...sync,operations:[operation,{...operation,session_id:id.replace(/1$/,'2')}]}))).status,400);
 assert.equal((await handler(request({...sync,operations:[operation,operation]}))).status,503);
});
test('rate limits returned by claim use 429 and Retry-After',async()=>{
 const handler=make(async url=>url.endsWith('/auth/v1/user')?auth():url.includes('api.statetty.com')?
  Response.json({ok:true,authenticated:true,user:{id:'buddy-verified'}}):Response.json({status:'rate_limited'}));
 const r=await handler(request({schema_version:1,action:'claim'},{'x-buddy-access-token':buddy}));
 assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');
});
test('network failure is retryable and does not leak credentials',async()=>{
 const handler=make(async()=>{throw new Error(secret);});
 const r=await result(await handler(request()));assert.deepEqual(r,{status:503,body:{error:'server_unavailable'}});
});

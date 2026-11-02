import {test} from 'node:test';import assert from 'node:assert/strict';import {createTrainingHandler} from '../functions/_shared/training-handler.mjs';
const principal='e0000000-0000-4000-8000-000000000001';
const request=body=>new Request('https://test.supabase.co/functions/v1/training-sync',{method:'POST',headers:{Origin:'http://localhost:8000',Authorization:'Bearer test-user','Content-Type':'application/json','x-buddy-access-token':'test-buddy'},body:JSON.stringify({schema_version:1,...body})});
const create=fetchImpl=>createTrainingHandler({url:'https://test.supabase.co',publicKey:'public-test',serverKey:'secret-test',enabled:true,allowedOrigins:['http://localhost:8000'],fetchImpl});
test('history request derives actor and Buddy subject from verified services, not target',async()=>{
 const handler=create(async(url,init)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:principal});
  if(url.includes('api.statetty.com'))return Response.json({ok:true,authenticated:true,user:{id:'verified-subject'}});
  assert.ok(url.endsWith('/rpc/training_history_list'));const args=JSON.parse(init.body);assert.equal(args.p_principal,principal);assert.equal(args.p_buddy_subject,'verified-subject');assert.equal(args.p_target_subject,'student-subject');
  return Response.json({status:'accepted',sessions:[],next_cursor:null});
 });
 const response=await handler(request({action:'history.list',from:'2026-11-01',to:'2026-11-30',target_subject:'student-subject'}));assert.equal(response.status,200);
});
test('history allows bounded large notes while sync replies retain their small limit',async()=>{
 const handler=create(async url=>url.endsWith('/auth/v1/user')?Response.json({id:principal}):url.includes('api.statetty.com')?Response.json({ok:true,authenticated:true,user:{id:'verified'}}):Response.json({status:'accepted',sessions:[{notes:'x'.repeat(20000)}],next_cursor:null}));
 assert.equal((await handler(request({action:'history.list',from:'2026-11-01',to:'2026-11-30'}))).status,200);
});
test('invalid history cursors and unknown owner fields fail before authenticating',async()=>{
 const handler=create(async()=>assert.fail('must not request'));
 for(const body of [{action:'history.list',from:'2026-11-01',to:'2026-11-30',owner_id:principal},{action:'history.detail',session_id:principal,revision:1,collection:'arrows',cursor:'2026-11-01'}])assert.equal((await handler(request(body))).status,400);
});
test('coaching context uses server-verified profile and rejects browser role/email overrides',async()=>{
 const handler=create(async(url,init)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:principal});
  if(url.includes('api.statetty.com'))return Response.json({ok:true,authenticated:true,user:{id:'verified',name:'Raúl',email:'Account@Example.com',roles:['superadmin']}});
  assert.ok(url.endsWith('/rpc/training_history_context'));
  assert.deepEqual(JSON.parse(init.body),{p_principal:principal,p_buddy_subject:'verified',p_display_name:'Raúl',p_verified_email:'account@example.com'});
  return Response.json({status:'accepted',role:'user',can_coach:false});
 });
 assert.equal((await handler(request({action:'history.context'}))).status,200);
 const denied=create(async()=>assert.fail('must reject before authentication'));
 assert.equal((await denied(request({action:'history.context',role:'superadmin',email:'forged@example.com'}))).status,400);
});
test('coaching period and cursor reach the scoped server RPC',async()=>{
 const handler=create(async(url,init)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:principal});
  if(url.includes('api.statetty.com'))return Response.json({ok:true,authenticated:true,user:{id:'verified'}});
  assert.ok(url.endsWith('/rpc/training_coach_overview'));assert.deepEqual(JSON.parse(init.body),{p_principal:principal,p_buddy_subject:'verified',p_from:'2026-11-01',p_to:'2026-11-30',p_after:null,p_scope_hash:null});
  return Response.json({status:'accepted',athletes:[],days:[],arrows:0});
 });
 assert.equal((await handler(request({action:'history.coach',from:'2026-11-01',to:'2026-11-30'}))).status,200);
});

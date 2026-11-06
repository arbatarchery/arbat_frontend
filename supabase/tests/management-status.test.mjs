import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createManagementStatus,normalizeDisk,capacityLevel} from '../functions/_shared/management-status.mjs';
import {createTrainingHandler} from '../functions/_shared/training-handler.mjs';
const ref='qbtdwlcpqcsolubhhkfa',secret='test-management-credential-never-public';
const stamp=Date.now();
const util=(used=20,total=100,at=stamp)=>({timestamp:new Date(at).toISOString(),metrics:{fs_size_bytes:total,fs_used_bytes:used,fs_avail_bytes:total-used}});
function fixture(url){const path=new URL(url).pathname;
 if(path.endsWith('/disk/util'))return util();
 if(path.endsWith('/config/disk'))return {attributes:{size_gb:2}};
 if(path.endsWith('/health'))return ['auth','db','rest','storage','realtime'].map(name=>({name,status:'ACTIVE_HEALTHY',healthy:false,error:secret,info:{description:secret}}));
 if(path.endsWith('/readonly'))return {enabled:false};
 if(path.endsWith('/autoscale'))return {growth_percent:50,min_increment_gb:1,max_size_gb:8};
 if(path.startsWith('/v1/organizations/'))return {plan:'pro',name:'private org'};
 return {status:'ACTIVE_HEALTHY',organization_slug:'private-org',database:{host:'private-db-host'}};
}
test('read-only fixed endpoints, plan and health sanitize raw metadata and coalesce requests',async()=>{
 let count=0;const fetchImpl=async(url,init)=>{count++;assert.ok(url.startsWith('https://api.supabase.com/v1/'));assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,`Bearer ${secret}`);return Response.json(fixture(url));};
 const client=createManagementStatus({token:secret,projectRef:ref,fetchImpl,now:()=>stamp});
 const [a,b]=await Promise.all([client.status(),client.status()]);assert.equal(count,7);assert.deepEqual(a,b);assert.equal(a.plan,'pro');assert.equal(a.disk.percent,20);assert.equal(a.services[0].status,'ok');
 const json=JSON.stringify(a);for(const value of [secret,'private-org','private-db-host','private org'])assert.ok(!json.includes(value));
 assert.equal(a.monthly_metrics_available,false);assert.equal((await client.capacity()).database_near_limit,false);assert.equal(count,7);
});
test('capacity tracks actual changed disk size after cache expiration, not a Free reference',async()=>{
 let clock=stamp,used=96,total=100,calls=0;
 const client=createManagementStatus({token:secret,projectRef:ref,now:()=>clock,fetchImpl:async()=>{calls++;return Response.json(util(used,total,clock));}});
 assert.equal((await client.capacity()).database_near_limit,true);assert.equal(calls,1);
 total=200;clock+=300001;assert.equal((await client.capacity()).database_near_limit,false);assert.equal(calls,2);
});
test('stale, malformed or inaccessible capacity never emits a red notice or guesses a limit',async()=>{
 for(const data of [util(96,100,stamp-3600001),util(-1),util(101),{metrics:{fs_size_bytes:100,fs_used_bytes:null}}])assert.equal(normalizeDisk(data,stamp).status,'unknown');
 for(const value of [79,80,94,95])assert.equal(capacityLevel(value),value>=95?'error':value>=80?'warning':'ok');
 let calls=0;const missing=createManagementStatus({projectRef:ref,fetchImpl:()=>{calls++;}});assert.equal((await missing.capacity()).database_near_limit,null);assert.equal(calls,0);
 for(const status of [401,403,429,500]){const client=createManagementStatus({token:secret,projectRef:ref,fetchImpl:async()=>Response.json({message:secret},{status})});const result=await client.status();assert.equal(result.status,'partial');assert.equal((await client.capacity()).database_near_limit,null);assert.ok(!JSON.stringify(result).includes(secret));}
});
test('service health uses documented status, preserves partial failures and ignores unknown services',async()=>{
 const client=createManagementStatus({token:secret,projectRef:ref,now:()=>stamp,fetchImpl:async url=>Response.json(url.includes('/health?')?[{name:'auth',status:'UNHEALTHY',healthy:true,error:secret},{name:'db',status:'COMING_UP'},{name:'attacker',status:'UNHEALTHY'}]:fixture(url))});
 const result=await client.status();assert.equal(result.services.find(s=>s.name==='auth').status,'error');assert.equal(result.services.find(s=>s.name==='db').status,'warning');assert.equal(result.services.find(s=>s.name==='rest').status,'unknown');assert.ok(!result.services.some(s=>s.name==='attacker'));
});
test('unauthenticated or forged diagnostics cannot trigger management requests',async()=>{
 let requests=0;const handler=createTrainingHandler({url:`https://${ref}.supabase.co`,publicKey:'public',serverKey:'server',enabled:true,allowedOrigins:['https://arbatarchery.com'],managementToken:secret,fetchImpl:()=>{requests++;assert.fail('no request before access validation');}});
 for(const body of [{schema_version:1,action:'system.status',role:'admin'},{schema_version:1,action:'system.status'}]){
 const response=await handler(new Request('https://edge.test',{method:'POST',headers:{Origin:'https://arbatarchery.com','Content-Type':'application/json'},body:JSON.stringify(body)}));assert.equal(response.status,401);
 }assert.equal(requests,0);
});
test('verified user without administrative role still cannot trigger management reads',async()=>{
 const calls=[];
 const handler=createTrainingHandler({url:`https://${ref}.supabase.co`,publicKey:'public',serverKey:'server',enabled:true,allowedOrigins:['https://arbatarchery.com'],managementToken:secret,fetchImpl:async url=>{
  calls.push(url);if(url.endsWith('/auth/v1/user'))return Response.json({id:'f0000000-0000-4000-8000-000000000001'});
  if(url.endsWith('/rpc/training_system_status'))return Response.json({status:'accepted',role:'user'});
  assert.fail('management must not be called for a non-admin');
 }});
 const response=await handler(new Request('https://edge.test',{method:'POST',headers:{Origin:'https://arbatarchery.com',Authorization:'Bearer test-user-jwt','Content-Type':'application/json'},body:JSON.stringify({schema_version:1,action:'system.status'})}));
 assert.equal(response.status,403);assert.equal(calls.length,2);
});

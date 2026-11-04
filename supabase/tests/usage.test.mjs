import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import worker from '../setup/approximate-city-worker.mjs';
import {verifyLocation} from '../functions/_shared/location-proof.mjs';
import {createTrainingHandler} from '../functions/_shared/training-handler.mjs';
const id=n=>`e0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const secret='local-test-only-secret-'.repeat(3),school='a8ba7000-0000-4000-8000-000000000001';
async function proof(n=10){const request=new Request(`https://city.test/?event_id=${id(n)}&browser_id=${id(20)}&event_kind=history_open`,{headers:{Origin:'https://arbatarchery.com','cf-connecting-ip':'198.51.100.5'}});Object.defineProperty(request,'cf',{value:{city:'La Paz',region:'La Paz',country:'BO'}});return (await worker.fetch(request,{TRAINING_LOCATION_SIGNING_SECRET:secret})).json();}
test('Worker signs event-bound city only; Edge verifies before anonymous ingress',async()=>{
 const data=await proof(),payload=await verifyLocation(data.proof,secret);assert.equal(payload.city,'La Paz');assert.equal(payload.event_id,id(10));assert.ok(!JSON.stringify(data).includes('198.51.100.5'));
 await assert.rejects(verifyLocation(data.proof,'wrong-secret'.repeat(4)));await assert.rejects(verifyLocation(data.proof,secret,Date.now()+8*86400000),/expired/);
 let calls=0;
 const handler=createTrainingHandler({enabled:true,url:'https://db.test',publicKey:'public',serverKey:'server',locationSigningSecret:secret,allowedOrigins:['https://arbatarchery.com'],fetchImpl:async(url,init)=>{
  calls++;assert.ok(url.endsWith('/rpc/training_record_usage'));const args=JSON.parse(init.body);assert.equal(args.p_principal,null);assert.equal(args.p_event.city,'La Paz');return Response.json({status:'accepted',event_id:id(10)});
 }});
 const event={event_id:id(10),browser_id:id(20),kind:'history_open',occurred_at:new Date().toISOString(),proof:data.proof};
 const send=e=>handler(new Request('https://edge.test',{method:'POST',headers:{Origin:'https://arbatarchery.com','Content-Type':'application/json',Authorization:'Bearer public'},body:JSON.stringify({schema_version:1,action:'usage.record',event:e})}));
 assert.equal((await send(event)).status,200);assert.equal(calls,1);
 assert.equal((await send({...event,event_id:id(11)})).status,400);assert.equal(calls,1);
 assert.equal((await send({...event,city:'Forged'})).status,400);assert.equal(calls,1);
});
test('usage RPCs enforce roles, idempotency, promotion, scope and end ownership',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean not null);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 for(const f of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL('../migrations/'+f,import.meta.url),'utf8'));
 for(let n=1;n<=3;n++){await db.query('insert into auth.users values($1,true)',[id(n)]);await db.query('select public.training_claim($1,$2,$3)',[id(n),'buddy-'+n,String(n).repeat(64)]);}
 await db.query("insert into arbat_private.role_assignments(user_id,role,school_id) values($1,'admin',$2)",[id(1),school]);
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/La_Paz'}).format(new Date()),stamp=new Date().toISOString();
 const event={event_id:id(100),browser_id:id(200),kind:'history_open',occurred_at:stamp,observed_at:stamp,city:'La Paz',region:'La Paz',country:'BO'};
 const record=(p,subject,e=event)=>db.query('select public.training_record_usage($1,$2,$3,$4) result',[p,subject,e,'a'.repeat(43)]).then(r=>r.rows[0].result);
 const summary=(n=1)=>db.query('select public.training_usage_summary($1,$2,$3,$4) result',[id(n),'buddy-'+n,date,date]).then(r=>r.rows[0].result);
 assert.equal((await summary()).totals.opens,0);
 await record(null,null);await record(null,null);let result=await summary();assert.equal(result.totals.opens,1);assert.equal(result.totals.anonymous_browsers,1);
 await record(id(2),'buddy-2');result=await summary();assert.equal(result.totals.accounts,1);assert.equal(result.totals.anonymous_browsers,0);assert.equal(result.visitors[0].opens,1);
 assert.ok(!Object.hasOwn(result.visitors[0],'owner'));assert.ok(!Object.hasOwn(result.visitors[0],'visitor'));
 await assert.rejects(record(id(3),'buddy-3'),e=>e.code==='42501');await assert.rejects(summary(2),e=>e.code==='42501');
 const end={...event,event_id:id(101),kind:'end_location',session_id:id(300),end_id:id(301)};
 assert.equal((await record(id(2),'buddy-2',end)).status,'session_pending');
 await db.query('insert into public.training_sessions(id,owner_id,started_at) values($1,$2,$3)',[id(300),id(2),stamp]);
 await db.query('insert into public.training_ends(id,session_id,ordinal) values($1,$2,1)',[id(301),id(300)]);
 assert.equal((await record(id(3),'buddy-3',end)).status,'session_pending');assert.equal((await record(id(2),'buddy-2',end)).status,'accepted');
 assert.equal((await summary()).cities[0].ends,1);
 await db.query('insert into public.training_ends(id,session_id,ordinal) values($1,$2,2),($3,$2,3)',[id(302),id(300),id(303)]);
 await record(id(2),'buddy-2',{...end,event_id:id(102),end_id:id(302),city:'Cochabamba'});
 await record(id(2),'buddy-2',{...end,event_id:id(103),end_id:id(303),city:'Santa Cruz',occurred_at:new Date(Date.parse(stamp)-3600000).toISOString()});
 const alert=(await summary()).alerts[0];assert.equal(alert.kind,'within_session');assert.deepEqual(alert.cities_observed,['Cochabamba','La Paz']);assert.ok(!Object.hasOwn(alert,'owner'));

 await db.exec('begin;set local role authenticated');await assert.rejects(db.query('select count(*) from arbat_private.usage_events'),e=>e.code==='42501');await db.exec('rollback');
});

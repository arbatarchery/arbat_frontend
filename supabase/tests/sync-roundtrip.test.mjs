import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {IDBFactory} from 'fake-indexeddb';
import {PGlite} from '@electric-sql/pglite';
import {createTrainingHandler} from '../functions/_shared/training-handler.mjs';
const require=createRequire(import.meta.url),{Store}=require('../../entrenamiento/js/sync-store.js'),{Engine,createTransport}=require('../../entrenamiento/js/sync-engine.js');

test('IndexedDB -> browser transport -> verified Edge handler -> PostgreSQL RPC and back',async t=>{
 const db=new PGlite(),id='60000000-0000-4000-8000-000000000001';t.after(()=>db.close());
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean not null);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 for(const file of ['202611010001_training_foundation.sql','202611010002_training_ingestion.sql','202611010005_training_batches.sql'])await db.exec(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
 await db.query('insert into auth.users values($1,true)',[id]);
 const rpcFetch=async(url,init)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id,is_anonymous:true});
  if(url==='https://api.statetty.com/api/buddy/auth/session')return Response.json({ok:true,authenticated:true,user:{id:'buddy-A'}});
  const args=JSON.parse(init.body);let query,params;
  if(url.endsWith('/rpc/training_apply_operation')){query='select public.training_apply_operation($1,$2,$3::jsonb) result';params=[args.p_principal,args.p_buddy_subject,JSON.stringify(args.p_operation)];}
  else if(url.endsWith('/rpc/training_apply_batch')){query='select public.training_apply_batch($1,$2,$3::jsonb) result';params=[args.p_principal,args.p_buddy_subject,JSON.stringify(args.p_operations)];}
  else if(url.endsWith('/rpc/training_claim')){query='select public.training_claim($1,$2,$3) result';params=[args.p_principal,args.p_buddy_subject,args.p_proof_hash];}
  else assert.fail(`unexpected test URL: ${url}`);
  await db.exec('begin;set local role service_role');
  try{const result=(await db.query(query,params)).rows[0].result;await db.exec('commit');return Response.json(result);}
  catch(e){await db.exec('rollback');return Response.json({code:e.code},{status:400});}
 };
 const url='https://test.supabase.co',origin='https://arbatarchery.com';
 const handler=createTrainingHandler({url,publicKey:'sb_publishable_test',serverKey:'sb_secret_test',enabled:true,allowedOrigins:[origin],fetchImpl:rpcFetch});
 let dropResponse=true,clock=1000,account=null;
 const transport=createTransport({url,publicKey:'sb_publishable_test',enabled:true,fetchImpl:async(url,init)=>{
  const response=await handler(new Request(url,{...init,headers:{...init.headers,origin}}));
  if(dropResponse){dropResponse=false;throw new Error('response lost after PostgreSQL commit');}return response;
 }});
 const store=new Store({indexedDB:new IDBFactory(),now:()=>clock});t.after(()=>store.close());
 const engine=new Engine({store,transport,enabled:true,navigator:{onLine:true},now:()=>clock,setTimer:()=>1,clearTimer(){},
  identityProvider:async()=>({principalId:id,supabaseToken:'test.jwt',accountKey:account,buddyToken:account?'test.buddy':null})});
 const a={label:'9',score:9,x:54,y:50,recordedAt:'2026-11-01T10:00:01Z'},b={label:'8',score:8,x:60,y:50,recordedAt:'2026-11-01T10:00:02Z'};
 const first={id:'legacy-non-uuid',date:'2026-11-01',startedAt:'2026-11-01T10:00:00Z',completed:[],current:[a],arrowsPerEnd:6,owner:{id:'anon:device',anonymous:true}};
 const local=await store.capture(first);assert.equal((await engine.flush()).state,'pending');clock+=10000;
 assert.equal((await engine.flush()).state,'synced');
 await store.capture({...first,current:[a,b]});await store.capture(first);
 const ended={...first,current:[],completed:[{arrows:[a],endedAt:a.recordedAt,arrowLimit:6}]};await store.capture(ended);
 const archived={...ended,endedAt:'2026-11-01T11:00:00Z',csv:'original CSV',endReason:'manual'};await store.capture(archived);
 account='buddy-A';assert.equal((await engine.flush()).state,'synced');
 const session=(await db.query('select * from public.training_sessions')).rows;assert.equal(session.length,1);assert.equal(session[0].id,local.id);assert.equal(session[0].revision,7);assert.equal(session[0].owner_id,id);
 const arrows=(await db.query('select * from public.training_arrows')).rows;assert.equal(arrows.length,2);assert.equal(arrows.filter(a=>a.deleted_at===null).length,1);
 assert.equal(arrows.find(a=>a.deleted_at===null).id,local.projection.arrows[0].id);
 assert.equal((await db.query('select * from arbat_private.sync_operations')).rows.length,7);
 assert.equal((await store.status()).pending,0);assert.deepEqual((await store.readAll('sessions'))[0].snapshot,archived);
});

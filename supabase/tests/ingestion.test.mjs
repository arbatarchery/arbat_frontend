import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('ingestion and anonymous claims: transactional PostgreSQL behavior',async t=>{
 const db=new PGlite(); t.after(()=>db.close());
 await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
 create schema auth; create table auth.users(id uuid primary key,is_anonymous boolean not null default false);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
 for(const file of ['202611010001_training_foundation.sql','202611010002_training_ingestion.sql','202611010005_training_batches.sql'])
   await db.exec(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
 for(let n=1;n<=8;n++) await db.query('insert into auth.users values($1,$2)',[id(n),n!==4]);
 let sequence=1000;
 const op=(s,e,kind,base,payload={})=>({operation_id:id(++sequence),session_id:id(s),entity_id:id(e),kind,base_revision:base,payload});
 const rows=async(sql,params=[])=>(await db.query(sql,params)).rows;
 async function server(sql,params){await db.exec('begin; set local role service_role');try{const r=await rows(sql,params);await db.exec('commit');return r[0].result;}catch(e){await db.exec('rollback');throw e;}}
 const apply=(p,o,subject=null)=>server('select public.training_apply_operation($1,$2,$3::jsonb) result',[id(p),subject,JSON.stringify(o)]);
 const claim=(p,subject,proof='a'.repeat(64))=>server('select public.training_claim($1,$2,$3) result',[id(p),subject,proof]);
 const denied=(promise,code)=>assert.rejects(promise,e=>e.code===code);
 const session=(p,s,subject=null)=>apply(p,op(s,s,'session.upsert',0,{local_date:'2026-11-01',notes:'original'}),subject);
 let arrow;
 await t.test('per-arrow ACK, retry after remote commit and mismatched idempotency payload',async()=>{
  assert.equal((await session(1,101)).revision,1);
  arrow=op(101,201,'arrow.upsert',1,{ordinal:1,label:'X',score:10,x:50,y:50});
  assert.deepEqual(await apply(1,arrow),{status:'accepted',revision:2,replayed:false});
  assert.deepEqual(await apply(1,arrow),{status:'accepted',revision:2,replayed:true});
  assert.equal((await apply(1,Object.fromEntries(Object.entries(arrow).reverse()))).replayed,true);
  await denied(apply(1,{...arrow,payload:{...arrow.payload,score:9,label:'9'}}),'22023');
  assert.equal((await rows('select * from public.training_arrows')).length,1);
 });
 await t.test('stale revision conflicts without modifying data or adding receipt',async()=>{
  const stale=op(101,202,'arrow.upsert',1,{ordinal:2,label:'9',score:9});
  assert.deepEqual(await apply(1,stale),{status:'conflict',revision:2});
  assert.equal((await rows('select * from arbat_private.sync_operations where operation_id=$1',[stale.operation_id])).length,0);
 });
 await t.test('spoofed ownership and invalid payloads fail atomically',async()=>{
  await denied(apply(2,op(101,202,'arrow.upsert',2,{ordinal:2,label:'9',score:9})),'42501');
  await denied(apply(1,op(101,101,'session.upsert',2,{owner_id:id(2)})),'22023');
  await denied(apply(1,op(101,202,'arrow.upsert',2,{ordinal:2,label:'X',score:9})),'23514');
  assert.equal((await rows('select revision from public.training_sessions where id=$1',[id(101)]))[0].revision,2);
 });
 await t.test('end assignment preserves arrow UUID; undo is persistent and replayable',async()=>{
  await apply(1,op(101,301,'end.upsert',2,{ordinal:1,arrow_limit:6}));
  await apply(1,op(101,201,'arrow.upsert',3,{end_id:id(301),ordinal:1,label:'X',score:10,x:50,y:50}));
  assert.equal((await rows('select id from public.training_arrows'))[0].id,id(201));
  const undo=op(101,201,'arrow.delete',4);await apply(1,undo);assert.equal((await apply(1,undo)).replayed,true);
  await denied(apply(1,op(101,201,'arrow.upsert',5,{ordinal:1,label:'9',score:9})),'22023');
  await apply(1,op(101,202,'arrow.upsert',5,{end_id:id(301),ordinal:1,label:'9',score:9}));
 });
 await t.test('close is replayable while later edits are blocked',async()=>{
  const close=op(101,101,'session.close',6,{ended_at:'2026-11-01T11:00:00Z'});
  assert.equal((await apply(1,close)).revision,7);assert.equal((await apply(1,close)).replayed,true);
  await denied(apply(1,op(101,203,'arrow.upsert',7,{ordinal:2,label:'8',score:8})),'22023');
 });
 await t.test('new Buddy account binds anonymous principal once and requires Buddy afterward',async()=>{
  const result=await claim(1,'buddy-A');assert.equal(result.owner_id,id(1));assert.equal(result.replayed,false);
  assert.equal((await claim(1,'buddy-A')).replayed,true);
  await denied(claim(1,'buddy-B'),'28000');await denied(session(1,102),'28000');
  assert.equal((await session(1,102,'buddy-A')).status,'accepted');
 });
 await t.test('existing Buddy account receives another device history without duplicating old receipts',async()=>{
  await session(2,103);const pending=op(103,204,'arrow.upsert',1,{ordinal:1,label:'M',score:0});await apply(2,pending);
  const r=await claim(2,'buddy-A','b'.repeat(64));assert.equal(r.owner_id,id(1));assert.equal(r.sessions_claimed,1);
  assert.equal((await rows('select owner_id from public.training_sessions where id=$1',[id(103)]))[0].owner_id,id(1));
  assert.equal((await apply(2,pending,'buddy-A')).replayed,true);
  await denied(apply(2,pending),'28000');await denied(claim(2,'buddy-B','c'.repeat(64)),'28000');
  assert.equal((await claim(2,'buddy-A')).replayed,true);
  assert.equal((await rows('select * from arbat_private.anonymous_claims where anonymous_id=$1',[id(2)])).length,1);
 });
 await t.test('leftover guest JWT cannot directly read the Buddy-bound canonical account',async()=>{
  for(const p of [1,2]){await db.exec('begin; set local role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id(p)]);
   assert.equal((await rows('select * from public.training_sessions')).length,0);assert.equal((await rows('select * from public.training_arrows')).length,0);await db.exec('rollback');}
 });
 await t.test('permanent account cannot be silently claimed by another account',async()=>{
  await session(4,104);await denied(claim(4,'buddy-A','d'.repeat(64)),'28000');
  assert.equal((await rows('select owner_id from public.training_sessions where id=$1',[id(104)]))[0].owner_id,id(4));
  assert.equal((await rows('select * from arbat_private.principal_links where source_id=$1',[id(4)])).length,0);
 });
 await t.test('rate-limited operation leaves revision unchanged and commits quota counter',async()=>{
  await session(5,105);await db.query('update arbat_private.ingress_limits set requests=120 where principal_id=$1',[id(5)]);
  assert.equal((await apply(5,op(105,205,'arrow.upsert',1,{ordinal:1,label:'9',score:9}))).status,'rate_limited');
  assert.equal((await rows('select revision from public.training_sessions where id=$1',[id(105)]))[0].revision,1);
  assert.equal((await rows('select requests from arbat_private.ingress_limits where principal_id=$1',[id(5)]))[0].requests,121);
 });
 await t.test('clients cannot bypass verified Edge identity by invoking server RPCs',async()=>{
  for(const role of ['anon','authenticated'])for(const sql of [
   'select public.training_claim($1,\'buddy-A\',repeat(\'e\',64))',
   'select public.training_apply_operation($1,null,\'{}\'::jsonb)']){
    await db.exec(`begin; set local role ${role}`);await denied(db.query(sql,[id(3)]),'42501');await db.exec('rollback');
  }
 });
 await t.test('cross-session parents and non-UUID IDs fail',async()=>{
  await session(3,106);await denied(apply(3,op(106,206,'arrow.upsert',1,{end_id:id(301),ordinal:1,label:'9',score:9})),'23503');
  await denied(apply(3,{...op(106,206,'arrow.upsert',1),entity_id:'2026-11-01'}),'22P02');
 });
 await t.test('unlinked guests still read their own sessions after the new RLS migration',async()=>{
  await db.exec('begin; set local role authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id(3)]);
  assert.deepEqual((await rows('select id from public.training_sessions')).map(x=>x.id),[id(106)]);
  await db.exec('rollback');
 });
 await t.test('guest session quota and per-session arrow quota do not create receipts',async()=>{
  await session(6,107);
  await db.exec(`insert into public.training_sessions(id,owner_id)
    select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(6)}' from generate_series(1,99) n`);
  assert.equal((await session(6,108)).status,'quota_exceeded');
  await db.exec(`insert into public.training_arrows(id,session_id,ordinal,label,score)
    select ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(107)}',n,'9',9 from generate_series(1,10000) n`);
  const extra=op(107,207,'arrow.upsert',1,{ordinal:10001,label:'9',score:9});
  assert.equal((await apply(6,extra)).status,'quota_exceeded');
  assert.equal((await rows('select * from arbat_private.sync_operations where operation_id=$1',[extra.operation_id])).length,0);
 });
 await t.test('linked devices share the canonical account rate budget',async()=>{
  await db.query('update arbat_private.ingress_limits set requests=120 where principal_id=$1',[id(1)]);
  assert.equal((await apply(2,op(103,208,'arrow.upsert',2,{ordinal:2,label:'9',score:9}),'buddy-A')).status,'rate_limited');
 });
});

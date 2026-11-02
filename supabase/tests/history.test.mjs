import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const id=n=>`b0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('history SQL: ownership, scopes, pagination and revision consistency',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean not null);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 for(const file of ['202611010001_training_foundation.sql','202611010002_training_ingestion.sql','202611010003_training_history.sql'])await db.exec(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
 for(let n=1;n<=6;n++)await db.query('insert into auth.users values($1,true)',[id(n)]);
 async function rpc(name,args){await db.exec('begin;set local role service_role');try{const placeholders=args.map((_,i)=>`$${i+1}`).join(',');const result=(await db.query(`select public.${name}(${placeholders}) result`,args)).rows[0].result;await db.exec('commit');return result;}catch(e){await db.exec('rollback');throw e;}}
 const claim=(n,subject)=>rpc('training_claim',[id(n),subject,String(n).repeat(64)]);
 const list=(n,subject=null,target=null,cursor=null)=>rpc('training_history_list',[id(n),subject,'2026-11-01','2026-11-30',cursor,target]);
 const detail=(n,s,revision,collection='arrows',cursor=null,subject=null)=>rpc('training_history_detail',[id(n),subject,id(s),revision,collection,cursor]);
 await claim(1,'athlete-A');await claim(2,'athlete-B');await claim(3,'coach');await claim(4,'admin');await claim(5,'super');
 await db.exec(`insert into public.training_profiles(id) values('${id(6)}');
 insert into arbat_private.schools values('${id(90)}','A'),('${id(91)}','B');
 insert into arbat_private.school_members values('${id(90)}','${id(1)}'),('${id(91)}','${id(2)}'),('${id(90)}','${id(3)}');
 insert into arbat_private.coach_athletes values('${id(90)}','${id(3)}','${id(1)}',true);
 insert into arbat_private.role_assignments(user_id,role,school_id) values('${id(3)}','coach','${id(90)}'),('${id(4)}','admin','${id(90)}'),('${id(5)}','superadmin',null),('${id(6)}','superadmin',null);
 insert into public.training_sessions(id,owner_id,school_id,local_date) values('${id(101)}','${id(1)}','${id(90)}','2026-11-01'),('${id(102)}','${id(2)}','${id(91)}','2026-11-01'),('${id(103)}','${id(1)}',null,'2026-11-01'),('${id(104)}','${id(6)}',null,'2026-11-01');
 insert into public.training_ends(id,session_id,ordinal,notes) values('${id(201)}','${id(101)}',1,'original');
 insert into public.training_arrows(id,session_id,end_id,ordinal,label,score) values('${id(301)}','${id(101)}','${id(201)}',1,'9',9);`);
 await t.test('Buddy-linked anonymous principals can read only after verified identity resolution',async()=>{
  assert.deepEqual((await list(1,'athlete-A')).sessions.map(s=>s.id),[id(101),id(103)]);
  await assert.rejects(list(1),e=>e.code==='28000');assert.equal((await list(1,'athlete-A','athlete-B')).sessions.length,0);
 });
 await t.test('unlinked guest cannot gain privileges from a role assignment',async()=>{
  assert.deepEqual((await list(6)).sessions.map(s=>s.id),[id(104)]);
  await assert.rejects(detail(6,101,1),e=>e.code==='42501');
 });
 await t.test('coach/admin are scoped while SuperAdmin reads authorized targets',async()=>{
  assert.deepEqual((await list(3,'coach','athlete-A')).sessions.map(s=>s.id),[id(101)]);
  assert.equal((await list(3,'coach','athlete-B')).sessions.length,0);
  assert.deepEqual((await list(4,'admin','athlete-A')).sessions.map(s=>s.id),[id(101)]);
  assert.deepEqual((await list(5,'super','athlete-A')).sessions.map(s=>s.id),[id(101),id(103)]);
 });
 await t.test('detail checks ownership and revision; removed arrows are not returned',async()=>{
  assert.equal((await detail(1,101,1,'ends',null,'athlete-A')).items[0].notes,'original');
  assert.equal((await detail(1,101,1,'arrows',null,'athlete-A')).items[0].id,id(301));
  assert.equal((await detail(1,101,2,'arrows',null,'athlete-A')).status,'changed');
  await assert.rejects(detail(2,101,1,'arrows',null,'athlete-B'),e=>e.code==='42501');
  await db.query('update public.training_arrows set deleted_at=now() where id=$1',[id(301)]);
  assert.equal((await detail(1,101,1,'arrows',null,'athlete-A')).items.length,0);
 });
 await t.test('large histories are paged by UUID instead of date and expose tombstones',async()=>{
  await db.exec(`insert into public.training_sessions(id,owner_id,local_date) select ('c0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${id(1)}','2026-11-01' from generate_series(1,10) n;`);
  const first=await list(1,'athlete-A');assert.equal(first.sessions.length,8);assert.ok(first.next_cursor);
  const second=await list(1,'athlete-A',null,first.next_cursor);assert.equal(second.sessions.length,4);assert.equal(new Set([...first.sessions,...second.sessions].map(s=>s.id)).size,12);
  await db.query('update public.training_sessions set deleted_at=now() where id=$1',[id(103)]);
  assert.ok((await list(1,'athlete-A')).sessions.find(s=>s.id===id(103)).deletedAt);
  assert.equal((await detail(1,103,1,'arrows',null,'athlete-A')).status,'gone');
 });
 await t.test('public clients cannot execute history RPCs or forge an actor',async()=>{
  await db.exec('begin;set local role authenticated');
  await assert.rejects(db.query('select public.training_history_list($1,null,$2,$3)',[id(1),'2026-11-01','2026-11-30']),e=>e.code==='42501');await db.exec('rollback');
 });
});

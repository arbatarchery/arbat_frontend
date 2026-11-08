import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const id=n=>`e0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const school='a8ba7000-0000-4000-8000-000000000001';

test('supervisors see completed ends in the selected period while the session is still open',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
  create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean not null);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  set time zone 'UTC';`);
 for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){
  await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 }
 for(let n=1;n<=5;n++){
  await db.query('insert into auth.users values($1,true)',[id(n)]);
  await db.query('select public.training_claim($1,$2,$3)',[id(n),'buddy-'+n,String(n).repeat(64)]);
 }
 await db.query('insert into arbat_private.school_members values($1,$2),($1,$3),($1,$4)',[school,id(1),id(2),id(3)]);
 await db.query("insert into arbat_private.role_assignments(user_id,role,school_id) values($1,'coach',$4),($2,'admin',$4),($3,'superadmin',null)",[id(1),id(3),id(4),school]);
 await db.query('insert into arbat_private.coach_athletes(school_id,coach_id,athlete_id) values($1,$2,$3)',[school,id(1),id(2)]);
 const [{today,yesterday,now}]=(await db.query('select current_date::text today,(current_date-1)::text yesterday,now()::text now')).rows;
 const session=id(100),arrow=id(101),end=id(102);
 const operation=(n,kind,entity,revision,payload)=>({operation_id:id(n),session_id:session,entity_id:entity,kind,base_revision:revision,payload});
 const batch=async operations=>{
  const {rows}=await db.query('select public.training_apply_batch($1,$2,$3) result',[id(2),'buddy-2',JSON.stringify(operations)]);
  assert.ok(rows[0].result.results.every(item=>item.status==='accepted'),JSON.stringify(rows[0].result));
 };
 const overview=async (n,day=today)=>(await db.query('select public.training_coach_overview($1,$2,$3,$3) result',[id(n),'buddy-'+n,day])).rows[0].result;
 const mark={ordinal:1,label:'8',score:8,recorded_at:now};
 await batch([operation(200,'session.upsert',session,0,{local_date:today,started_at:now,timezone:'UTC'}),operation(201,'arrow.upsert',arrow,1,mark)]);
 const versions=[];
 for(const n of [1,3,4]){
  const result=await overview(n);versions.push(result.activity_version);
  assert.equal(result.arrows,0);assert.equal(result.athletes.find(a=>a.id===id(2)).last_session_date,null);
 }
 await batch([operation(202,'end.upsert',end,2,{ordinal:1,ended_at:now}),operation(203,'arrow.upsert',arrow,3,{...mark,end_id:end})]);
 for(const [index,n] of [1,3,4].entries()){
  const result=await overview(n),row=result.athletes.find(a=>a.id===id(2));
  assert.equal(result.arrows,1);assert.equal(row.day_points,8);assert.equal(row.day_average,8);
  assert.equal(row.last_session_date,today);assert.notEqual(result.activity_version,versions[index]);
  assert.equal((await overview(n,yesterday)).athletes.find(a=>a.id===id(2)).last_session_date,null);
 }
 assert.equal((await db.query('select ended_at from public.training_sessions where id=$1',[session])).rows[0].ended_at,null);
 await assert.rejects(overview(5),{code:'42501'});
 // A session started yesterday can still contribute a completed end today.
 await db.query('update public.training_sessions set local_date=$2 where id=$1',[session,yesterday]);
 const aggregate=(await db.query('select public.training_history_all($1,$2,$3,$3) result',[id(1),'buddy-1',today])).rows[0].result;
 assert.equal(aggregate.sessions[0].id,session);
 // The effective server close uses the original local date and extends only once.
 for(const [offset,sessionNumber,arrowNumber,expectedDays] of [['23 hours 29 minutes',110,111,1],['23 hours 30 minutes',120,121,2]]){
  await db.query("insert into public.training_sessions(id,owner_id,local_date,timezone) values($1,$2,current_date-3,'UTC')",[id(sessionNumber),id(2)]);
  await db.query("insert into public.training_arrows(id,session_id,ordinal,label,score,recorded_at) values($1,$2,1,'9',9,(current_date-3)::timestamp+$3::interval)",[id(arrowNumber),id(sessionNumber),offset]);
  const result=await db.query("select (arbat_private.training_effective_end(s) at time zone 'UTC')::date-s.local_date days,s.ended_at from public.training_sessions s where id=$1",[id(sessionNumber)]);
  assert.equal(result.rows[0].days,expectedDays);assert.equal(result.rows[0].ended_at,null);
 }
});

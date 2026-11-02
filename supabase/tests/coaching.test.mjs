import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const id=n=>`d0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('academy coaching is opt-in, scoped and available only through server RPCs',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean not null);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 for(const f of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')&&!f.startsWith('202611020006')).sort())await db.exec(await readFile(new URL('../migrations/'+f,import.meta.url),'utf8'));
 const upgrade=await readFile(new URL('../setup/actualizar-historial-entrenadores.sql',import.meta.url),'utf8');
 await db.exec(upgrade);await db.exec(upgrade);
 const school='a8ba7000-0000-4000-8000-000000000001';
 for(let n=1;n<=4;n++){
  await db.query('insert into auth.users values($1,true)',[id(n)]);
  await db.query('select public.training_claim($1,$2,$3)',[id(n),'buddy-'+n,String(n).repeat(64)]);
 }
 await db.exec(`insert into arbat_private.school_members values('${school}','${id(1)}'),('${school}','${id(2)}');
 insert into arbat_private.role_assignments(user_id,role,school_id,coach_scope) values('${id(1)}','coach','${school}','academy');
 insert into public.training_sessions(id,owner_id,local_date,session_type,timezone) values
 ('${id(101)}','${id(2)}','2026-11-01','competition','America/La_Paz'),
 ('${id(102)}','${id(3)}','2026-11-01','training','America/La_Paz');
 insert into public.training_arrows(id,session_id,ordinal,label,score,recorded_at) values
 ('${id(201)}','${id(101)}',1,'10',10,'2026-11-01T18:00:00Z'),
 ('${id(202)}','${id(101)}',2,'M',0,'2026-11-01T18:01:00Z'),
 ('${id(203)}','${id(102)}',1,'9',9,'2026-11-01T18:00:00Z');`);
 const overview=async()=> (await db.query('select public.training_coach_overview($1,$2,$3,$4) result',[id(1),'buddy-1','2026-11-01','2026-11-02'])).rows[0].result;
 let result=await overview();assert.equal(result.arrows,2);assert.equal(result.athletes.length,1);assert.equal(result.athletes[0].id,id(2));assert.equal(result.athletes[0].day_average,5);assert.equal(result.days[0].has_competition,true);
 assert.equal((await db.query('select arbat_private.can_read_history($1,$2,null,$3) ok',[id(1),id(2),'buddy-1'])).rows[0].ok,true);
 await db.query("update arbat_private.role_assignments set coach_scope='assigned' where user_id=$1",[id(1)]);
 result=await overview();assert.equal(result.arrows,0);assert.equal(result.athletes.length,0);
 await assert.rejects(db.query('select public.training_coach_overview($1,$2,$3,$4)',[id(2),'buddy-2','2026-11-01','2026-11-02']),e=>e.code==='42501');
 await db.exec('begin;set local role authenticated');
 await assert.rejects(db.query('select public.training_coach_overview($1,$2,$3,$4)',[id(1),'buddy-1','2026-11-01','2026-11-02']),e=>e.code==='42501');await db.exec('rollback');
});

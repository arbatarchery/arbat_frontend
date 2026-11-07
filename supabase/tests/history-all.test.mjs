import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
const {Reader}=createRequire(import.meta.url)('../../entrenamiento/js/sync-history.js');
const id=n=>`d0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('Todos is explicit: own and individual requests never use the aggregate endpoint',async()=>{
 const bodies=[],identity={accountKey:'trainer',principalId:id(3),buddyToken:'fixture-token'};
 const reader=new Reader({enabled:true,url:'https://db.test',publicKey:'public',identityProvider:async()=>identity,transport:{claim:async()=>({status:'accepted'})},fetchImpl:async(_url,init)=>{bodies.push(JSON.parse(init.body));return Response.json({status:'accepted',sessions:[],next_cursor:null});}});
 await reader.get({from:'2026-11-06',to:'2026-11-06'});
 await reader.get({from:'2026-11-06',to:'2026-11-06',allUsers:true});
 await reader.get({from:'2026-11-06',to:'2026-11-06',targetSubject:'athlete-1'});
 assert.deepEqual(bodies.map(b=>b.action),['history.list','history.all','history.list']);
 assert.equal(bodies[0].target_subject,null);assert.ok(!Object.hasOwn(bodies[1],'target_subject'));assert.equal(bodies[2].target_subject,'athlete-1');
});
test('aggregate SQL respects roles, academies, dates, pagination and revoked supervision',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean not null);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 for(let n=1;n<=5;n++){await db.query('insert into auth.users values($1,true)',[id(n)]);await db.query('select public.training_claim($1,$2,$3)',[id(n),'buddy-'+n,String(n).repeat(64)]);}
 const a=id(90),b=id(91);await db.query("insert into arbat_private.schools values($1,'A'),($2,'B')",[a,b]);
 for(const [n,school] of [[1,a],[2,b],[3,a],[4,a]])await db.query('insert into arbat_private.school_members values($1,$2)',[school,id(n)]);
 await db.query("insert into arbat_private.role_assignments(user_id,role,school_id) values($1,'coach',$4),($2,'admin',$4),($3,'superadmin',null)",[id(3),id(4),id(5),a]);
 await db.query('insert into arbat_private.coach_athletes(school_id,coach_id,athlete_id) values($1,$2,$3)',[a,id(3),id(1)]);
 for(const [sid,n,school,date] of [[101,1,a,'2026-11-06'],[102,2,b,'2026-11-06'],[103,3,a,'2026-11-06'],[104,1,null,'2026-11-06'],[105,1,a,'2026-11-05']])await db.query('insert into public.training_sessions(id,owner_id,school_id,local_date) values($1,$2,$3,$4)',[id(sid),id(n),school,date]);
 const all=(n,cursor=null)=>db.query('select public.training_history_all($1,$2,$3,$4,$5) result',[id(n),'buddy-'+n,'2026-11-06','2026-11-06',cursor]).then(r=>r.rows[0].result);
 await assert.rejects(all(1),e=>e.code==='42501');await assert.rejects(db.query('select public.training_history_all($1,null,$2,$2)',[id(3),'2026-11-06']),e=>e.code==='28000');
 assert.deepEqual((await all(3)).sessions.map(s=>s.id),[id(101),id(103),id(104)]);
 assert.deepEqual((await all(4)).sessions.map(s=>s.id),[id(101),id(103),id(104)]);
 assert.deepEqual((await all(5)).sessions.map(s=>s.id),[101,102,103,104].map(id));
 assert.ok((await all(3)).sessions.every(s=>typeof s.owner.name==='string'));
 const own=(await db.query('select public.training_history_list($1,$2,$3,$3) result',[id(3),'buddy-3','2026-11-06'])).rows[0].result;assert.deepEqual(own.sessions.map(s=>s.id),[id(103)]);
 await db.query('update arbat_private.coach_athletes set active=false where coach_id=$1',[id(3)]);assert.deepEqual((await all(3)).sessions.map(s=>s.id),[id(103)]);
 for(let n=110;n<120;n++)await db.query("insert into public.training_sessions(id,owner_id,school_id,local_date) values($1,$2,$3,'2026-11-06')",[id(n),id(1),a]);
 const first=await all(4),second=await all(4,first.next_cursor);assert.equal(first.sessions.length,8);assert.equal(second.sessions.length,5);assert.equal(new Set([...first.sessions,...second.sessions].map(s=>s.id)).size,13);
 await db.exec('begin;set local role authenticated');await assert.rejects(db.query('select public.training_history_all($1,$2,$3,$3)',[id(3),'buddy-3','2026-11-06']),e=>e.code==='42501');await db.exec('rollback');
});

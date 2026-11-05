import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import vm from 'node:vm';
import {PGlite} from '@electric-sql/pglite';
test('capacity notice appears only for a confirmed red database capacity and non-admin account',async()=>{
 const events={},panel={hidden:true};let signed=true;
 const context={document:{getElementById:()=>panel},window:{ArbatUser:{get:()=>signed?{id:'archer'}:null},addEventListener:(name,fn)=>events[name]=fn}};
 vm.runInNewContext(await readFile(new URL('../../entrenamiento/historial/js/capacity-notice.js',import.meta.url),'utf8'),context);
 const show=(role,databaseNearLimit)=>events['arbat:history-role']({detail:{role,databaseNearLimit}});
 for(const value of [false,undefined,'true']){show('user',value);assert.equal(panel.hidden,true);}
 show('user',true);assert.equal(panel.hidden,false);
 events['arbat:history-loading']();assert.equal(panel.hidden,true);
 for(const role of ['admin','superadmin','unknown']){show(role,true);assert.equal(panel.hidden,true);}
 show('coach',true);assert.equal(panel.hidden,false);
 events['buddy:auth-state-changed']();assert.equal(panel.hidden,true);
 signed=false;show('user',true);assert.equal(panel.hidden,true);
});
test('SQL never assumes a Free limit without a confirmed Management API response',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean not null);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 for(const [bytes,expected] of [[474999999,false],[475000000,true],[500000000,true]]){
  const result=await db.query('select arbat_private.training_database_near_limit($1) red',[bytes]);assert.equal(result.rows[0].red,null);
 }
 const id='f0000000-0000-4000-8000-000000000001';await db.query('insert into auth.users values($1,true)',[id]);
 await db.query('select public.training_claim($1,$2,$3)',[id,'archer-capacity','a'.repeat(64)]);
 const result=(await db.query('select public.training_history_context($1,$2) result',[id,'archer-capacity'])).rows[0].result;
 assert.equal(result.database_near_limit,null);assert.equal(result.role,'user');assert.ok(!Object.hasOwn(result,'database_bytes'));
 await db.exec('begin;set local role authenticated');await assert.rejects(db.query('select arbat_private.training_database_near_limit(500000000)'),e=>e.code==='42501');await db.exec('rollback');
});

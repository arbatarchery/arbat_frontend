import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const bundle=await readFile(new URL('../setup/preparar-desarrollo.sql',import.meta.url),'utf8');
const check=await readFile(new URL('../setup/verificar-desarrollo.sql',import.meta.url),'utf8');
async function database(){const db=new PGlite();await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean not null default false);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);return db;}
test('dashboard setup bundle creates fourteen protected tables and leaves public RPC denied',async t=>{
 const db=await database();t.after(()=>db.close());await db.exec(bundle);
 assert.deepEqual((await db.query(check)).rows[0],{tablas_entrenamiento:14,tablas_con_rls:14,estado:'estructura_preparada'});
 assert.equal((await db.query('select count(*)::integer as n from auth.users')).rows[0].n,0);
 assert.equal((await db.query("select has_function_privilege('anon','public.training_apply_operation(uuid,text,jsonb)','execute') as allowed")).rows[0].allowed,false);
 for(const role of ['anon','authenticated'])assert.equal((await db.query(`select has_function_privilege('${role}','public.training_buddy_lookup(text)','execute') as allowed`)).rows[0].allowed,false);
 await db.exec('set role service_role');assert.equal((await db.query("select public.training_buddy_lookup('unknown') result")).rows[0].result.principal_id,null);await db.exec('reset role');
});
test('running setup twice fails before replacing any existing data',async t=>{
 const db=await database();t.after(()=>db.close());await db.exec(bundle);
 await db.exec("insert into auth.users values('90000000-0000-4000-8000-000000000001',true);insert into public.training_profiles(id) select id from auth.users;");
 await assert.rejects(db.exec(bundle),/Ya existen objetos/);await db.exec('rollback');
 assert.equal((await db.query('select count(*)::integer as n from public.training_profiles')).rows[0].n,1);
 assert.equal((await db.query(check)).rows[0].estado,'estructura_preparada');
});
test('late failure rolls back both migrations rather than leaving a partial installation',async t=>{
 const db=await database();t.after(()=>db.close());const broken=bundle.replace('commit;',"select * from arbat_intentional_missing_table;\ncommit;");
 await assert.rejects(db.exec(broken));await db.exec('rollback');
 assert.equal((await db.query("select to_regnamespace('arbat_private') as name")).rows[0].name,null);
 assert.equal((await db.query(check)).rows[0].tablas_entrenamiento,0);
});

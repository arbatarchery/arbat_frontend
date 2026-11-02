import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';
import {IDBFactory} from 'fake-indexeddb';import {PGlite} from '@electric-sql/pglite';
const require=createRequire(import.meta.url),{Store}=require('../../entrenamiento/js/sync-store.js'),{Engine,createTransport}=require('../../entrenamiento/js/sync-engine.js');
const principal='c0000000-0000-4000-8000-000000000001',identity={principalId:principal,supabaseToken:'test.jwt',accountKey:null};
const arrow=n=>({label:'9',score:9,x:50+n/100,y:50,recordedAt:new Date(Date.parse('2026-10-01T12:00:00Z')+n*1000).toISOString()});
const snapshot=(id,count=6)=>({id,date:'2026-10-01',startedAt:'2026-10-01T12:00:00Z',arrowsPerEnd:6,completed:[],current:Array.from({length:count},(_,i)=>arrow(i)),owner:{id:'anon:test',anonymous:true}});
const setup=()=>new Store({indexedDB:new IDBFactory()});
const engine=(store,transport,options={})=>new Engine({store,transport,enabled:true,navigator:{onLine:true},identityProvider:async()=>identity,setTimer:()=>1,clearTimer(){},...options});
const accept=batch=>({results:batch.map(op=>({operation_id:op.operation_id,status:'accepted',revision:op.base_revision+1}))});

test('offline backlog is sent in ordered batches of at most 32; independent new arrows are sent immediately',async t=>{
 const store=setup();t.after(()=>store.close());const record=await store.capture(snapshot('backlog',70)),packets=[];const navigator={onLine:false};
 const sync=engine(store,{sendBatch:async ops=>{packets.push(ops);return accept(ops);}},{navigator});
 assert.equal((await sync.flush()).state,'offline');assert.equal(packets.length,0);navigator.onLine=true;
 while((await store.status()).pending)await sync.flush();
 assert.deepEqual(packets.map(b=>b.length),[32,32,7]);assert.equal((await store.readAll('sessions'))[0].confirmedRevision,71);
 assert.deepEqual(packets.flat().map(op=>op.base_revision),Array.from({length:71},(_,i)=>i));assert.ok(packets.every(b=>b.every(op=>op.session_id===record.id)));
 const updated=snapshot('backlog',71);await store.capture(updated);await sync.flush();assert.equal(packets.at(-1).length,1);assert.equal(packets.at(-1)[0].kind,'arrow.upsert');
});
test('batch preparation respects UTF-8 byte limits and freezes envelopes across smaller retries',async t=>{
 const store=setup();t.after(()=>store.close());const value=snapshot('unicode',2);value.notes='🏹'.repeat(1200);const row=await store.capture(value);
 const full=await store.prepareBatch(row.key,identity),one=await store.prepareBatch(row.key,identity,{limit:1});assert.deepEqual(one,[full[0]]);
 const firstBytes=new TextEncoder().encode(JSON.stringify({schema_version:1,action:'sync',operations:one})).length;
 const limited=await store.prepareBatch(row.key,identity,{maxBytes:firstBytes});assert.deepEqual(limited,one);
 const queue=await store.readAll('operations');assert.equal(queue.length,3);assert.ok(queue.every(op=>op.envelope));
});
test('partial confirmation checkpoints only its prefix and keeps not-attempted operations intact',async t=>{
 let clock=1000;const store=new Store({indexedDB:new IDBFactory(),now:()=>clock});t.after(()=>store.close());await store.capture(snapshot('partial',3));let first,requests=0;
 const sync=engine(store,{sendBatch:async batch=>{requests++;if(requests>1){assert.deepEqual(batch,first.slice(1));return accept(batch);}first=structuredClone(batch);return {results:batch.map((op,i)=>({operation_id:op.operation_id,status:i===0?'accepted':i===1?'rate_limited':'not_attempted',revision:1}))};}},{now:()=>clock});
 assert.equal((await sync.flush()).error,'rate_limited');const row=(await store.readAll('sessions'))[0];assert.equal(row.confirmedRevision,1);assert.equal((await store.status()).pending,3);
 await sync.flush();assert.equal(requests,1);clock+=61000;assert.equal((await sync.flush()).state,'synced');assert.equal(requests,2);
});
test('a lost whole-batch reply survives reopening without changing operation UUIDs or envelopes',async t=>{
 let clock=1000;const indexedDB=new IDBFactory();let store=new Store({indexedDB,now:()=>clock});await store.capture(snapshot('lost',8));const receipts=new Map();let sent,fail=true;
 const transport={sendBatch:async batch=>{if(!sent)sent=structuredClone(batch);else assert.deepEqual(batch,sent);for(const op of batch)receipts.set(op.operation_id,op.base_revision+1);if(fail){fail=false;throw new Error('lost reply');}return accept(batch);}};
 await engine(store,transport,{now:()=>clock}).flush();await store.close();clock+=10000;store=new Store({indexedDB,now:()=>clock});t.after(()=>store.close());
 assert.equal((await engine(store,transport,{now:()=>clock}).flush()).state,'synced');assert.equal(receipts.size,9);
});
test('live work takes priority over imported historical batches, whose JSON remains untouched',async t=>{
 const store=setup();t.after(()=>store.close());const originals=[snapshot('old-A',45),snapshot('old-B',45)].map(s=>({...s,completed:[{arrows:s.current,endedAt:s.current.at(-1).recordedAt,arrowLimit:6}],current:[],endedAt:'2026-10-01T13:00:00Z',csv:'original CSV'}));
 const raw=JSON.stringify(originals),storage={length:1,key:()=> 'arbat-training-history',getItem:key=>key==='arbat-training-history'?raw:null,setItem:()=>assert.fail('must not mutate legacy JSON')};
 await store.importLegacy(storage);const live=await store.capture(snapshot('live',1)),packets=[];const sync=engine(store,{sendBatch:async ops=>{packets.push(ops);return accept(ops);}});
 while((await store.status()).pending)await sync.flush();assert.equal(packets[0][0].session_id,live.id);assert.ok(packets.length<10);
 const rows=await store.readAll('sessions');for(const original of originals)assert.deepEqual(rows.find(r=>r.snapshot.id===original.id).snapshot,original);
 const ids=rows.filter(r=>r.key!==live.key).map(r=>r.key).sort();await store.importLegacy(storage);assert.equal((await store.status()).pending,0);assert.deepEqual((await store.readAll('sessions')).filter(r=>r.key!==live.key).map(r=>r.key).sort(),ids);
});
test('transport sends an actual array in one HTTP request',async()=>{
 let requests=0;const transport=createTransport({enabled:true,url:'https://test.supabase.co',publicKey:'test-public',fetchImpl:async(_url,init)=>{requests++;const body=JSON.parse(init.body);assert.equal(body.operations.length,2);return Response.json(accept(body.operations));}});
 await transport.sendBatch([{operation_id:'A'},{operation_id:'B'}],identity);assert.equal(requests,1);
});

test('PostgreSQL batch preserves all operation validation, partial commits, quotas and replay receipts',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean not null);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);
 for(const file of ['202611010001_training_foundation.sql','202611010002_training_ingestion.sql','202611010005_training_batches.sql'])await db.exec(await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
 await db.query('insert into auth.users values($1,true)',[principal]);
 const uid=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const op=(n,base,kind='arrow.upsert',payload={end_id:null,ordinal:n,label:'9',score:9,x:50,y:50,recorded_at:'2026-10-01T12:00:00Z'})=>({operation_id:uid(n+100),session_id:uid(2),entity_id:kind==='session.upsert'?uid(2):uid(n+200),kind,base_revision:base,payload});
 const first=op(1,0,'session.upsert',{local_date:'2026-10-01',arrows_per_end:6}),second=op(2,1),third=op(3,2);
 const batch=async ops=>{await db.exec('begin;set local role service_role');try{const result=(await db.query('select public.training_apply_batch($1,null,$2::jsonb) result',[principal,JSON.stringify(ops)])).rows[0].result;await db.exec('commit');return result;}catch(error){await db.exec('rollback');throw error;}};
 await t.test('one SQL request accepts and replays a whole ordered prefix',async()=>{
  const packets=[first,second,third];assert.deepEqual((await batch(packets)).results.map(r=>r.revision),[1,2,3]);assert.ok((await batch(packets)).results.every(r=>r.replayed));
  assert.equal((await db.query('select count(*)::int n from public.training_arrows')).rows[0].n,2);
  assert.equal((await db.query('select requests from arbat_private.ingress_limits')).rows[0].requests,2);
 });
 await t.test('invalid operation rolls back only itself and prevents its dependent tail',async()=>{
  const bad=op(5,4,'arrow.upsert',{end_id:null,ordinal:5,label:'BAD',score:9}),tail=op(6,5);
  const result=await batch([op(4,3),bad,tail]);assert.deepEqual(result.results.map(r=>r.status),['accepted','rejected','not_attempted']);
  assert.equal((await db.query('select revision from public.training_sessions')).rows[0].revision,4);assert.equal((await db.query('select count(*)::int n from public.training_arrows')).rows[0].n,3);
 });
 await t.test('conflict stops subsequent changes and keeps the confirmed revision',async()=>{
  assert.deepEqual((await batch([op(7,0),op(8,1)])).results.map(r=>r.status),['conflict','not_attempted']);
  assert.equal((await db.query('select revision from public.training_sessions')).rows[0].revision,4);
 });
 await t.test('bounded request limits reject mixed sessions, oversized arrays and excessive bytes',async()=>{
  await assert.rejects(batch([op(9,4),{...op(10,5),session_id:uid(3)}]),e=>e.code==='22023');
  await assert.rejects(batch(Array(33).fill(op(9,4))),e=>e.code==='22023');
  await assert.rejects(batch([op(9,4,'session.upsert',{notes:'x'.repeat(140000)})]),e=>e.code==='22023');
 });
 await t.test('anonymous and authenticated clients cannot call batch or its unchecked private core',async()=>{
  for(const role of ['anon','authenticated','service_role']){
   const allowed=(await db.query(`select has_function_privilege('${role}','arbat_private.apply_training_operation(uuid,text,jsonb,boolean)','execute') allowed`)).rows[0].allowed;assert.equal(allowed,false);
   if(role!=='service_role')assert.equal((await db.query(`select has_function_privilege('${role}','public.training_apply_batch(uuid,text,jsonb)','execute') allowed`)).rows[0].allowed,false);
  }
 });
 await t.test('batching cannot bypass per-operation ownership or session quotas',async()=>{
  const other=uid(90);await db.query('insert into auth.users values($1,true)',[other]);await db.query('insert into public.training_profiles(id) values($1)',[other]);
  const forbidden=uid(91);await db.query("insert into public.training_sessions(id,owner_id,local_date) values($1,$2,'2026-10-01')",[forbidden,other]);
  const denied=await batch([{...op(90,0),session_id:forbidden}]);assert.equal(denied.results[0].code,'not_owner');
  await db.query("insert into public.training_sessions(id,owner_id,local_date) select ('d0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,'2026-10-01' from generate_series(1,99) n",[principal]);
  const newId=uid(99),candidate={...op(99,0,'session.upsert',{local_date:'2026-10-01'}),session_id:newId,entity_id:newId};
  assert.equal((await batch([candidate])).results[0].status,'quota_exceeded');
 });
 await t.test('request throttling retains every unattempted operation',async()=>{
  await db.query('update arbat_private.ingress_limits set requests=120 where principal_id=$1',[principal]);
  assert.deepEqual((await batch([op(11,4),op(12,5)])).results.map(r=>r.status),['rate_limited','not_attempted']);assert.equal((await db.query('select revision from public.training_sessions')).rows[0].revision,4);
 });
});

test('a new live arrow arriving during historical recovery is picked before the next historical packet',async t=>{
 const store=setup();t.after(()=>store.close());await store.capture(snapshot('old',80),{source:'history',priority:1});let live,created=false;const packets=[];
 const sync=engine(store,{sendBatch:async batch=>{packets.push(batch);if(!created){created=true;live=await store.capture(snapshot('new-live',1));}return accept(batch);}});
 await sync.flush();await sync.flush();assert.equal(packets[1][0].session_id,live.id);assert.equal(packets[1].length,2);
});

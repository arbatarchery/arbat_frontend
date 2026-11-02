import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {IDBFactory} from 'fake-indexeddb';
const require=createRequire(import.meta.url);
const {Store,canonical}=require('../../entrenamiento/js/sync-store.js');
const {Engine,createTransport}=require('../../entrenamiento/js/sync-engine.js');
const copy=v=>structuredClone(v);
const arrow=(score=9,n=1)=>({label:String(score),score,x:50+n,y:45,recordedAt:`2026-11-01T10:00:${String(n).padStart(2,'0')}Z`});
const session=(id='old-id')=>({id,date:'2026-11-01',startedAt:'2026-11-01T10:00:00Z',completed:[],current:[arrow()],arrowsPerEnd:6,notes:'',sessionType:'training',owner:{id:'anon:device',anonymous:true,anonymousId:'device'}});
const setup=(options={})=>new Store({indexedDB:new IDBFactory(),...options});
class Storage{constructor(entries={}){this.data=new Map(Object.entries(entries));}get length(){return this.data.size;}key(i){return [...this.data.keys()][i]??null;}getItem(k){return this.data.get(k)??null;}setItem(){assert.fail('import must never write legacy storage');}}
const principal='50000000-0000-4000-8000-000000000001';
const identity={principalId:principal,supabaseToken:'test-token',accountKey:null};
const timers={setTimer:()=>1,clearTimer:()=>{}};
const makeEngine=(store,transport,options={})=>new Engine({store,transport,enabled:true,identityProvider:async()=>identity,navigator:{onLine:true},...timers,...options});

test('empty startup does not queue remote data; first arrow creates session before arrow',async t=>{
 const store=setup();t.after(()=>store.close());const s=session();s.current=[];
 await store.capture(s);assert.equal((await store.readAll('operations')).length,0);
 s.current=[arrow()];await store.capture(s);
 assert.deepEqual((await store.readAll('operations')).sort((a,b)=>a.sequence-b.sequence).map(o=>o.kind),['session.upsert','arrow.upsert']);
});
test('legacy import is read-only and idempotent for two sessions on the same date',async t=>{
 const store=setup();t.after(()=>store.close());const a=session('legacy-a'),b=session('legacy-b');
 const storage=new Storage({'arbat-training-history':JSON.stringify([a,b]),'arbat-training-current-csv':'original CSV'});
 const original=[...storage.data];await store.importLegacy(storage);const before=await store.readAll('operations');await store.importLegacy(storage);
 assert.equal((await store.readAll('sessions')).length,2);assert.equal(before.length,4);
 assert.deepEqual(await store.readAll('operations'),before);assert.deepEqual([...storage.data],original);
 const ids=(await store.readAll('sessions')).map(s=>s.id);assert.equal(new Set(ids).size,2);assert.ok(ids.every(id=>id!==a.id&&id!==b.id));
});
test('ownerless identical records retain multiplicity and UUIDs across imports/reordering',async t=>{
 const store=setup();t.after(()=>store.close());const s=session();delete s.id;delete s.owner;
 const other={...s,notes:'another legitimate session'};
 let storage=new Storage({'arbat-training-history':JSON.stringify([s,s,other])});await store.importLegacy(storage);
 const ids=(await store.readAll('sessions')).map(s=>s.id).sort();assert.equal(ids.length,3);
 storage=new Storage({'arbat-training-history':JSON.stringify([other,s,s])});await store.importLegacy(storage);
 assert.deepEqual((await store.readAll('sessions')).map(s=>s.id).sort(),ids);
});
test('malformed records are isolated; repeated legacy ID with incompatible arrows needs review',async t=>{
 const store=setup();t.after(()=>store.close());const s=session(),other={...s,current:[arrow(8,2)]};
 const report=await store.importLegacy(new Storage({'arbat-training-current':JSON.stringify(s),'arbat-training-history':JSON.stringify([other]),'arbat-training-2026-10-31':'broken'}));
 assert.ok(report.issues.some(i=>i.code==='invalid_json'));assert.ok(report.issues.some(i=>i.code==='ambiguous_legacy_version'));
 const record=(await store.readAll('sessions'))[0];assert.deepEqual(record.snapshot,s);assert.deepEqual(record.alternatives[0].snapshot,other);
 assert.equal(await store.prepare(record.key,identity),null);
});
test('current and archived versions of one UUID merge without duplicating arrows or losing closure',async t=>{
 const store=setup();t.after(()=>store.close());const s=session();const archived={...s,current:[],completed:[{arrows:[...s.current,arrow(8,2)],notes:''}],endedAt:'2026-11-01T11:00:00Z',csv:'unchanged'};
 await store.importLegacy(new Storage({'arbat-training-current':JSON.stringify(s),'arbat-training-history':JSON.stringify([archived])}));
 const records=await store.readAll('sessions');assert.equal(records.length,1);assert.equal(records[0].projection.arrows.length,2);assert.equal(records[0].projection.closedAt,archived.endedAt.replace('Z','.000Z'));
 const ops=await store.readAll('operations');assert.equal(ops.filter(o=>o.kind==='session.close').length,1);
});
test('no-ID current gets a stable UUID when application normalization adds an ID',async t=>{
 const store=setup();t.after(()=>store.close());const original=session();delete original.id;
 const before=await store.capture(original);const after=await store.capture({...original,id:'new-normalized-id'},{previousSnapshot:original});
 assert.equal(after.id,before.id);assert.equal((await store.readAll('sessions')).length,1);
});
test('arrow UUID survives end move; undo and exact re-add gets a new UUID without mutating Statetty JSON',async t=>{
 const store=setup();t.after(()=>store.close());const s=session(),original=canonical(s);const record=await store.capture(s),arrowId=record.projection.arrows[0].id;
 const end={arrows:copy(s.current),endedAt:'2026-11-01T10:00:01Z',arrowLimit:6};const moved={...s,completed:[end],current:[]};
 const next=await store.capture(moved,{previousSnapshot:s});assert.equal(next.projection.arrows[0].id,arrowId);assert.equal(canonical(s),original);
 const another=session('undo-session');const first=await store.capture(another);const empty={...another,current:[]};await store.capture(empty,{previousSnapshot:another});
 const last=await store.capture(another,{previousSnapshot:empty});assert.notEqual(last.projection.arrows[0].id,first.projection.arrows[0].id);
 assert.ok((await store.readAll('operations')).some(o=>o.kind==='arrow.delete'));
});
test('session snapshot and operations roll back together if transaction cannot write',async t=>{
 const store=setup();t.after(()=>store.close());const s=session();const before=await store.capture(s),ops=await store.readAll('operations');
 await assert.rejects(store.update(before.key,record=>({session:{...record,snapshot:{invalid:true}},add:[{operation_id:'bad',sessionKey:before.key,notCloneable(){}}]})));
 assert.deepEqual((await store.readAll('sessions'))[0].snapshot,s);assert.deepEqual(await store.readAll('operations'),ops);
});
test('concurrent stale tab does not overwrite a newer snapshot',async t=>{
 const db=new IDBFactory();const a=new Store({indexedDB:db}),b=new Store({indexedDB:db});t.after(async()=>{await a.close();await b.close();});
 const original=session();await a.capture(original);const first={...original,current:[...original.current,arrow(8,2)]};await a.capture(first,{previousSnapshot:original});
 const stale={...original,notes:'stale tab'};const result=await b.capture(stale,{previousSnapshot:original});
 assert.equal(result.issue,'concurrent_local_change');assert.deepEqual(result.snapshot,first);assert.deepEqual(result.alternatives[0].snapshot,stale);
});
test('failed legacy write is recovered from IndexedDB after reopening and stale import cannot erase it',async t=>{
 const db=new IDBFactory();let store=new Store({indexedDB:db});const s=session();await store.capture(s);
 const newer={...s,current:[...s.current,arrow(8,2)]};await store.capture(newer,{legacySaved:false,previousSnapshot:s});await store.close();
 store=new Store({indexedDB:db});t.after(()=>store.close());await store.importLegacy(new Storage({'arbat-training-current':JSON.stringify(s)}));
 assert.deepEqual((await store.recoverCurrent()).snapshot,newer);
});
test('disabled and offline engine never obtain credentials or send network requests',async t=>{
 const store=setup();t.after(()=>store.close());await store.capture(session());const transport={send:()=>assert.fail('must not send')};
 const disabled=makeEngine(store,transport,{enabled:false,identityProvider:()=>assert.fail('must not obtain credentials')});
 assert.equal((await disabled.flush()).state,'disabled');
 const offline=makeEngine(store,transport,{navigator:{onLine:false},identityProvider:()=>assert.fail('must not obtain credentials')});assert.equal((await offline.flush()).state,'offline');
 await assert.rejects(createTransport({enabled:false,fetchImpl:()=>assert.fail('must not fetch')}).send({},identity),/sync_disabled/);
});
test('network failure after remote commit replays the same operation envelope after restart',async t=>{
 let clock=1000;const db=new IDBFactory();let store=new Store({indexedDB:db,now:()=>clock});await store.capture(session());
 const receipts=new Map(),received=[];let fail=true;
 const transport={send:async op=>{received.push(copy(op));let result=receipts.get(op.operation_id);if(!result){result={operation_id:op.operation_id,status:'accepted',revision:op.base_revision+1};receipts.set(op.operation_id,result);}if(fail){fail=false;throw new Error('timeout_after_commit');}return {results:[result]};}};
 const first=makeEngine(store,transport,{now:()=>clock});assert.equal((await first.flush()).state,'pending');await store.close();clock+=10000;
 store=new Store({indexedDB:db,now:()=>clock});t.after(()=>store.close());const second=makeEngine(store,transport,{now:()=>clock});assert.equal((await second.flush()).state,'synced');
 assert.deepEqual(received[0],received[1]);assert.equal(receipts.size,2);assert.equal((await store.status()).pending,0);
});
test('conflict retains operation and payload; future flush cannot silently overwrite server',async t=>{
 const store=setup();t.after(()=>store.close());const s=session();await store.capture(s);let sends=0;
 const engine=makeEngine(store,{send:async op=>{sends++;return {results:[{operation_id:op.operation_id,status:'conflict',revision:9}]};}});
 assert.equal((await engine.flush()).state,'error');const queued=await store.readAll('operations');assert.equal(queued.length,2);assert.ok(queued.some(o=>o.state==='blocked'));
 await engine.flush();assert.equal(sends,1);assert.deepEqual((await store.readAll('sessions'))[0].snapshot,s);
});
test('login claims before sending and account switch cannot drain the previous account queue',async t=>{
 const store=setup();t.after(()=>store.close());await store.capture(session());let current={...identity,accountKey:'buddy-A',buddyToken:'buddy-token'};const events=[];
 const engine=makeEngine(store,{claim:async()=>{events.push('claim');return {status:'accepted'};},send:async op=>{events.push('send');current={...current,accountKey:'buddy-B'};return {results:[{operation_id:op.operation_id,status:'accepted',revision:1}]};}},{identityProvider:async()=>current});
 assert.equal((await engine.flush()).state,'auth_required');assert.deepEqual(events,['claim','send']);
 await engine.flush();assert.deepEqual(events,['claim','send']);assert.equal((await store.status()).pending,1);assert.equal((await store.readAll('sessions'))[0].accountKey,'buddy-A');
});
test('two tabs use a durable lease; expiry recovery still preserves operation identity',async t=>{
 let clock=1000;const db=new IDBFactory(),a=new Store({indexedDB:db,now:()=>clock}),b=new Store({indexedDB:db,now:()=>clock});t.after(async()=>{await a.close();await b.close();});
 const s=await a.capture(session());assert.equal(await a.acquireLease('tab-A'),true);assert.equal(await b.acquireLease('tab-B'),false);
 const before=await a.prepare(s.key,identity);clock+=31000;assert.equal(await b.acquireLease('tab-B'),true);assert.deepEqual(await b.prepare(s.key,identity),before);
});
test('live session is prioritized before imported historical sessions',async t=>{
 const store=setup();t.after(()=>store.close());await store.importLegacy(new Storage({'arbat-training-history':JSON.stringify([session('old')])}));const live=await store.capture(session('live'));
 const sent=[];const engine=makeEngine(store,{send:async op=>{sent.push(op.session_id);return {results:[{operation_id:op.operation_id,status:'accepted',revision:op.base_revision+1}]};}});
 await engine.flush();assert.equal(sent[0],live.id);assert.equal(sent[1],live.id);
});

test('claim binds only the anonymous snapshots captured before login completed',async t=>{
 const store=setup();t.after(()=>store.close());const before=await store.capture(session('before'));
 const later=await store.capture(session('after-logout'));
 await store.assignAccount([before.key],principal,'buddy-A');
 const rows=await store.readAll('sessions');assert.equal(rows.find(r=>r.key===before.key).accountKey,'buddy-A');
 assert.equal(rows.find(r=>r.key===later.key).accountKey,null);assert.equal(rows.find(r=>r.key===before.key).snapshot.owner.anonymous,true);
});

test('reload after an interrupted sender retries its lease instead of leaving the queue asleep',async t=>{
 let clock=1000;const store=setup({now:()=>clock});t.after(()=>store.close());await store.capture(session());await store.acquireLease('previous-page');
 const delays=[];const engine=makeEngine(store,{send:async op=>({results:[{operation_id:op.operation_id,status:'accepted',revision:op.base_revision+1}]})},{now:()=>clock,setTimer:(_fn,delay)=>{delays.push(delay);return 1;}});
 assert.equal((await engine.flush()).state,'pending');assert.ok(delays.includes(1000));clock+=31000;
 assert.equal((await engine.flush()).state,'synced');assert.equal((await store.status()).pending,0);
});
test('a wakeup during an active send is rescheduled rather than discarded',async()=>{
 const delays=[];const engine=makeEngine({}, {},{setTimer:(_fn,delay)=>{delays.push(delay);return 1;}});engine.running=true;
 assert.equal(await engine.flush(),null);assert.deepEqual(delays,[250]);engine.stop();
});

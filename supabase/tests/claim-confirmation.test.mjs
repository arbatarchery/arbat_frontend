import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {IDBFactory} from 'fake-indexeddb';
const require=createRequire(import.meta.url),{Store}=require('../../entrenamiento/js/sync-store.js'),{Engine}=require('../../entrenamiento/js/sync-engine.js'),{claimMessage}=require('../../entrenamiento/js/sync-ui.js');
const principal='a1000000-0000-4000-8000-000000000001',other='a1000000-0000-4000-8000-000000000002',owner='a1000000-0000-4000-8000-000000000003';
const identity={principalId:principal,accountKey:'Buddy-A',supabaseToken:'fake-token',buddyToken:'fake-buddy'},accepted={status:'accepted',owner_id:owner,replayed:false,sessions_claimed:3};
test('server-confirmed claims survive reload/replay without counting the same principal twice',async()=>{
 const indexedDB=new IDBFactory();let store=new Store({indexedDB});const first=await store.confirmClaim(identity,accepted);assert.equal(first.sessionsClaimed,3);assert.match(claimMessage(first,'Buddy-A'),/3 sesiones ya respaldadas/);await store.close();
 store=new Store({indexedDB});try{const replay=await store.confirmClaim(identity,{...accepted,replayed:true,sessions_claimed:0});assert.equal(replay.sessionsClaimed,3);const another=await store.confirmClaim({...identity,principalId:other},{...accepted,sessions_claimed:2});assert.equal(another.sessionsClaimed,5);assert.equal((await store.confirmClaim(identity,{...accepted,replayed:true,sessions_claimed:0})).sessionsClaimed,5);}finally{await store.close();}
});
test('unknown replay count stays unknown and is never inferred from local records',async t=>{
 const store=new Store({indexedDB:new IDBFactory()});t.after(()=>store.close());const confirmation=await store.confirmClaim(identity,{...accepted,replayed:true,sessions_claimed:0});assert.equal(confirmation.sessionsClaimed,null);assert.equal(claimMessage(confirmation,'Buddy-A'),'Vinculación con tu cuenta confirmada por el servidor.');
 const mixed=await store.confirmClaim({...identity,principalId:other},accepted);assert.equal(mixed.sessionsClaimed,null);
});
test('unconfirmed, malformed and cross-account claims do not produce a visible success message',async t=>{
 const store=new Store({indexedDB:new IDBFactory()});t.after(()=>store.close());
 for(const result of [{status:'rate_limited'},{...accepted,sessions_claimed:-1},{...accepted,sessions_claimed:1.5},{...accepted,owner_id:'not-a-uuid'},{status:'accepted'}])assert.equal(await store.confirmClaim(identity,result),null);
 assert.equal((await store.readAll('meta')).length,0);const confirmation=await store.confirmClaim(identity,accepted);assert.equal(claimMessage(confirmation,'Buddy-B'),'');assert.equal(claimMessage(confirmation,null),'');
});
test('an accepted empty claim confirms account linkage without falsely asserting transferred sessions',async t=>{
 const store=new Store({indexedDB:new IDBFactory()});t.after(()=>store.close());const result=await store.confirmClaim(identity,{...accepted,sessions_claimed:0});assert.equal(claimMessage(result,'Buddy-A'),'Vinculación con tu cuenta confirmada por el servidor.');
 assert.ok(!JSON.stringify(await store.readAll('meta')).includes('fake-token'));assert.ok(!JSON.stringify(await store.readAll('meta')).includes('fake-buddy'));
});
test('engine emits a notice only after accepted server claim and keeps it through per-arrow ACKs',async t=>{
 const store=new Store({indexedDB:new IDBFactory()});t.after(()=>store.close());await store.capture({id:'local-test',date:'2026-11-02',current:[{label:'9',score:9,x:50,y:50}],completed:[],owner:{anonymous:true,id:'anon:test'}});
 const states=[];const engine=new Engine({store,enabled:true,navigator:{onLine:true},identityProvider:async()=>identity,setTimer:()=>1,clearTimer(){},onState:s=>states.push(s),transport:{claim:async()=>{assert.ok(states.every(s=>!s.claim));return accepted;},sendBatch:async batch=>({results:batch.map(op=>({operation_id:op.operation_id,status:'accepted',revision:op.base_revision+1}))})}});
 assert.equal((await engine.flush()).state,'synced');assert.equal(states.at(-1).claim.sessionsClaimed,3);assert.ok(states.some(s=>s.state==='claiming'&&!s.claim));
});

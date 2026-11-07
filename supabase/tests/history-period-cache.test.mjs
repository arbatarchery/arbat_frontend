import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {PeriodCache}=createRequire(import.meta.url)('../../entrenamiento/historial/js/history-period-cache.js');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(extra={}){const calls=[];return {calls,options:{account:'self',selected:{id:'self'},loadContext:async()=>({can_coach:true}),loadSelected:async u=>{calls.push('selected:'+u.id);return [u.id];},loadRoster:async()=>{calls.push('roster');return {athletes:[{subject:'ana'}]};},loadAll:async()=>{calls.push('all');return ['self','ana'];},partition:(u,data)=>data.filter(id=>id===u.id),...extra}};}
test('selected data resolves before roster and background; switches reuse one transfer',async()=>{
 const priority=deferred(),roster=deferred(),all=deferred(),f=fixture({loadSelected:()=>priority.promise,loadRoster:()=>roster.promise,loadAll:()=>{f.calls.push('all');return all.promise;}}),cache=new PeriodCache(),entry=cache.open('period',f.options);
 let painted=false;const view=entry.get({id:'self'}).then(x=>{painted=true;return x;});
 assert.deepEqual(f.calls,[]);priority.resolve(['personal']);assert.deepEqual(await view,['personal']);assert.equal(painted,true);assert.deepEqual(f.calls,[]);
 const background=entry.preload();roster.resolve({athletes:[{subject:'ana'}]});await entry.metadata;
 const switchA=entry.get({id:'ana'}),switchB=entry.get({id:'ana'});all.resolve(['self','ana']);await background;
 assert.deepEqual(await switchA,['ana']);assert.deepEqual(await switchB,['ana']);assert.deepEqual(await entry.get({allAthletes:true}),['self','ana']);assert.deepEqual(await entry.get({id:'self'}),['personal']);assert.deepEqual(f.calls,['all']);assert.equal(cache.open('period',{}),entry);
});
test('period/account invalidation aborts old work and rejects late data',async()=>{
 const pending=deferred(),f=fixture({loadSelected:()=>pending.promise}),cache=new PeriodCache(),old=cache.open('account-period1',f.options),waiting=old.get({id:'self'});
 const next=cache.open('account-period2',fixture().options);assert.equal(old.signal.aborted,true);pending.resolve(['old']);await assert.rejects(waiting,{name:'AbortError'});assert.deepEqual(await next.get({id:'self'}),['self']);cache.clear();assert.equal(next.signal.aborted,true);
});
test('ordinary accounts never preload other users or receive aggregate data',async()=>{
 const f=fixture({loadContext:async()=>({can_coach:false})}),entry=new PeriodCache().open('p',f.options);await entry.get({id:'self'});await entry.preload();assert.deepEqual(f.calls,['selected:self']);await assert.rejects(entry.get({id:'ana'}),{code:'auth_required'});await assert.rejects(entry.get({allAthletes:true}),{code:'auth_required'});
});
test('background failure keeps selected data available without repeating failed request',async()=>{
 const f=fixture({loadAll:async()=>{f.calls.push('all');throw new Error('offline');}}),entry=new PeriodCache().open('p',f.options);await entry.get({id:'self'});await assert.rejects(entry.preload(),/offline/);assert.deepEqual(await entry.get({id:'self'}),['self']);await assert.rejects(entry.get({id:'ana'}),/offline/);assert.equal(f.calls.filter(x=>x==='all').length,1);
});
test('Todos first in a new period skips individual history fetch',async()=>{
 const f=fixture({selected:{allAthletes:true}}),entry=new PeriodCache().open('p',f.options);assert.deepEqual(await entry.get({allAthletes:true}),['self','ana']);await entry.preload();assert.equal(f.calls.includes('selected:self'),false);assert.equal(f.calls.filter(x=>x==='all').length,1);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {IDBFactory} from 'fake-indexeddb';

const root=new URL('../../',import.meta.url);
const source=await readFile(new URL('entrenamiento/js/entrenamiento.js',root),'utf8');
const scripts=await Promise.all(['sync-store.js','sync-engine.js','sync-bootstrap.js'].map(f=>readFile(new URL(`entrenamiento/js/${f}`,root),'utf8')));
const fixture=JSON.parse(await readFile(new URL('tests/fixtures/statetty/session.json',root),'utf8'));
const plain=v=>JSON.parse(JSON.stringify(v));

async function browser({saved=null,storage=new Map(),indexedDB=new IDBFactory(),identity=null,failWrites=false,now='2026-11-01T14:00:00Z'}={}){
 const elements=new Map(),events=new Map(),telemetry=[];let user=identity,writeFailure=failWrites;
 const element=id=>{if(!elements.has(id))elements.set(id,{id,hidden:false,style:{setProperty(){}},classList:{toggle(){}},handlers:{},
  addEventListener(event,fn){this.handlers[event]=fn;},setAttribute(){},append(){},replaceChildren(){},getScreenCTM(){return {inverse(){return {};}};},
  createSVGPoint(){return {x:0,y:0,matrixTransform(){return this;}};}});return elements.get(id);};
 if(saved)storage.set('arbat-training-current',JSON.stringify(saved));
 const fixed=Date.parse(now);
 class Clock extends Date{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}}
 const context={Date:Clock,Intl,crypto:globalThis.crypto,TextEncoder,TextDecoder,indexedDB,structuredClone,
  CustomEvent:globalThis.CustomEvent,setTimeout:()=>1,clearTimeout(){},navigator:{onLine:true},
  localStorage:{get length(){return storage.size;},key(i){return [...storage.keys()][i]??null;},getItem(k){return storage.get(k)??null;},
   setItem(k,v){if(writeFailure)throw new Error('QuotaExceededError');storage.set(k,v);}},
  document:{addEventListener(){},getElementById:element,querySelectorAll:()=>[],createElement:()=>element(crypto.randomUUID()),createElementNS:()=>element(crypto.randomUUID()),activeElement:null},
  addEventListener(event,fn){if(!events.has(event))events.set(event,[]);events.get(event).push(fn);},
  dispatchEvent(event){for(const fn of events.get(event.type)||[])fn(event);},matchMedia:()=>({matches:false}),
  fetch:()=>assert.fail('disabled browser must not perform network requests'),confirm:()=>true,
  ArbatUser:{get:()=>user},Buddy:{telemetry:{config:{enabled:true},send:payload=>telemetry.push(plain(payload))}}};
 context.window=context;vm.createContext(context);
 for(const script of scripts)vm.runInContext(script,context);
 const instrumented=source.replace(/\}\)\(\);\s*$/,`window.__test={addArrow,finishCurrentEnd,archiveCurrentSession,csvText,andanadaDatos,syncOwner,getState:()=>state};})();`);
 await vm.runInContext(instrumented,context);await context.ArbatTrainingSync.settled();
 return {context,elements,events,telemetry,storage,setUser:value=>{user=value;},failWrites:value=>{writeFailure=value;},async close(){await context.ArbatTrainingSync.settled();await context.ArbatTrainingSync.store.close();}};
}

test('actual training runtime keeps Statetty CSV bytes and telemetry schema unchanged',async t=>{
 // Fixture was generated from the pre-integration commit in America/La_Paz.
 const oldTZ=process.env.TZ;process.env.TZ='America/La_Paz';t.after(()=>{if(oldTZ===undefined)delete process.env.TZ;else process.env.TZ=oldTZ;});
 const b=await browser({saved:fixture,identity:fixture.owner});t.after(()=>b.close());
 assert.equal(b.context.__test.csvText(),await readFile(new URL('tests/fixtures/statetty/session.csv',root),'utf8'));
 const expected=JSON.parse(await readFile(new URL('tests/fixtures/statetty/andanada.json',root),'utf8'));
 assert.deepEqual(plain({event:'entrenamiento.andanada',module:'entrenamiento',data:{andanada:b.context.__test.andanadaDatos(fixture.completed[0],1)}}),expected);
 assert.deepEqual(JSON.parse(b.storage.get('arbat-training-current')),fixture);
});
test('actual add/undo/end/archive hooks preserve legacy objects while queueing every mutation',async t=>{
 const b=await browser();t.after(()=>b.close());const api=b.context.__test;
 api.addArrow({label:'9',score:9,x:56,y:49,recordedAt:'2026-11-01T14:00:01Z'});
 api.addArrow({label:'8',score:8,x:60,y:47,recordedAt:'2026-11-01T14:00:02Z'});
 b.elements.get('undoBtn').handlers.click();api.finishCurrentEnd();api.archiveCurrentSession('manual');
 await b.context.ArbatTrainingSync.settled();
 const archived=JSON.parse(b.storage.get('arbat-training-history'))[0];
 assert.deepEqual(plain(b.context.arbatLastCompletedSession),archived);
 assert.ok(!JSON.stringify(archived).includes('operation_id'));assert.ok(!JSON.stringify(archived).includes('base_revision'));
 const records=await b.context.ArbatTrainingSync.store.readAll('sessions');const stored=records.find(r=>r.snapshot.id===archived.id);
 assert.deepEqual(plain(stored.snapshot),archived);assert.equal(stored.issue,undefined);
 const operations=await b.context.ArbatTrainingSync.store.readAll('operations');
 assert.ok(operations.some(o=>o.kind==='arrow.delete'));assert.equal(operations.filter(o=>o.kind==='session.close').length,1);
 assert.equal(b.telemetry.length,1);assert.equal(b.telemetry[0].data.andanada.flechas.length,1);
});
test('failed legacy write recovers the exact current session after browser reload',async t=>{
 const db=new IDBFactory(),storage=new Map();let b=await browser({indexedDB:db,storage});
 b.failWrites(true);b.context.__test.addArrow({label:'M',score:0,recordedAt:'2026-11-01T14:00:01Z'});await b.context.ArbatTrainingSync.settled();
 const expected=plain(b.context.__test.getState());await b.close();
 b=await browser({indexedDB:db,storage});t.after(()=>b.close());assert.deepEqual(plain(b.context.__test.getState()),expected);
 assert.deepEqual(JSON.parse(storage.get('arbat-training-current')),expected);
});
test('changing accounts archives A before B can record, including logout',async t=>{
 const A={id:'buddy-A',name:'A',anonymous:false},B={id:'buddy-B',name:'B',anonymous:false};
 const b=await browser({identity:A});t.after(()=>b.close());const api=b.context.__test;
 api.addArrow({label:'9',score:9,x:56,y:49,recordedAt:'2026-11-01T14:00:01Z'});
 b.setUser(B);api.syncOwner();assert.equal(api.getState().owner.id,'buddy-B');assert.equal(api.getState().current.length,0);
 const archived=JSON.parse(b.storage.get('arbat-training-history'))[0];assert.equal(archived.owner.id,'buddy-A');assert.equal(archived.endReason,'account-change');
 api.addArrow({label:'8',score:8,x:60,y:47,recordedAt:'2026-11-01T14:00:02Z'});b.setUser(null);api.syncOwner();
 assert.equal(api.getState().owner.anonymous,true);await b.context.ArbatTrainingSync.settled();
 const records=await b.context.ArbatTrainingSync.store.readAll('sessions');
 assert.equal(records.find(r=>r.snapshot.id===archived.id).accountKey,'buddy-A');
 assert.ok(records.some(r=>r.accountKey==='buddy-B'));
});
test('a current session already archived in legacy history is not reopened after partial reset',async t=>{
 const archived={...fixture,endedAt:'2026-11-01T11:00:00Z',csv:'original'};
 const storage=new Map([['arbat-training-history',JSON.stringify([archived])]]);
 const b=await browser({saved:fixture,storage,identity:fixture.owner});t.after(()=>b.close());
 assert.notEqual(b.context.__test.getState().id,fixture.id);assert.equal(b.context.__test.getState().completed.length,0);
});

test('local history reads archived IndexedDB backup after legacy history write failed',async t=>{
 const b=await browser();t.after(()=>b.close());b.context.__test.addArrow({label:'9',score:9,x:56,y:49,recordedAt:'2026-11-01T14:00:01Z'});
 b.failWrites(true);b.context.__test.archiveCurrentSession('manual');await b.context.ArbatTrainingSync.settled();
 assert.equal(b.storage.has('arbat-training-history'),false);
 const historySource=await readFile(new URL('entrenamiento/historial/js/historial.js',root),'utf8');
 const records=await b.context.ArbatTrainingSync.localSessions();const owner=records.find(r=>r.snapshot.endedAt).snapshot.owner.id;
 const context={window:b.context,localSessions:()=>[],sessionsForLocalUser:()=>[],currentUser:()=>({id:owner}),
  readJson:(_key,fallback)=>fallback,HISTORY_KEY:'history',CURRENT_KEY:'current',dateKey:value=>String(value).slice(0,10),arrowsOf:s=>[...(s.completed||[]).flatMap(e=>e.arrows||[]),...(s.current||[])]};
 vm.createContext(context);
 vm.runInContext(historySource.slice(historySource.indexOf('  function normalizeSession('),historySource.indexOf('  function dailyData(')),context);
 const loaded=await context.localSessionsWithBackup({id:owner});assert.equal(loaded.length,1);assert.equal(loaded[0].arrows.length,1);
 assert.equal((await context.localSessionsWithBackup({id:'another-user'})).length,0);
});

test('unavailable IndexedDB preserves legacy saves and reports the backup failure',async t=>{
 const b=await browser({indexedDB:null});t.after(()=>b.close());b.context.__test.addArrow({label:'M',score:0,recordedAt:'2026-11-01T14:00:01Z'});
 await b.context.ArbatTrainingSync.settled();assert.equal(JSON.parse(b.storage.get('arbat-training-current')).current.length,1);
 assert.equal(b.elements.get('syncLocalNotice').hidden,false);assert.match(b.elements.get('syncLocalNotice').textContent,/siguen guardados/);
});
test('failure of both local storage paths remains visible while arrows stay in memory',async t=>{
 const b=await browser({indexedDB:null,failWrites:true});t.after(()=>b.close());b.context.__test.addArrow({label:'M',score:0,recordedAt:'2026-11-01T14:00:01Z'});
 await b.context.ArbatTrainingSync.settled();assert.equal(b.context.__test.getState().current.length,1);
 assert.equal(b.elements.get('syncLocalNotice').hidden,false);assert.match(b.elements.get('syncLocalNotice').textContent,/Mantén esta página abierta/);
 assert.equal(b.context.ArbatTrainingSync.lastStatus.localSaved,false);
});

test('multiple failed legacy writes recover the newest backup rather than its intermediate predecessor',async t=>{
 const db=new IDBFactory(),storage=new Map();let b=await browser({indexedDB:db,storage});b.failWrites(true);
 for(const score of [9,8,7])b.context.__test.addArrow({label:String(score),score,x:55,y:50,recordedAt:`2026-11-01T14:00:0${10-score}Z`});
 await b.context.ArbatTrainingSync.settled();const expected=plain(b.context.__test.getState());await b.close();
 b=await browser({indexedDB:db,storage});t.after(()=>b.close());assert.deepEqual(plain(b.context.__test.getState()),expected);
});
test('an unrelated newer legacy session is preserved when a different backup had failed writes',async t=>{
 const db=new IDBFactory(),storage=new Map();let b=await browser({indexedDB:db,storage});b.failWrites(true);
 b.context.__test.addArrow({label:'9',score:9,x:55,y:50,recordedAt:'2026-11-01T14:00:01Z'});await b.context.ArbatTrainingSync.settled();await b.close();
 const newer={...fixture,id:'another-tab-new-session',completed:[],current:[],owner:{id:'anon:other',anonymous:true}};
 storage.set('arbat-training-current',JSON.stringify(newer));b=await browser({indexedDB:db,storage});t.after(()=>b.close());
 assert.equal(b.context.__test.getState().id,newer.id);
 assert.ok((await b.context.ArbatTrainingSync.localSessions()).some(r=>r.snapshot.current.length===1));
});

test('a session assigned by history claim recovers its owner before logout separation',async t=>{
 const db=new IDBFactory(),storage=new Map();let b=await browser({indexedDB:db,storage});
 b.context.__test.addArrow({label:'9',score:9,x:55,y:50,recordedAt:'2026-11-01T14:00:01Z'});await b.context.ArbatTrainingSync.settled();
 const row=await b.context.ArbatTrainingSync.store.recoverCurrent();await b.context.ArbatTrainingSync.store.assignAccount([row.key],'test-principal','buddy-A');await b.close();
 b=await browser({indexedDB:db,storage});t.after(()=>b.close());assert.equal(b.context.__test.getState().owner.id,'buddy-A');
 b.context.__test.syncOwner();assert.equal(b.context.__test.getState().owner.anonymous,true);
 assert.equal(JSON.parse(storage.get('arbat-training-history'))[0].owner.id,'buddy-A');
});


test('midnight archives a partial end and a late arrow extends the session only one night',async t=>{
 const previousTZ=process.env.TZ;process.env.TZ='America/La_Paz';
 t.after(()=>{if(previousTZ===undefined)delete process.env.TZ;else process.env.TZ=previousTZ;});
 const session=recordedAt=>({...fixture,startedAt:'2026-11-01T22:00:00-04:00',completed:[],current:[{label:'8',score:8,recordedAt}]});
 const early=await browser({saved:session('2026-11-01T23:29:59-04:00'),now:'2026-11-02T00:05:00-04:00'});t.after(()=>early.close());
 const earlyArchive=JSON.parse(early.storage.get('arbat-training-history'))[0];
 assert.equal(earlyArchive.endedAt,'2026-11-02T04:00:00.000Z');
 assert.equal(earlyArchive.completed[0].arrows.length,1);
 const late=await browser({saved:session('2026-11-01T23:30:00-04:00'),now:'2026-11-02T23:50:00-04:00'});t.after(()=>late.close());
 assert.equal(late.context.__test.getState().id,fixture.id);
 assert.equal(late.storage.get('arbat-training-history'),undefined);
 late.context.__test.addArrow({label:'9',score:9});
 await late.context.ArbatTrainingSync.settled();
 const next=await browser({storage:late.storage,now:'2026-11-03T00:00:00-04:00'});t.after(()=>next.close());
 const nextArchive=JSON.parse(next.storage.get('arbat-training-history'))[0];
 assert.equal(nextArchive.endedAt,'2026-11-03T04:00:00.000Z');
 assert.equal(nextArchive.completed[0].arrows.length,2);
});

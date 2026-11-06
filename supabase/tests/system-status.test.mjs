import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
import {createTrainingHandler} from '../functions/_shared/training-handler.mjs';
const D=createRequire(import.meta.url)('../../entrenamiento/js/sync-diagnostics.js');
const id=n=>`f0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('status inheritance, bounded errors and strict diagnostic sanitization',()=>{
 D.clear();assert.equal(D.worst(['ok','unknown','warning','error']),'error');assert.equal(D.worst(['ok','unknown']),'unknown');
 for(let i=0;i<30;i++)D.record({service:'city',action:'https://secret.test/token',code:'PRIVATE_TOKEN',http:503,token:'must not escape'});
 const s=D.snapshot();assert.equal(s.errors.length,20);assert.equal(s.latest.city.code,'unexpected_error');assert.ok(!JSON.stringify(s).includes('PRIVATE_TOKEN'));assert.ok(!JSON.stringify(s).includes('secret.test'));assert.ok(!JSON.stringify(s).includes('must not escape'));
 D.record({service:'city',action:'city.lookup',code:'ok',ms:4000});assert.equal(D.snapshot().latest.city.status,'error');D.record({service:'city',action:'sync',code:'ok'});assert.equal(D.snapshot().latest.city.status,'warning');assert.equal(D.snapshot().errors.length,20);D.clear();
});
test('system status SQL is restricted to verified administrators and contains no personal data',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean not null);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 for(const file of (await readdir(new URL('../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
 for(let n=1;n<=3;n++){await db.query('insert into auth.users values($1,true)',[id(n)]);await db.query('select public.training_claim($1,$2,$3)',[id(n),'buddy-'+n,String(n).repeat(64)]);}
 await db.query("insert into arbat_private.role_assignments(user_id,role,school_id) values($1,'admin','a8ba7000-0000-4000-8000-000000000001'),($2,'superadmin',null)",[id(1),id(3)]);
 const status=n=>db.query('select public.training_system_status($1,$2) result',[id(n),'buddy-'+n]).then(r=>r.rows[0].result);
 await assert.rejects(status(2),e=>e.code==='42501');await assert.rejects(db.query('select public.training_system_status($1,null)',[id(1)]),e=>e.code==='28000');
 for(const n of [1,3]){const r=await status(n);assert.equal(r.status,'accepted');assert.ok(r.database_bytes>0);assert.equal(r.reference_database_bytes,null);assert.equal(r.monthly_metrics_available,false);assert.ok(!JSON.stringify(r).includes('buddy-'));}
 await db.exec('begin;set local role authenticated');await assert.rejects(db.query('select public.training_system_status($1,$2)',[id(1),'buddy-1']),e=>e.code==='42501');await db.exec('rollback');
});
test('system.status does not accept client supplied roles or identity',async()=>{
 const handler=createTrainingHandler({enabled:true,url:'https://db.test',publicKey:'public',serverKey:'server',allowedOrigins:['https://arbatarchery.com'],fetchImpl:()=>assert.fail('must reject before fetching')});
 const req=new Request('https://edge.test',{method:'POST',headers:{Origin:'https://arbatarchery.com',Authorization:'Bearer public','Content-Type':'application/json'},body:JSON.stringify({schema_version:1,action:'system.status',role:'admin'})});
 assert.equal((await handler(req)).status,400);
});

test('another history action cannot clear an unresolved failure',()=>{
 D.clear();D.record({service:'history',action:'history.detail',code:'operation_rejected',http:422});
 D.record({service:'history',action:'history.list',code:'ok',http:200});assert.equal(D.snapshot().latest.history.status,'error');
 D.record({service:'history',action:'history.detail',code:'ok',http:200});assert.equal(D.snapshot().latest.history.status,'ok');assert.equal(D.snapshot().errors.length,1);D.clear();
});

test('panel starts collapsed, inherits failures and clears data after account switch',async()=>{
 const {default:vm}=await import('node:vm');
 class Element{constructor(){this.children=[];this.events={};this.hidden=true;this.open=false;}append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}addEventListener(name,fn){this.events[name]=fn;}}
 const ids={},events={},ready=[];let user={id:'admin-a'},requests=0,clock=Date.now();
 class ClockDate extends Date{static now(){return clock;}}
 const context={console,Date:ClockDate,URL,AbortSignal,AbortController,crypto,Response,setInterval(){},navigator:{onLine:true,clipboard:{writeText:async()=>{}}},CustomEvent:class{constructor(type){this.type=type;}},document:{getElementById:id=>ids[id]??=new Element(),createElement:()=>new Element(),addEventListener:(name,fn)=>ready.push(fn)},addEventListener:(name,fn)=>{(events[name]??=[]).push(fn);},dispatchEvent:e=>{for(const fn of events[e.type]||[])fn(e);},ArbatUser:{get:()=>user},ArbatTrainingSyncConfig:{cityUrl:'https://city.test/'},fetch:async()=>Response.json({proof:'test-proof'}),ArbatTrainingSync:{systemStatus:async()=>{requests++;return {status:'accepted',role:'admin',checked_at:new Date().toISOString(),database_bytes:100000000,management:{status:'partial',code:'management_invalid_autoscale',checked_at:new Date().toISOString(),project:{status:'ACTIVE_HEALTHY'},disk:{status:'unknown'},services:[],autoscale:{status:'unknown'}}};},store:{readAll:async()=>[]},lastStatus:{state:'synced'}}};
 context.window=context;vm.createContext(context);
 vm.runInContext(await readFile(new URL('../../entrenamiento/js/sync-diagnostics.js',import.meta.url),'utf8'),context);
 vm.runInContext(await readFile(new URL('../../entrenamiento/historial/js/system-status.js',import.meta.url),'utf8'),context);
 ready.forEach(fn=>fn());assert.equal(ids.systemStatus.open,false);assert.equal(ids.systemStatus.hidden,true);
 for(const fn of events['arbat:history-role'])fn({detail:{role:'coach'}});assert.equal(requests,0);
 for(const fn of events['arbat:history-role'])fn({detail:{role:'admin'}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests,1);assert.equal(ids.systemStatus.hidden,false);assert.equal(ids.systemStatus.open,false);
 assert.equal(ids.systemStatusIndicator.children[0].textContent,'Correcto');
 const textOf=e=>[e.textContent||'',...(e.children||[]).map(textOf)].join(' ');
 context.ArbatDiagnostics.record({service:'sync',action:'sync',code:'pending'});
 context.ArbatDiagnostics.record({service:'history',action:'history.detail',code:'local_storage_unavailable'});
 assert.equal(ids.systemStatusIndicator.children[0].textContent,'Correcto');
 assert.ok(!textOf(ids.systemStatusAreas).includes('Sin comprobar'));
 assert.ok(!textOf(ids.systemStatusAreas).includes('Transferencia mensual'));
 assert.ok(!textOf(ids.systemStatusAreas).includes('Ejecuciones mensuales'));
 assert.ok(!textOf(ids.systemStatusAreas).includes('Disco y WAL'));
 assert.ok(textOf(ids.systemStatusAreas).includes('API administrativa Correcto'));
 assert.ok(!textOf(ids.systemStatusAreas).includes('management_invalid_autoscale'));
 assert.ok(!textOf(ids.systemStatusAreas).includes('Cola local'));assert.ok(!textOf(ids.systemStatusAreas).includes('local_storage_unavailable'));
 clock+=6*60000;context.dispatchEvent({type:'arbat:diagnostic'});
 assert.ok(!textOf(ids.systemStatusAreas).includes('Advertencia'));
 clock+=55*60000;context.dispatchEvent({type:'arbat:diagnostic'});
 assert.equal(ids.systemStatusIndicator.children[0].textContent,'Advertencia');assert.ok(textOf(ids.systemStatusAreas).includes('más de 1 hora'));

 context.ArbatDiagnostics.record({service:'city',action:'city.lookup',code:'usage_disabled',http:503});
 assert.equal(ids.systemStatusIndicator.children[0].textContent,'Error');
 for(const fn of events['arbat:history-loaded'])fn({detail:{role:null}});assert.equal(ids.systemStatus.hidden,false);
 user={id:'admin-b'};for(const fn of events['buddy:auth-state-changed'])fn();
 assert.equal(ids.systemStatus.hidden,true);assert.equal(ids.systemStatusAreas.children.length,0);assert.equal(context.ArbatDiagnostics.snapshot().errors.length,0);
});

test('server-only snapshots exclude local failures and preserve server HTTP errors',()=>{
 D.clear();D.record({service:'sync',action:'sync',code:'local_storage_unavailable'});D.record({service:'history',action:'history.list',code:'history_network_error'});
 assert.deepEqual(D.snapshot({serverOnly:true}).latest,{});
 D.record({service:'history',action:'history.detail',code:'operation_rejected',http:422});
 assert.equal(D.snapshot({serverOnly:true}).latest.history.http,422);D.clear();
});

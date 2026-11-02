import {chromium} from 'playwright';
import {readFile,stat,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const release=resolve(process.argv[2]||new URL('../../',import.meta.url).pathname);
const origin='https://arbat.test',own='fixture-owner',principal='f0000000-0000-4000-8000-000000000001';
const config=JSON.parse(await readFile(resolve(release,'entrenamiento/config/supabase.public.json'),'utf8'));
assert.equal(config.enabled,true);assert.equal(config.historyEnabled,true);
await assert.rejects(stat(resolve(release,'pruebas/supabase/index.html')),e=>e.code==='ENOENT');
const pages=new Map();
for(const route of ['/entrenamiento/','/entrenamiento/historial/']){
 const md=await readFile(resolve(release,'.'+route+'index.md'),'utf8'),parts=md.split('---'),front=parts[1];
 const css=[...front.slice(front.indexOf('estilos:'),front.indexOf('scripts:')).matchAll(/"([^"]+)"/g)].map(m=>m[1]);
 const scripts=[...front.slice(front.indexOf('scripts:')).matchAll(/"([^"]+)"/g)].map(m=>m[1]);
 for(const file of [...css,...scripts])await stat(resolve(release,'.'+file.split('?')[0]));
 const body=parts.slice(2).join('---').replace('{% include training-captcha.html %}',await readFile(resolve(release,'_includes/training-captcha.html'),'utf8'));
 pages.set(route,`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#fff;font:16px system-ui}.wrap{max-width:1140px;margin:auto;padding:16px}</style>${css.map(s=>`<link rel="stylesheet" href="${s}">`).join('')}</head><body><main class="wrap">${body}</main>${scripts.map(s=>`<script defer src="${s}"></script>`).join('')}</body></html>`);
}
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const context=await browser.newContext({timezoneId:'America/La_Paz',viewport:{width:1280,height:1000}}),page=await context.newPage(),errors=[],packets=[],requests=[];
 page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await context.addInitScript(({own})=>{
  window.__role='superadmin';window.ArbatUser={get:()=>({id:own,name:'Cuenta de prueba'})};
  window.Buddy={auth:{getUser:()=>window.ArbatUser.get(),getAccessToken:()=> 'fake-buddy-token'},telemetry:{config:{enabled:true},send(){}}};
  if(!localStorage.getItem('release-fixture-seeded')){
   const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/La_Paz'}).format(new Date());
   localStorage.setItem('arbat-training-history',JSON.stringify([{id:'fixture-history',date,timezone:'America/La_Paz',owner:{id:own,name:'Cuenta de prueba',anonymous:false},sessionType:'training',startedAt:date+'T14:00:00Z',endedAt:date+'T14:10:00Z',completed:[{arrows:[{label:'9',score:9,recordedAt:date+'T14:01:00Z',x:55,y:50}],endedAt:date+'T14:02:00Z'}],current:[]}]));
   localStorage.setItem('release-fixture-seeded','yes');
  }
 },{own});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===origin){
   if(pages.has(url.pathname))return route.fulfill({contentType:'text/html',body:pages.get(url.pathname)});
   const file=resolve(release,'.'+url.pathname);if(!file.startsWith(release+'/'))return route.abort();
   try{return route.fulfill({contentType:({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.txt':'text/plain'})[extname(file)]||'text/plain',body:await readFile(file)});}catch{return route.fulfill({status:404,body:'Missing asset'});}
  }
  if(url.origin===config.url){
   const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-buddy-access-token','Access-Control-Allow-Methods':'POST, OPTIONS'};
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
   assert.ok(url.pathname.endsWith('/functions/v1/training-sync'),'Buddy must not sign up anonymously');
   const body=req.postDataJSON();requests.push(body.action);const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/La_Paz'}).format(new Date());let result;
   if(body.action==='buddy.session')result={status:'accepted',principal_id:principal,subject:own};
   else if(body.action==='claim')result={status:'accepted',owner_id:principal,sessions_claimed:0,replayed:false};
   else if(body.action==='sync'){packets.push(body);result={results:body.operations.map(op=>({operation_id:op.operation_id,status:'accepted',revision:op.base_revision+1}))};}
   else if(body.action==='history.context')result={status:'accepted',role:'superadmin',can_coach:true,can_manage:true};
   else if(body.action==='history.coach')result={status:'accepted',role:'superadmin',scope_hash:'a'.repeat(32),arrows:25,days:[{date,arrows:25,has_competition:true}],athletes:[{id:'fixture-student',subject:'student',name:'Arquero de prueba',last_session_at:date+'T16:00:00Z',last_session_date:date,day_arrows:25,day_average:8.4}],next_cursor:null};
   else if(body.action==='history.list')result={status:'accepted',sessions:[],next_cursor:null};
   else assert.fail('unexpected API action');
   return route.fulfill({headers,json:result});
  }
  assert.fail('unexpected external request '+url.origin);
 });
 await page.goto(origin+'/entrenamiento/');try{await page.waitForFunction(()=>window.ArbatTrainingSync?.lastStatus.state==='synced');}catch(e){console.log(JSON.stringify({errors,requests,status:await page.evaluate(()=>window.ArbatTrainingSync?.lastStatus)}));throw e;}
 await page.locator('#target').click({position:{x:150,y:150}});await page.waitForFunction(()=>window.ArbatTrainingSync.lastStatus.state==='synced'&&window.ArbatTrainingSync.lastStatus.pending===0);
 assert.ok(packets.flatMap(p=>p.operations).some(op=>op.kind==='arrow.upsert'));assert.ok(packets.flatMap(p=>p.operations).some(op=>op.kind==='session.upsert'));
 assert.equal(await page.locator('.target-panel').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(32, 40, 49)');
 assert.equal(await page.locator('.heading h1').evaluate(e=>getComputedStyle(e).color),'rgb(17, 17, 17)');
 const legacy=await page.evaluate(()=>localStorage.getItem('arbat-training-history'));
 await page.goto(origin+'/entrenamiento/historial/');try{await page.locator('#coachData').waitFor({state:'visible'});}catch(e){console.log(JSON.stringify({errors,requests,detail:await page.evaluate(async()=>{let error;try{await window.ArbatTrainingSync.historyContext({});}catch(e){error=e.stack;}return {message:document.getElementById('coachMessage').textContent,error};})}));throw e;}
 assert.equal(await page.locator('#coachArrows').textContent(),'25');assert.match(await page.locator('#coachRoster').textContent(),/Arquero de prueba/);
 await page.locator('.activity-day--competition').waitFor({state:'visible'});
 assert.equal(await page.locator('.activity-day--competition .activity-day-dots .activity-kind').count(),2);
 assert.equal(await page.evaluate(()=>localStorage.getItem('arbat-training-history')),legacy);
 assert.equal(await page.locator('#kpiArrows').textContent(),'2');
 assert.ok(requests.includes('history.context'));assert.ok(requests.includes('history.coach'));assert.ok(requests.includes('history.list'));
 await page.setViewportSize({width:390,height:900});
 await mkdir(resolve(release,'output/release-check'),{recursive:true});await page.screenshot({path:resolve(release,'output/release-check/historial.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('Release: rutas normales, activos publicados, respaldo por flecha, importación local, panel, calendario mixto y conservación de JSON correctos. No se contactó al servidor real.');
}finally{await browser.close();}

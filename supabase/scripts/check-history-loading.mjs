import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {root} from './preview-page.mjs';
const md=await readFile(resolve(root,'entrenamiento/historial/index.md'),'utf8');
const body=md.split('---').slice(2).join('---').replace('{% include training-captcha.html %}','');
const css=await readFile(resolve(root,'entrenamiento/historial/css/historial.css'),'utf8');
const script=await readFile(resolve(root,'entrenamiento/historial/js/historial.js'),'utf8');
const activity=await readFile(resolve(root,'entrenamiento/historial/js/history-activity.js'),'utf8');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const context=await browser.newContext({timezoneId:'America/La_Paz'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.clock.install();
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"><style>body{background:white;font:16px system-ui}${css}</style></head><body>${body}</body></html>`}));
 await page.goto('https://arbat.test/entrenamiento/historial/');
 await page.evaluate(()=>{
  window.__checking=true;window.__tokenReady=false;window.__user={id:'me',name:'Raúl'};window.__mode='pending';window.__contextCalls=0;window.__historyCalls=0;
  window.ArbatUser={get:()=>window.__user};
  window.Buddy={auth:{getUser:()=>window.__user,getState:()=>({checking:window.__checking}),getAccessToken:()=>window.__user&&window.__tokenReady?'mock-buddy-token':null}};
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/La_Paz'}).format(new Date());
  const session={id:'own',date,sessionType:'training',completed:[{arrows:[{label:'9',score:9}]}],current:[]};
  window.ArbatTrainingSync={historyEnabled:true,localSessions:async()=>[],
   historyContext:async()=>{window.__contextCalls++;return {status:'accepted',role:'superadmin',can_coach:true};},
   coachOverview:async options=>{options.onProgress({athletes:3});return {role:'superadmin',arrows:36,days:[],athletes:[]};},
   remoteHistory:async options=>{
    window.__historyCalls++;
    if(!window.__user)throw Object.assign(Error('auth_required'),{code:'auth_required'});
    if(window.__mode==='fail')throw Object.assign(Error('no connection'),{code:'history_network_error'});
    window.__progress=(sessions,ends,arrows)=>options.onProgress(sessions,{sessions,ends,arrows});
    return new Promise(resolve=>{window.__finish=()=>resolve({sessions:[session]});});
   }};
  window.ArbatSyncHistory={merge:(_local,remote)=>remote.sessions};
 });
 await page.addScriptTag({content:activity});await page.addScriptTag({content:script});
 await page.clock.runFor(25000);
 assert.equal(await page.locator('#historyLoading').isVisible(),true);
 assert.equal(await page.locator('#historySyncNotice').isVisible(),false);
 assert.equal(await page.evaluate(()=>window.__contextCalls),0); // even a cached user/token waits for auth checking to finish
 assert.equal(await page.locator('#dataScope').textContent(),'Cargando datos de la nube.');
 await page.evaluate(()=>{window.__checking=false;window.dispatchEvent(new CustomEvent('buddy:auth-ready'));});
 await page.clock.runFor(1000);assert.equal(await page.evaluate(()=>window.__contextCalls),0);
 await page.evaluate(()=>{window.__tokenReady=true;window.dispatchEvent(new CustomEvent('buddy:auth-ready'));});
 await page.waitForFunction(()=>typeof window.__progress==='function');
 assert.match(await page.locator('#historyLoadingStage').textContent(),/Conexión con la nube confirmada/);
 await page.evaluate(()=>window.__progress(0,3,18));
 assert.match(await page.locator('#historyLoadingCounts').textContent(),/Andanadas: 3 · Flechas: 18 · Arqueros: 3/);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('buddy:user-updated')));
 assert.equal(await page.evaluate(()=>window.__historyCalls),1); // no restart/reset for redundant auth events
 await page.evaluate(()=>window.__progress(1,6,36));
 assert.match(await page.locator('#historyLoadingCounts').textContent(),/Sesiones: 1 · Andanadas: 6 · Flechas: 36/);
 await page.evaluate(()=>window.__finish());await page.waitForFunction(()=>document.getElementById('historyLoading').hidden);
 assert.equal(await page.locator('#historySyncNotice').isVisible(),false);
 assert.equal(await page.locator('#athleteRole').textContent(),'SuperAdmin');
 // A genuine failure remains an error; a fresh attempt clears it immediately.
 await page.evaluate(async()=>{window.__mode='fail';await window.ArbatTrainingHistory.render();});
 assert.equal(await page.locator('#historySyncNotice').isVisible(),true);
 assert.match(await page.locator('#historySyncDiagnostic').textContent(),/history_network_error/);
 await page.evaluate(()=>{window.__mode='pending';window.__progress=null;window.__render=window.ArbatTrainingHistory.render();});
 await page.waitForFunction(()=>typeof window.__progress==='function');
 assert.equal(await page.locator('#historyLoading').isVisible(),true);assert.equal(await page.locator('#historySyncNotice').isVisible(),false);
 await page.evaluate(()=>window.__finish());await page.waitForFunction(()=>document.getElementById('historyLoading').hidden);
 // Confirmed signed-out devices with no cloud identity are local-only, not a false authentication failure.
 await page.evaluate(async()=>{window.__user=null;await window.ArbatTrainingHistory.render();});
 assert.equal(await page.locator('#historySyncNotice').isVisible(),false);assert.equal(await page.locator('#historyLoading').isVisible(),false);
 // Waiting is bounded; offline also ends with a real local-data message.
 await page.evaluate(()=>{window.__checking=true;window.__render=window.ArbatTrainingHistory.render();});
 await page.clock.runFor(45001);await page.waitForFunction(()=>document.getElementById('historyLoading').hidden);
 assert.match(await page.locator('#historySyncDiagnostic').textContent(),/history_auth_timeout/);
 await context.setOffline(true);await page.evaluate(()=>window.ArbatTrainingHistory.render());
 assert.match(await page.locator('#historySyncMessage').textContent(),/Sin conexión/);
 assert.deepEqual(errors,[]);
 console.log('PASS: sesión lenta sin falso error, conexión verificada, contadores progresivos, eventos sin reinicios, reintento limpio, error real, anónimo, plazo máximo y sin conexión.');
}finally{await browser.close();}

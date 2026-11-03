import {chromium} from 'playwright';import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';import assert from 'node:assert/strict';import {root} from './preview-page.mjs';
const md=await readFile(resolve(root,'entrenamiento/historial/index.md'),'utf8'),body=md.split('---').slice(2).join('---').replace('{% include training-captcha.html %}','');
const css=await readFile(resolve(root,'entrenamiento/historial/css/historial.css'),'utf8'),script=await readFile(resolve(root,'entrenamiento/historial/js/historial.js'),'utf8'),activity=await readFile(resolve(root,'entrenamiento/historial/js/history-activity.js'),'utf8');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`}));await page.goto('https://arbat.test/entrenamiento/historial/');
 await page.evaluate(()=>{
  window.__role='coach';window.__holdContext=false;window.__holdOverview=true;window.__reads=[];window.__counts=[];
  window.ArbatUser={get:()=>({id:'me',name:'Entrenador'})};window.Buddy={auth:{getUser:()=>window.ArbatUser.get(),getState:()=>({checking:false}),getAccessToken:()=>'mock-token'}};
  const date=new Intl.DateTimeFormat('sv-SE').format(new Date());
  const sessions=count=>[{id:'session',date,sessionType:'training',completed:[{arrows:Array.from({length:count},()=>({score:9,label:'9'}))}],current:[]}];
  window.ArbatTrainingSync={historyEnabled:true,localSessions:async()=>[],
   historyContext:async()=>window.__holdContext?new Promise(resolve=>{window.__completeContext=resolve;}):{role:window.__role,can_coach:window.__role==='coach'},
   coachOverview:async options=>{
    const result={role:'coach',arrows:18,days:[],athletes:[{id:'student',subject:'student',name:'Alumno',last_session_date:date,day_arrows:18,day_average:9}]};
    if(window.__holdOverview)return new Promise(resolve=>{window.__completeOverview=()=>{options.onProgress({athletes:1});resolve(result);};});
    return result;
   },
   remoteHistory:async options=>{window.__reads.push(options.targetSubject||'own');return {sessions:sessions(options.targetSubject?18:2)};}
  };window.ArbatSyncHistory={merge:(_local,remote)=>remote.sessions};
 });
 await page.addScriptTag({content:activity});await page.addScriptTag({content:script});
 await page.waitForFunction(()=>window.__reads.length===1&&typeof window.__completeOverview==='function');
 assert.equal(await page.locator('#historyLoading').isVisible(),true);assert.equal(await page.locator('#kpiArrows').textContent(),'0'); // personal request ran while overview was pending, neither result published early
 await page.evaluate(()=>{window.__holdOverview=false;window.__completeOverview();});await page.waitForFunction(()=>document.getElementById('historyLoading').hidden);
 assert.equal(await page.locator('#kpiArrows').textContent(),'2');
 await page.evaluate(()=>{
  window.__holdContext=true;
  new MutationObserver(()=>window.__counts.push(document.getElementById('kpiArrows').textContent)).observe(document.getElementById('kpiArrows'),{childList:true,subtree:true,characterData:true});
 });
 await page.locator('#coachRoster button').click();await page.waitForFunction(()=>window.__reads.includes('student')&&typeof window.__completeContext==='function');
 assert.equal(await page.locator('#kpiArrows').textContent(),'2');
 await page.evaluate(()=>{window.__role='user';window.__holdContext=false;window.__completeContext({role:'user',can_coach:false});});await page.waitForFunction(()=>document.getElementById('historyLoading').hidden);
 assert.equal(await page.locator('#athleteName').textContent(),'Entrenador');assert.equal(await page.locator('#athleteRole').textContent(),'Arquero');assert.equal(await page.locator('#kpiArrows').textContent(),'2');
 assert.equal(await page.locator('#coachPanel').isVisible(),false);assert.equal(await page.evaluate(()=>window.__reads.at(-1)),'own');assert.equal(await page.evaluate(()=>window.__counts.includes('18')),false);
 assert.deepEqual(errors,[]);console.log('PASS: historial y panel se consultan en paralelo; un cambio de permisos descarta el resultado del alumno antes de mostrarlo.');
}finally{await browser.close();}

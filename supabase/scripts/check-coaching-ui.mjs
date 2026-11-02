import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {root} from './preview-page.mjs';
const source=await readFile(resolve(root,'entrenamiento/historial/index.md'),'utf8');
const body=source.split('---').slice(2).join('---').replace('{% include training-captcha.html %}','');
const css=await readFile(resolve(root,'entrenamiento/historial/css/historial.css'),'utf8');
const script=await readFile(resolve(root,'entrenamiento/historial/js/historial.js'),'utf8');
const activity=await readFile(resolve(root,'entrenamiento/historial/js/history-activity.js'),'utf8');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1280,height:1000},timezoneId:'America/La_Paz'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:20px;font-family:system-ui;background:#fff}main{max-width:1100px;margin:auto}${css}</style></head><body><main>${body}</main></body></html>`}));
 await page.goto('https://arbat.test/entrenamiento/historial/');
 await page.evaluate(()=>{
  const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/La_Paz'}).format(new Date());
  window.__kind='superadmin';window.__fail=false;window.__historyFail=false;window.__ranges=[];
  window.ArbatUser={get:()=>({id:'me',name:'Raúl',roles:['superadmin']})};
  window.Buddy={auth:{getUser:()=>window.ArbatUser.get()},archerySchool:{getUsers:()=>{throw Error('unscoped directory must not be called');}}};
  window.ArbatTrainingSync={historyEnabled:true,
   historyContext:async()=>({role:window.__kind,can_coach:window.__kind!=='user'}),
   coachOverview:async options=>{window.__ranges.push(options);if(window.__fail)throw Error('offline');return {role:window.__kind,arrows:123,days:[{date,arrows:123,has_competition:true}],athletes:[{id:'student',subject:'student-subject',name:'<img src=x onerror=alert(1)>',last_session_at:date+'T16:30:00Z',last_session_date:date,day_arrows:30,day_average:8.5}]};},
   remoteHistory:async()=>{if(window.__historyFail)throw Object.assign(new Error('private-credential-do-not-display'),{code:'invalid_history_parent'});return {sessions:[{id:'own',date,sessionType:'training',startedAt:date+'T10:00:00Z',completed:[{arrows:[{score:9,label:'9'}]}],current:[]}]};},localSessions:async()=>[]};
  window.ArbatSyncHistory={merge:(_local,remote)=>remote.sessions};
 });
 await page.addScriptTag({content:activity});await page.addScriptTag({content:script});
 await page.locator('#coachData').waitFor({state:'visible'});
 assert.equal(await page.locator('#coachArrows').textContent(),'123');
 await page.waitForFunction(()=>document.getElementById('athleteRole').textContent==='SuperAdmin');
 assert.match(await page.locator('#coachRoster').textContent(),/30.*8,50/);
 assert.equal(await page.locator('#coachRoster img').count(),0);
 const mixed=page.locator('.activity-day--competition');assert.equal(await mixed.count(),1);
 assert.equal(await mixed.locator('.activity-day-dots .activity-kind').count(),2);
 assert.equal(await mixed.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
 await page.locator('#periodSelect').selectOption('7');await page.waitForFunction(()=>window.__ranges.at(-1)?.from&&window.__ranges.length>=2);
 await page.locator('#coachRoster button').click();await page.waitForFunction(()=>document.getElementById('athleteName').textContent.includes('<img'));
 assert.equal(await page.locator('#studentActivityLegend').isVisible(),false);assert.equal(await page.locator('#athleteRole').textContent(),'Arquero');
 await page.evaluate(async()=>{window.__kind='user';await window.ArbatTrainingHistory.render();});
 assert.equal(await page.locator('#coachPanel').isVisible(),false);assert.equal(await page.locator('#athletePicker').isVisible(),false);
 assert.equal(await page.locator('#athleteName').textContent(),'Raúl');
 await page.evaluate(async()=>{window.__kind='superadmin';window.__historyFail=true;await window.ArbatTrainingHistory.render();});
 assert.equal(await page.locator('#athleteRole').textContent(),'SuperAdmin');
 assert.equal(await page.locator('#historySyncDiagnostic').textContent(),'Diagnóstico: invalid_history_parent');
 assert.ok(!(await page.locator('#historySyncNotice').textContent()).includes('private-credential'));
 assert.equal(await page.locator('#historySyncRetry').evaluate(e=>getComputedStyle(e).color),'rgb(0, 0, 0)');
 await page.evaluate(()=>{window.__historyFail=false;});
 await page.evaluate(async()=>{window.__kind='coach';window.__fail=true;await window.ArbatTrainingHistory.render();});
 assert.equal(await page.locator('#coachData').isVisible(),false);assert.equal(await page.locator('#coachRoster').textContent(),'');assert.equal(await page.locator('#historySyncNotice').isVisible(),true);
 await page.evaluate(async()=>{window.__fail=false;await window.ArbatTrainingHistory.render();});
 await page.setViewportSize({width:390,height:900});await page.locator('#coachData').waitFor({state:'visible'});
 assert.equal(await mixed.locator('.activity-day-dots .activity-kind').count(),2);
 await mkdir(resolve(root,'output/coaching'),{recursive:true});await page.screenshot({path:resolve(root,'output/coaching/historial-mobile.png'),fullPage:true});
 await page.setViewportSize({width:1280,height:1000});await page.screenshot({path:resolve(root,'output/coaching/historial-desktop.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('Panel, roles, filtro, calendario de tres colores, revocación, errores y móvil: correctos.');
}finally{await browser.close();}

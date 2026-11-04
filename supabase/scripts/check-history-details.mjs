import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const body=(await read('entrenamiento/historial/index.md')).split('---').slice(2).join('---').replace('{% include training-captcha.html %}','');
const css=await read('entrenamiento/historial/css/historial.css');
const scripts=await Promise.all(['history-activity.js','history-details.js','historial.js'].map(f=>read('entrenamiento/historial/js/'+f)));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 for(const width of [320,390,859,860,1440]){
  const mobile=width<860;
  const page=await browser.newPage({viewport:{width,height:1000},timezoneId:'America/La_Paz'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`}));
  await page.goto('https://arbat.test/entrenamiento/historial/');
  await page.evaluate(()=>{
   window.__user=null;window.ArbatUser={get:()=>window.__user,login:()=>{window.__login=true;}};
   window.Buddy={auth:{getAccessToken:()=>window.__user?'token':null,getState:()=>({checking:false})}};
   const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/La_Paz'}).format(new Date());
   window.__session={id:'own',date,startedAt:date+'T12:00:00Z',sessionType:'training',shootingDistance:'18 m',notes:'<script>bad</script>',completed:[{endedAt:date+'T12:10:00Z',arrows:[{label:'9',score:9,x:50,y:50,recordedAt:date+'T12:01:00Z'}]}],current:[]};
   localStorage.setItem('arbat-training-history',JSON.stringify([window.__session]));
   window.ArbatTrainingSync={historyEnabled:false,localSessions:async()=>[]};
  });
  for(const script of scripts)await page.addScriptTag({content:script});
  // addScriptTag is used after DOMContentLoaded in this isolated fixture.
  await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
  await page.waitForFunction(()=>document.getElementById('kpiArrows').textContent==='1');
  assert.equal(await page.locator('#historyLogin').isVisible(),true);assert.equal(await page.locator('#historyDetails').isVisible(),false);
  await page.locator('#historyLoginButton').click();assert.equal(await page.evaluate(()=>window.__login),true);
  await page.evaluate(()=>{window.__user={id:'me',name:'Arquero'};window.dispatchEvent(new Event('buddy:auth-ready'));});
  await page.waitForFunction(()=>document.getElementById('historyDetails').hidden===!matchMedia('(min-width: 860px)').matches);
  if(mobile){
   assert.equal(await page.locator('#historyDetails').isVisible(),false);
   assert.equal(await page.locator('#historyDesktopInvite').isVisible(),true);
   assert.match(await page.locator('#historyDesktopInvite').textContent(),/computadora.*inicia sesión/);
   assert.equal(await page.locator('#historySessionTable tbody tr').count(),0);
   await page.setViewportSize({width:1024,height:1000});
  }
  await page.waitForFunction(()=>document.getElementById('historySessionTable').querySelector('tbody tr'));
  assert.equal(await page.locator('#historyLogin').isVisible(),false);
  assert.equal(await page.locator('#historyDetails').evaluate(n=>n.open),!mobile);
  assert.equal(await page.locator('#historyDesktopInvite').isVisible(),false);
  if(mobile)await page.locator('#historyDetails>summary').click();
  await page.locator('#historySessionTable details>summary').first().click();
  await page.waitForFunction(()=>document.querySelector('#historySessionTable details').dataset.built==='1');
  assert.ok((await page.locator('#historySessionTable').textContent()).includes('<script>bad</script>'));
  assert.equal(await page.locator('#historySessionTable script').count(),0);
  assert.equal(await page.locator('#usagePanel').isVisible(),false);
  await page.selectOption('#detailType','competition');assert.match(await page.locator('#historySessionTable').textContent(),/No hay sesiones/);
  await page.selectOption('#detailType','');assert.equal(await page.locator('#historySessionTable tbody>tr').count(),1);
  for(const selector of ['#historySummary','.activity-card','#historyCharts','#historyDetails']){
   const block=page.locator(selector),summary=page.locator(selector+'>summary');
   if(!await block.evaluate(e=>e.open))await summary.click();
   await summary.click();assert.equal(await block.evaluate(e=>e.open),false);
   await summary.press('Enter');assert.equal(await block.evaluate(e=>e.open),true);
  }
  await page.setViewportSize({width:390,height:1000});
  await page.waitForFunction(()=>document.getElementById('historyDetails').hidden);
  assert.equal(await page.locator('#historySessionTable tbody tr').count(),0);
  assert.equal(await page.locator('#historyDesktopInvite').isVisible(),true);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: anonymous/login, desktop/mobile, lazy session/arrow detail, filters and safe notes.');
}finally{await browser.close();}

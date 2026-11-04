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
 for(const mobile of [false,true]){
  const page=await browser.newPage({viewport:{width:mobile?390:1440,height:1000},timezoneId:'America/La_Paz'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
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
  await page.waitForFunction(()=>document.getElementById('historySessionTable').querySelector('tbody tr'));
  assert.equal(await page.locator('#historyLogin').isVisible(),false);
  assert.equal(await page.locator('#historyDetails').evaluate(n=>n.open),!mobile);
  if(mobile)await page.locator('#historyDetails>summary').click();
  await page.locator('#historySessionTable details>summary').first().click();
  await page.waitForFunction(()=>document.querySelector('#historySessionTable details').dataset.built==='1');
  assert.ok((await page.locator('#historySessionTable').textContent()).includes('<script>bad</script>'));
  assert.equal(await page.locator('#historySessionTable script').count(),0);
  assert.equal(await page.locator('#usagePanel').isVisible(),false);
  await page.selectOption('#detailType','competition');assert.match(await page.locator('#historySessionTable').textContent(),/No hay sesiones/);
  await page.selectOption('#detailType','');assert.equal(await page.locator('#historySessionTable tbody>tr').count(),1);
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: anonymous/login, desktop/mobile, lazy session/arrow detail, filters and safe notes.');
}finally{await browser.close();}

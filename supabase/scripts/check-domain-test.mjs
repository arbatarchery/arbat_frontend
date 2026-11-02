import {chromium} from 'playwright';import {createServer} from 'node:http';import {readFile,mkdtemp,rm} from 'node:fs/promises';import {resolve,extname,join} from 'node:path';import {tmpdir} from 'node:os';import assert from 'node:assert/strict';import {buildDomainTest} from './build-domain-test.mjs';
const destination=await mkdtemp(join(tmpdir(),'arbat-domain-browser-'));await buildDomainTest(destination);
const route='/pruebas/supabase/',server=createServer(async(req,res)=>{
 try{const path=new URL(req.url,'http://localhost').pathname;if(!path.startsWith(route))throw Error();const file=resolve(destination,path.slice(route.length)+(path.endsWith('/')?'index.html':''));if(!file.startsWith(destination+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'})[extname(file)]||'text/plain');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[],external=[],packets=[];let signups=0,claims=0,bridge=0;
 await page.clock.install();
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('arbat-training-current',JSON.stringify({id:'preserve-real-training'})));
 await page.route('**/*',async handler=>{
  const url=handler.request().url();if(url.startsWith(origin))return handler.continue();
  if(url.startsWith('https://challenges.cloudflare.com/turnstile/v0/api.js'))return handler.fulfill({contentType:'text/javascript',body:`window.turnstile={render(_el,options){queueMicrotask(()=>options['error-callback']('110200'));return 'fake-widget';},remove(){}};`});
  if(url.includes('statetty.com/assets/buddy/modules/')){
   if(url.includes('/config.js'))return handler.fulfill({contentType:'text/javascript',body:''});
   if(url.includes('buddy_telemetry.js'))return handler.fulfill({contentType:'text/javascript',body:'window.Buddy={telemetry:{send:()=>{window.__fakeTelemetry=(window.__fakeTelemetry||0)+1},request:()=>{}}};'});
   if(url.includes('buddy_auth.js'))return handler.fulfill({contentType:'text/javascript',body:`let user=localStorage.getItem('test-only-buddy-login')?{id:'test-only-buddy-user',name:'Prueba'}:null;window.__setTestBuddy=value=>{user=value;window.dispatchEvent(new CustomEvent('buddy:auth-state-changed'));};window.Buddy.auth={getUser:()=>user,getAccessToken:()=>user?'test-only-buddy':null,getState:()=>({busy:false}),requestLogin:async()=>{user={id:'test-only-buddy-user',name:'Prueba'};localStorage.setItem('test-only-buddy-login','1');window.dispatchEvent(new CustomEvent('buddy:auth-state-changed'));}};window.dispatchEvent(new CustomEvent('buddy:auth-ready'));`});
  }
  if(url.includes('.supabase.co/')){
   const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-buddy-access-token','Access-Control-Allow-Methods':'POST, OPTIONS'};
   if(handler.request().method()==='OPTIONS')return handler.fulfill({status:204,headers});
   if(url.includes('/auth/v1/signup')){signups++;return handler.abort();}
   const body=handler.request().postDataJSON(),id='f0000000-0000-4000-8000-000000000001';
   if(body.action==='buddy.session'){bridge++;return handler.fulfill({headers,json:{status:'accepted',principal_id:id,subject:'test-only-buddy-user'}});}
   if(body.action==='claim'){claims++;return handler.fulfill({headers,json:{status:'accepted',owner_id:id,replayed:claims>1,sessions_claimed:claims===1?3:0}});}
   if(body.action==='sync'){packets.push(body.operations);return handler.fulfill({headers,json:{results:body.operations.map(op=>({operation_id:op.operation_id,status:'accepted',revision:op.base_revision+1}))}});}
  }
  external.push(url.split('?')[0]);return handler.abort();
 });
 await page.goto(origin+route);
 assert.equal(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
 assert.equal(await page.locator('h1').evaluate(e=>getComputedStyle(e).color),'rgb(17, 17, 17)');
 for(const panel of ['.target-panel','.control-panel'])assert.equal(await page.locator(panel).evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(32, 40, 49)');
 assert.equal(await page.locator('#syncDesktopStatus').evaluate(e=>getComputedStyle(e).color),'rgb(17, 17, 17)');
 await page.locator('#target').click({position:{x:150,y:150}});await page.waitForFunction(()=>window.ArbatTrainingSync.lastStatus.error==='captcha_required');
 assert.equal(signups,0);assert.equal(await page.locator('#trainingCaptchaDialog').evaluate(e=>e.open),false);
 await page.locator('#syncDesktopStatus').click();await page.locator('#syncRetry').click();await page.locator('#trainingCaptchaMessage').filter({hasText:'110200'}).waitFor();assert.equal(await page.locator('#trainingCaptchaDialog').evaluate(e=>e.open),true);await page.locator('#syncDesktopText').filter({hasText:'no autorizada'}).waitFor();assert.equal(signups,0);await page.locator('#trainingCaptchaDialog form button').click();await page.locator('#syncClose').click();
 await page.locator('#previewBuddyStart').click();await page.locator('#previewBuddyEmail').waitFor({state:'visible'});await page.locator('#previewBuddyEmail').fill('test@example.invalid');await page.locator('#previewBuddySend').click();
 await page.waitForFunction(()=>window.ArbatTrainingSync.lastStatus.state==='synced'&&window.ArbatTrainingSync.lastStatus.pending===0);
 assert.equal(bridge,1);assert.equal(claims,1);await page.locator('#syncClaimNotice').filter({hasText:'3 sesiones ya respaldadas'}).waitFor();assert.equal(signups,0);assert.ok(packets.flat().some(op=>op.kind==='arrow.upsert'));
 await page.clock.fastForward(5000);assert.equal(await page.locator('#syncClaimNotice').isVisible(),true);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('arbat:sync-state',{detail:window.ArbatTrainingSync.lastStatus})));
 await page.clock.fastForward(5000);assert.equal(await page.locator('#syncClaimNotice').isVisible(),false);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('arbat:sync-state',{detail:window.ArbatTrainingSync.lastStatus})));assert.equal(await page.locator('#syncClaimNotice').isVisible(),false);
 await page.locator('#target').click({position:{x:150,y:150}});await page.evaluate(()=>window.ArbatTrainingSync.settled());await page.waitForFunction(()=>window.ArbatTrainingSync.lastStatus.state==='synced'&&window.ArbatTrainingSync.lastStatus.pending===0);
 await page.locator('#finishBtn').click();await page.evaluate(()=>window.ArbatTrainingSync.settled());await page.waitForFunction(()=>window.ArbatTrainingSync.lastStatus.state==='synced'&&window.ArbatTrainingSync.lastStatus.pending===0);
 const saved=await page.evaluate(async()=>({native:JSON.parse(localStorage.getItem('arbat-training-current')),rows:(await window.ArbatTrainingSync.store.readAll('sessions')).filter(r=>r.sequence),telemetry:window.__fakeTelemetry||0,config:window.ArbatTrainingSyncConfig}));
 assert.equal(saved.native.id,'preserve-real-training');assert.equal(saved.config.storagePrefix,'arbat-supabase-domain-test-v1:');assert.equal(saved.rows.length,1);assert.ok(saved.rows.every(r=>r.accountKey==='test-only-buddy-user'));assert.equal(saved.telemetry,0);assert.equal(signups,0);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 await page.reload();await page.waitForFunction(()=>window.ArbatTrainingSync.lastStatus.state==='synced'&&window.ArbatTrainingSync.lastStatus.pending===0);await page.locator('#syncClaimNotice').filter({hasText:'3 sesiones ya respaldadas'}).waitFor();assert.equal(claims,2);assert.equal(bridge,1);
 await page.screenshot({path:resolve('output/supabase-sync/domain-claim-confirmation.png'),fullPage:true});
 await page.evaluate(()=>{window.ArbatTrainingSync.engine.stop();window.__setTestBuddy(null);});assert.equal(await page.locator('#syncClaimNotice').isVisible(),false);
 console.log('PASS: assignment notice hides after 10 seconds; normal sync updates do not reset the timer or show it again.');
 console.log('PASS: server-confirmed assignment count survives reload/replay without duplication, and hides immediately on logout.');
 console.log('PASS: white exterior, dark outside headings/status text, unchanged gray target/data cards.');
 console.log('PASS: isolated real-domain artifact; preserves normal training; readable CAPTCHA error stays open without signup; official SDK import path; simulated Buddy claims anonymous records and syncs new arrows with zero CAPTCHA/signup/Statetty telemetry.');
}finally{await browser?.close();await new Promise(r=>server.close(r));await rm(destination,{recursive:true,force:true});}

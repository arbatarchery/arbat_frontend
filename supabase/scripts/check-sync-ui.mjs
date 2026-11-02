import {chromium} from 'playwright';import {createServer} from 'node:http';import {readFile,mkdir} from 'node:fs/promises';import {resolve,extname} from 'node:path';import assert from 'node:assert/strict';
const root=resolve(new URL('../../',import.meta.url).pathname),output=resolve(root,'output/supabase-sync');await mkdir(output,{recursive:true});
const md=await readFile(resolve(root,'entrenamiento/index.md'),'utf8'),parts=md.split('---'),front=parts[1];
const css=[...front.slice(front.indexOf('estilos:'),front.indexOf('scripts:')).matchAll(/"([^"]+)"/g)].map(m=>m[1]);
const scripts=[...front.slice(front.indexOf('scripts:')).matchAll(/"([^"]+)"/g)].map(m=>m[1]);
const body=parts.slice(2).join('---').replace('{% include training-captcha.html %}',await readFile(resolve(root,'_includes/training-captcha.html'),'utf8'));
const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#151a20;font:16px system-ui,sans-serif}.wrap{max-width:1140px;margin:auto;padding:16px}button{font:inherit}h3{margin:0}</style>${css.map(s=>`<link rel="stylesheet" href="${s}">`).join('')}</head><body><main class="wrap">${body}</main>${scripts.map(s=>`<script src="${s}" defer></script>`).join('')}</body></html>`;
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 const file=resolve(root,'.'+path);if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json'})[extname(file)]||'text/plain');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage(),errors=[],external=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{const url=route.request().url();if(!url.startsWith(origin)){external.push(url);return route.abort();}return route.continue();});
 for(const width of [320,390,859,1024,1440]){
  await page.setViewportSize({width,height:1000});await page.goto(origin);await page.waitForFunction(()=>window.ArbatTrainingSync?.lastStatus?.localSaved===true);
  const button=page.locator('#syncStatusButton');
  if(width<860){
   assert.equal(await button.isVisible(),true);assert.equal(await page.locator('#syncDesktopStatus').isVisible(),false);
   const box=await button.boundingBox(),target=await page.locator('.target-panel').boundingBox(),control=await page.locator('.control-panel').boundingBox();
   assert.ok(Math.abs(box.width-width*.3)<1);assert.ok(Math.abs(box.x+box.width/2-width/2)<1);
   assert.ok(Math.abs(box.y-(target.y+target.height))<1);assert.ok(box.y+box.height<=control.y+.5);
   const lineHeight=await button.evaluate(e=>getComputedStyle(e,'::before').height);assert.equal(lineHeight,'5px');assert.equal(box.height,44);
   await button.click();assert.equal(await page.locator('#syncStatusDialog').evaluate(e=>e.open),true);
   assert.equal(await page.locator('.sync-legend li').count(),5);await page.keyboard.press('Escape');assert.equal(await button.evaluate(e=>document.activeElement===e),true);
   await page.evaluate(()=>window.dispatchEvent(new CustomEvent('arbat:sync-state',{detail:{state:'synced',pending:0,localSaved:true,lastConfirmedAt:Date.now()}})));
   assert.equal(await button.getAttribute('data-color'),'green');
   if(width===390){await page.locator('h1').click();await page.screenshot({path:resolve(output,'mobile-bar.png'),clip:{x:0,y:0,width:390,height:Math.ceil(target.y+target.height+200)}});await button.click();await page.locator('#syncStatusDialog').screenshot({path:resolve(output,'mobile-panel.png')});await page.keyboard.press('Escape');}
  }else{
   assert.equal(await button.isVisible(),false);const desktop=page.locator('#syncDesktopStatus');assert.equal(await desktop.isVisible(),true);
   const box=await desktop.boundingBox(),panel=await page.locator('.control-panel').boundingBox();assert.ok(box.y>=panel.y+panel.height);assert.ok(Math.abs(box.x-panel.x)<1);assert.ok(Math.abs(box.width-panel.width)<1);
   assert.equal(await page.locator('.sync-desktop-line').evaluate(e=>getComputedStyle(e).height),'5px');
   for(const [detail,color,text]of [[{state:'synced',pending:0,localSaved:true,lastConfirmedAt:1},'green',/en la nube/],[{state:'offline',pending:3,localSaved:true},'yellow',/Sin conexión.*3 cambios/],[{state:'syncing',pending:3,localSaved:true},'blue',/Enviando 3/],[{state:'error',localSaved:false},'red',/Error al guardar/],[{state:'disabled',localSaved:true},'gray',/Nube desactivada/]]){
    await page.evaluate(detail=>window.dispatchEvent(new CustomEvent('arbat:sync-state',{detail})),detail);assert.equal(await desktop.getAttribute('data-color'),color);assert.match(await page.locator('#syncDesktopText').textContent(),text);assert.equal(await page.locator('#syncDesktopText').evaluate(e=>getComputedStyle(e).color),'rgb(0, 0, 0)');assert.equal(await page.locator('.sync-desktop-details').evaluate(e=>getComputedStyle(e).color),'rgb(0, 0, 0)');
   }
   await desktop.click();assert.equal(await page.locator('#syncStatusDialog').evaluate(e=>e.open),true);await page.keyboard.press('Escape');assert.equal(await desktop.evaluate(e=>document.activeElement===e),true);
   assert.equal(await page.locator('.target-panel').evaluate(e=>getComputedStyle(e).marginBottom),'0px');
   if(width===1440){await page.evaluate(()=>window.dispatchEvent(new CustomEvent('arbat:sync-state',{detail:{state:'synced',pending:0,localSaved:true,lastConfirmedAt:Date.now()}})));await page.locator('h1').click();await page.screenshot({path:resolve(output,'desktop-status.png'),fullPage:true});}
  }
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 // Enabled flow uses the REAL bundled SDK and only intercepted test endpoints.
 // The real Supabase project is never contacted.
 const live=await browser.newPage({viewport:{width:390,height:1000}});const failures=[];live.on('pageerror',e=>failures.push(e.message));
 const principal='80000000-0000-4000-8000-000000000001',receipts=new Map(),packetSizes=[];let signups=0;
 const token=`${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({sub:principal,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.dGVzdA`;
 await live.addInitScript(()=>{window.ArbatTrainingSyncConfig={enabled:true,url:'https://sync-test.supabase.co',publicKey:'sb_publishable_test',captchaProvider:async()=>'test-captcha'};});
 await live.route('**/*',async route=>{
  const url=route.request().url();if(url.startsWith(origin))return route.continue();
  if(!url.startsWith('https://sync-test.supabase.co/')){failures.push('unexpected external request');return route.abort();}
  const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-supabase-api-version','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const request=route.request().postDataJSON();
  if(url.endsWith('/auth/v1/signup')){signups++;assert.equal(request.gotrue_meta_security.captcha_token,'test-captcha');return route.fulfill({json:{access_token:token,refresh_token:'test-refresh-only',expires_in:3600,token_type:'bearer',user:{id:principal,is_anonymous:true}},headers});}
  assert.ok(url.endsWith('/functions/v1/training-sync'));
  packetSizes.push(request.operations.length);const results=request.operations.map(op=>{if(!receipts.has(op.operation_id))receipts.set(op.operation_id,{operation_id:op.operation_id,status:'accepted',revision:op.base_revision+1,replayed:false});return receipts.get(op.operation_id);});
  return route.fulfill({json:{results},headers});
 });
 await live.goto(origin);await live.waitForFunction(()=>window.ArbatTrainingSync?.lastStatus?.localSaved===true);
 await live.locator('#target').click();try{await live.waitForFunction(()=>window.ArbatTrainingSync.lastStatus.state==='synced',{},{timeout:5000});}catch(error){console.log({status:await live.evaluate(()=>window.ArbatTrainingSync.lastStatus),signups,receipts:receipts.size,failures});throw error;}
 assert.equal(signups,1);assert.equal(receipts.size,2);assert.deepEqual(packetSizes,[2]);assert.equal(await live.locator('#syncStatusButton').getAttribute('data-color'),'green');
 await live.reload();await live.waitForFunction(()=>window.ArbatTrainingSync?.lastStatus?.state==='synced');
 const confirmed=await live.evaluate(()=>window.ArbatTrainingSync.lastStatus.lastConfirmedAt);
 await live.locator('#target').click({position:{x:150,y:150}});await live.waitForFunction(previous=>window.ArbatTrainingSync.lastStatus.state==='synced'&&window.ArbatTrainingSync.lastStatus.lastConfirmedAt>previous,confirmed);
 assert.equal(signups,1);assert.equal(receipts.size,3);assert.deepEqual(failures,[]);
 assert.deepEqual(packetSizes,[2,1]);const beforeRecovery=packetSizes.length;
 await live.context().setOffline(true);
 for(let i=0;i<3;i++)await live.locator('#target').click({position:{x:150+i*3,y:150}});
 await live.evaluate(()=>window.ArbatTrainingSync.settled());assert.equal(await live.evaluate(()=>window.ArbatTrainingSync.lastStatus.pending),3);
 await live.context().setOffline(false);await live.waitForFunction(()=>window.ArbatTrainingSync.lastStatus.state==='synced'&&window.ArbatTrainingSync.lastStatus.pending===0);
 assert.deepEqual(packetSizes.slice(beforeRecovery),[3]);assert.equal(receipts.size,6);
 console.log('PASS: Chrome sends first-session operations together, a new arrow alone, and three offline arrows in one recovery request.');
 // First-end automatic verification and Buddy exemption use mocked services.
 // No real challenge is solved and no remote project is contacted.
 for(const buddyMode of [false,true]){
  const testPage=await browser.newPage({viewport:{width:390,height:1000}});let prompts=0,signupCount=0,bridgeCount=0;
  const errors=[],ops=new Map();testPage.on('pageerror',e=>errors.push(e.message));
  await testPage.addInitScript(({buddyMode})=>{
   window.ArbatTrainingSyncConfig={enabled:true,url:'https://sync-test.supabase.co',publicKey:'sb_publishable_test',turnstileSiteKey:'test-only-sitekey'};
   window.__states=[];window.addEventListener('arbat:sync-state',e=>window.__states.push({state:e.detail.state,error:e.detail.error,pending:e.detail.pending}));
   window.turnstile={render(_element,options){window.__prompts=(window.__prompts||0)+1;queueMicrotask(()=>options.callback('test-only-captcha'));return 'fake-widget';},remove(){}};
   if(buddyMode){window.ArbatUser={get:()=>({id:'buddy-A',anonymous:false})};window.Buddy={auth:{getAccessToken:()=>'test-only-buddy',getUser:()=>({id:'buddy-A'})}};}
  },{buddyMode});
  await testPage.route('**/*',async route=>{
   const url=route.request().url();if(url.startsWith(origin)){if(buddyMode&&url.includes('/vendor/auth-client'))errors.push('Buddy loaded anonymous SDK');return route.continue();}
   if(!url.startsWith('https://sync-test.supabase.co/')){errors.push('unexpected external request');return route.abort();}
   const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-buddy-access-token','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
   if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
   const body=route.request().postDataJSON();
   if(url.endsWith('/auth/v1/signup')){signupCount++;assert.equal(buddyMode,false);return route.fulfill({headers,json:{access_token:token,refresh_token:'fake-refresh',expires_in:3600,token_type:'bearer',user:{id:principal,is_anonymous:true}}});}
   if(body.action==='buddy.session'){bridgeCount++;return route.fulfill({headers,json:{status:'accepted',principal_id:principal,subject:'buddy-A'}});}
   if(body.action==='claim')return route.fulfill({headers,json:{status:'accepted',owner_id:principal}});
   assert.equal(body.action,'sync');const results=body.operations.map(op=>{if(!ops.has(op.operation_id))ops.set(op.operation_id,op.base_revision+1);return {operation_id:op.operation_id,status:'accepted',revision:ops.get(op.operation_id)};});
   return route.fulfill({headers,json:{results}});
  });
  await testPage.goto(origin);await testPage.locator('#target').click({position:{x:150,y:150}});
  if(!buddyMode)await testPage.waitForFunction(()=>window.ArbatTrainingSync.lastStatus.error==='captcha_required');
  assert.equal(await testPage.evaluate(()=>window.__prompts||0),0);
  await testPage.locator('#finishBtn').click();await testPage.evaluate(()=>window.ArbatTrainingSync.settled());try{await testPage.waitForFunction(()=>window.ArbatTrainingSync.lastStatus.state==='synced',{},{timeout:10000});}catch(error){console.log('finish diagnostics',buddyMode,signupCount,bridgeCount,errors,await testPage.evaluate(async()=>({prompts:window.__prompts,states:window.__states,status:window.ArbatTrainingSync.lastStatus,gate:await window.ArbatTrainingSync.store.meta('captcha-auto:first-end:v1'),ops:await window.ArbatTrainingSync.store.readAll('operations')})));throw error;}
  prompts=await testPage.evaluate(()=>window.__prompts||0);assert.equal(prompts,buddyMode?0:1);assert.equal(signupCount,buddyMode?0:1);assert.equal(bridgeCount,buddyMode?1:0);
  await testPage.reload();try{await testPage.waitForFunction(()=>window.ArbatTrainingSync.lastStatus.state==='synced',{},{timeout:10000});}catch(error){console.log('reload diagnostics',buddyMode,await testPage.evaluate(async()=>({status:window.ArbatTrainingSync.lastStatus,ops:await window.ArbatTrainingSync.store.readAll('operations'),sessions:await window.ArbatTrainingSync.store.readAll('sessions')})));throw error;}assert.equal(signupCount,buddyMode?0:1);assert.equal(bridgeCount,buddyMode?1:0);assert.deepEqual(errors,[]);
  await testPage.close();
 }
 console.log('PASS: first completed end requests needed CAPTCHA automatically; verified Buddy uses zero CAPTCHA/signup/anonymous SDK; reload reuses credentials.');
 console.log('PASS: mobile 320/390/859px and desktop 1024/1440px; line/text status, all five colors, position, dialog and Escape/focus; zero external requests.');
 console.log('PASS: enabled SDK flow with intercepted test Auth/API; first signup, per-arrow ACK, refresh of page without new signup.');
 console.log(output);
}finally{await browser?.close();await new Promise(r=>server.close(r));}

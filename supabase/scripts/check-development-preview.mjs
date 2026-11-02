import {chromium} from 'playwright';import assert from 'node:assert/strict';
const origin='http://localhost:8000',browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1000,height:1000}}),external=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort();}return route.continue();});
 await page.addInitScript(()=>{if(!localStorage.getItem('arbat-training-current'))localStorage.setItem('arbat-training-current',JSON.stringify({id:'preserve-native-example'}));});
 await page.goto(origin);await page.locator('iframe').waitFor();const frame=page.frames().find(f=>f.url().endsWith('/entrenamiento/'));
 await frame.waitForFunction(()=>window.ArbatTrainingSync?.lastStatus?.localSaved===true);
 await frame.locator('#target').click();await frame.waitForFunction(()=>window.ArbatTrainingSync.lastStatus.error==='captcha_required');
 const result=await frame.evaluate(()=>({original:JSON.parse(localStorage.getItem('arbat-training-current')),test:JSON.parse(window.ArbatTrainingStorage.getItem('arbat-training-current')),status:window.ArbatTrainingSync.lastStatus}));
 assert.equal(result.original.id,'preserve-native-example');assert.equal(result.test.current.length,1);assert.match(result.test.notes,/datos ficticios/);assert.equal(result.status.pending,2);
 assert.equal(await frame.locator('#syncStatusButton').getAttribute('data-color'),'yellow');await frame.locator('#syncStatusButton').click();assert.match(await frame.locator('#syncStateDescription').textContent(),/Confirma/);
 await page.locator('#previewPause').click();assert.equal(await page.locator('#previewPause').getAttribute('aria-pressed'),'true');
 const blocked=await frame.evaluate(async()=>{try{await window.fetch(window.ArbatTrainingSyncConfig.url+'/rest/v1/training_sessions');return false;}catch(error){return error.message==='preview_offline';}});assert.equal(blocked,true);
 await page.locator('#previewPause').click();assert.equal(await page.locator('#previewPause').getAttribute('aria-pressed'),'false');
 assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 console.log('PASS: mobile iframe, isolated native storage, CAPTCHA required, pause/resume controls and zero external requests before confirmation.');
}finally{await browser.close();}

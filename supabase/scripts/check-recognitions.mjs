import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(new URL('../../',import.meta.url).pathname),output=resolve(root,'output/recognitions');await mkdir(output,{recursive:true});
const md=await readFile(resolve(root,'entrenamiento/index.md'),'utf8');
const body=md.split('---').slice(2).join('---').replace('{% include training-captcha.html %}','');
const scripts=['constelacion','sync-history','recognitions','recognitions-ui','entrenamiento'];
const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/entrenamiento/css/entrenamiento.css"><link rel="stylesheet" href="/entrenamiento/css/recognitions.css"></head><body>${body}${scripts.map(s=>`<script defer src="/entrenamiento/js/${s}.js"></script>`).join('')}</body></html>`;
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;if(path==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}const file=resolve(root,'.'+path);if(!file.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',extname(file)==='.js'?'text/javascript':'text/css');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;let browser;
try{
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'canShare',{value:()=>false,configurable:true});
  const RealDate=Date;window.Date=class extends RealDate{constructor(...a){super(...(a.length?a:['2026-11-24T12:00:00-04:00']));}static now(){return new RealDate('2026-11-24T12:00:00-04:00').getTime();}};
  window.ArbatUser={get:()=>({id:'one',name:'Arquero'})};
  if(!localStorage.getItem('fixture')){
   const end=(spread,score)=>({arrowLimit:6,shootingDistance:'18',targetSize:'40',sessionType:'training',endedAt:'2026-11-24T12:00:00-04:00',arrows:Array.from({length:6},(_,i)=>({x:50+(i%2?spread:-spread),y:50,score,label:String(score)}))});
   localStorage.setItem('arbat-training-history',JSON.stringify([{id:'before',owner:{id:'one'},date:'2026-11-01',startedAt:'2026-11-01T12:00:00-04:00',endedAt:'2026-11-01T13:00:00-04:00',completed:Array.from({length:6},()=>end(2,8)),current:[]}]));
   localStorage.setItem('arbat-training-current',JSON.stringify({id:'now',owner:{id:'one'},date:'2026-11-24',startedAt:'2026-11-24T11:00:00-04:00',completed:Array.from({length:6},()=>end(1.5,9)),current:[],arrowsPerEnd:6,shootingDistance:'18',targetSize:'40',sessionType:'training',notes:''}));localStorage.setItem('fixture','1');
  }
 });
 await page.goto(origin);await page.locator('dialog.arbat-recognition-dialog[open]').waitFor();
 assert.match(await page.locator('.arbat-monthly strong').textContent(),/72/);
 await page.locator('dialog.arbat-recognition-dialog').screenshot({path:resolve(output,'monthly-mobile.png')});
 let cancelledDownloads=0;const onDownload=()=>cancelledDownloads++;page.on('download',onDownload);
 await page.evaluate(()=>{Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});Object.defineProperty(navigator,'share',{value:async()=>{window.__shareCancelled=true;throw new DOMException('Cancelled','AbortError');},configurable:true});});await page.getByRole('button',{name:'Historia 9:16'}).click();await page.waitForFunction(()=>window.__shareCancelled);assert.equal(cancelledDownloads,0);page.off('download',onDownload);await page.evaluate(()=>Object.defineProperty(navigator,'canShare',{value:()=>false,configurable:true}));
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Historia 9:16'}).click();const file=await download;assert.match(file.suggestedFilename(),/1080x1920/);await file.saveAs(resolve(output,'monthly-story.png'));const story=await readFile(resolve(output,'monthly-story.png'));assert.equal(story.readUInt32BE(16),1080);assert.equal(story.readUInt32BE(20),1920);
 const postDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Publicación 4:5'}).click();await(await postDownload).saveAs(resolve(output,'monthly-post.png'));const post=await readFile(resolve(output,'monthly-post.png'));assert.equal(post.readUInt32BE(16),1080);assert.equal(post.readUInt32BE(20),1350);
 await page.getByRole('button',{name:'Cerrar',exact:true}).click();await page.reload();await page.locator('#finishSessionBtn:not([disabled])').waitFor();assert.equal(await page.locator('dialog[open]').count(),0);
 await page.locator('#finishSessionBtn').click();await page.locator('dialog[open]').waitFor();assert.equal(await page.locator('dialog .arbat-recognition').count(),2);assert.match(await page.locator('dialog.arbat-recognition-dialog').textContent(),/récord personal/);assert.match(await page.locator('dialog.arbat-recognition-dialog').textContent(),/agrupaciones están mejorando/);
 await page.locator('dialog.arbat-recognition-dialog').screenshot({path:resolve(output,'session-mobile.png')});
 const archived=await page.evaluate(()=>JSON.parse(localStorage.getItem('arbat-training-history')).at(-1));assert.equal(archived.id,'now');assert.ok(archived.csv);assert.equal(archived.recognitions,undefined);
 await page.evaluate(s=>window.dispatchEvent(new CustomEvent('arbat:session-ended',{detail:s})),archived);assert.equal(await page.locator('dialog .arbat-recognition').count(),2);
 await page.reload();await page.waitForFunction(()=>window.ArbatRecognitions);assert.equal(await page.locator('dialog[open]').count(),0);
 await page.evaluate(()=>{const list=document.createElement('div');list.id='sessionList';document.body.append(list);window.dispatchEvent(new CustomEvent('arbat:history-loaded',{detail:{sessions:JSON.parse(localStorage.getItem('arbat-training-history')),user:{id:'one'}}}));});
 assert.ok(await page.locator('#arbatRecognitions .arbat-recognition').count()>=1);assert.equal(await page.locator('dialog[open]').count(),0);await page.getByRole('button',{name:'Ver mi resumen mensual'}).click();assert.equal(await page.locator('.arbat-monthly strong').textContent(),'72');
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.querySelector('dialog.arbat-recognition-dialog').scrollWidth<=document.querySelector('dialog.arbat-recognition-dialog').clientWidth),true);}
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('arbat:history-loading')));assert.equal(await page.locator('#arbatRecognitions .arbat-recognition').count(),0);assert.equal(await page.locator('dialog[open]').count(),0);
 await page.evaluate(()=>{window.ArbatUser={get:()=>({id:'other',name:'Otro arquero'})};window.dispatchEvent(new CustomEvent('buddy:auth-state-changed'));});await page.waitForTimeout(100);assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.locator('#arbatRecognitions .arbat-recognition').count(),0);
 const cloudPage=await browser.newPage({viewport:{width:390,height:844}});cloudPage.on('pageerror',e=>errors.push(e.message));await cloudPage.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 const snapshots=await page.evaluate(()=>JSON.parse(localStorage.getItem('arbat-training-history')));
 await cloudPage.addInitScript(sessions=>{
  const RealDate=Date;window.Date=class extends RealDate{constructor(...a){super(...(a.length?a:['2026-11-24T12:00:00-04:00']));}};
  window.ArbatUser={get:()=>({id:'one',name:'Arquero'})};localStorage.setItem('arbat-training-history',JSON.stringify(sessions));
  const mappings=sessions.map((snapshot,i)=>({snapshot,key:`90000000-0000-4000-8000-00000000000${i}`,accountKey:'one',pending:0,confirmedRevision:1}));
  window.ArbatTrainingSync={capture(){},historyEnabled:true,localSessions:async()=>mappings,remoteHistory:async()=>({sessions:mappings.map(r=>({...r.snapshot,id:r.key,revision:1})),deletedIds:[]})};
 },snapshots);
 await cloudPage.goto(origin);await cloudPage.locator('.arbat-monthly strong').waitFor();assert.equal(await cloudPage.locator('.arbat-monthly strong').textContent(),'72');await cloudPage.close();
 assert.deepEqual(errors,[]);console.log('Recognition browser checks passed: monthly once, 9:16 download, ordinary + record at finish, no replay, history access, responsive layout.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}

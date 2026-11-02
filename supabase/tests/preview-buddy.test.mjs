import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {mount}=createRequire(import.meta.url)('../scripts/preview-buddy.cjs');
function setup({restore=false,callback=false}={}){
 const elements=new Map(),scripts=[],saved=new Map();if(restore)saved.set('arbat-supabase-preview-v1:buddy-enabled','1');let user=null,sent=0,telemetry=0;
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,textContent:'',value:'example@example.invalid',handlers:{},addEventListener(event,fn){this.handlers[event]=fn;}});return elements.get(id);};
 const events=new EventTarget(),window={ArbatTrainingSyncConfig:{storagePrefix:'arbat-supabase-preview-v1:'},location:{href:'http://localhost:8000/entrenamiento/'+(callback?'?auth=test-only-placeholder':'')},
  localStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)},addEventListener:(...args)=>events.addEventListener(...args),confirm:()=>false,
  document:{getElementById:element,createElement:()=>({}),head:{append(script){scripts.push(script);queueMicrotask(()=>{
   if(script.src.includes('telemetry/buddy_telemetry.js'))window.Buddy={telemetry:{send:()=>{telemetry++;},request:()=> 'official transport'}};
   if(script.src.includes('auth/buddy_auth.js'))window.Buddy.auth={getUser:()=>user,getState:()=>({busy:false}),requestLogin:async()=>{sent++;}};
   script.onload();
  });}}}};
 mount(window);return {window,elements,scripts,saved,counts:()=>({sent,telemetry}),setUser(value){user=value;events.dispatchEvent(new Event('buddy:auth-state-changed'));}};
}
test('Buddy preview loads nothing and sends no mail until an explicit user action',async()=>{
 const b=setup();assert.equal(b.scripts.length,0);assert.equal(b.counts().sent,0);await b.window.ArbatPreviewBuddy.connect();
 assert.equal(b.scripts.length,4);assert.ok(b.scripts.every(s=>s.src.startsWith('https://statetty.com/assets/buddy/modules/')));assert.ok(b.scripts.every(s=>s.referrerPolicy==='no-referrer'));
 assert.equal(b.window.BuddyConfig.app.siteId,'arbat');assert.equal(b.window.Buddy.telemetry.request(),'official transport');await b.window.Buddy.telemetry.send({event:'test'});assert.equal(b.counts().telemetry,0);
 assert.equal(b.counts().sent,0);await b.elements.get('previewBuddyForm').handlers.submit({preventDefault(){}});assert.equal(b.counts().sent,1);assert.match(b.elements.get('previewBuddyStatus').textContent,/Enlace enviado/);
});
test('simultaneous connects reuse loading and account changes show only plain account text',async()=>{
 const b=setup();await Promise.all([b.window.ArbatPreviewBuddy.connect(),b.window.ArbatPreviewBuddy.connect()]);assert.equal(b.scripts.length,4);
 b.setUser({name:'<test user>',id:'test-A'});assert.equal(b.elements.get('previewBuddyForm').hidden,true);assert.equal(b.elements.get('previewBuddyLogout').hidden,false);assert.match(b.elements.get('previewBuddyStatus').textContent,/<test user>/);
 assert.equal([...b.saved.keys()].some(k=>/token|email/i.test(k)),false);
});
test('mail link return and opted-in reload load the official auth module without requesting another email',async()=>{
 for(const options of [{restore:true},{callback:true}]){const b=setup(options);await b.window.ArbatPreviewBuddy.connect();assert.equal(b.scripts.length,4);assert.equal(b.counts().sent,0);}
});
test('a failed login gives a useful origin message and preserves form retry',async()=>{
 const b=setup();await b.window.ArbatPreviewBuddy.connect();b.window.Buddy.auth.requestLogin=async()=>{throw new Error('Failed to fetch');};
 await b.elements.get('previewBuddyForm').handlers.submit({preventDefault(){}});assert.match(b.elements.get('previewBuddyStatus').textContent,/localhost:8000/);assert.equal(b.elements.get('previewBuddySend').disabled,false);
});

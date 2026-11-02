import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {Captcha}=createRequire(import.meta.url)('../../entrenamiento/js/sync-captcha.js');
class Dialog extends EventTarget{open=false;showModal(){this.open=true;}close(){this.open=false;this.dispatchEvent(new Event('close'));}}
function setup(callback){const dialog=new Dialog(),container={replaceChildren(){}};let removed=0,rendered=0;
 const captcha=new Captcha({enabled:true,siteKey:'public-sitekey-test',document:{getElementById:id=>id==='trainingCaptchaDialog'?dialog:container},
 window:{turnstile:{render(_element,options){rendered++;assert.equal(options.size,'compact');queueMicrotask(()=>callback(options,dialog));return 'widget';},remove(){removed++;}}}});
 return {captcha,dialog,counts:()=>({removed,rendered})};}
test('disabled or unconfigured CAPTCHA never loads a remote script',async()=>{
 for(const options of [{enabled:false,siteKey:'test'},{enabled:true}]){
  const captcha=new Captcha({...options,document:{createElement:()=>assert.fail('must not load script')}});
  await assert.rejects(captcha.authorize(),e=>e.code==='captcha_configuration_required');
 }
});
test('challenge success yields one short-lived token and restores dialog state',async()=>{
 const {captcha,dialog,counts}=setup(options=>options.callback('test-token'));
 await captcha.authorize();assert.equal(captcha.take(),'test-token');assert.equal(captcha.take(),null);assert.equal(dialog.open,false);assert.deepEqual(counts(),{rendered:1,removed:1});
});
test('closing challenge rejects without manufacturing a CAPTCHA token',async()=>{
 const {captcha,dialog}=setup((_options,dialog)=>dialog.close());await assert.rejects(captcha.authorize());assert.equal(captcha.take(),null);assert.equal(dialog.open,false);
});

const {AutoPrompt}=createRequire(import.meta.url)('../../entrenamiento/js/sync-captcha.js');
function autoSetup({online=true,buddy=false,error='captcha_required',cancel=false}={}){
 const values=new Map(),navigator={onLine:online};let prompts=0,checks=0;
 const store={meta:async key=>values.get(key),changeMeta:async(key,fn)=>{const value=fn(values.get(key));values.set(key,value);return value;}};
 const gate=new AutoPrompt({enabled:true,store,navigator,hasBuddy:()=>buddy,getStatus:async()=>{checks++;return {error};},authorize:async()=>{prompts++;if(cancel)throw Object.assign(new Error('captcha_cancelled'),{code:'captcha_cancelled'});}});
 return {gate,navigator,values,counts:()=>({prompts,checks}),setBuddy:v=>{buddy=v;},setError:v=>{error=v;},store};
}
test('no automatic CAPTCHA before first completed end; a needed challenge then appears without tapping the bar',async()=>{
 const b=autoSetup();await b.gate.maybe();assert.equal(b.counts().prompts,0);await b.gate.reachedEnd();assert.equal(b.counts().prompts,1);
 await b.gate.reachedEnd();await b.gate.maybe();assert.equal(b.counts().prompts,1);
});
test('offline first end waits for connectivity; existing sessions and Buddy never prompt',async()=>{
 const b=autoSetup({online:false});await b.gate.reachedEnd();assert.equal(b.counts().prompts,0);b.navigator.onLine=true;await b.gate.maybe();assert.equal(b.counts().prompts,1);
 for(const options of [{buddy:true},{error:null}]){const other=autoSetup(options);await other.gate.reachedEnd();assert.equal(other.counts().prompts,0);}
});
test('cancelled automatic prompt stays dismissed across reload and later ends',async()=>{
 const b=autoSetup({cancel:true});await b.gate.reachedEnd();assert.equal(b.counts().prompts,1);
 const reloaded=new AutoPrompt({enabled:true,store:b.store,navigator:b.navigator,getStatus:()=>({error:'captcha_required'}),authorize:()=>assert.fail('dismissal must persist')});await reloaded.reachedEnd();
});
test('Buddy login can cancel an anonymous challenge, including while its script is loading',async()=>{
 const active=setup((_options,_dialog)=>active.captcha.cancel());await assert.rejects(active.captcha.authorize());assert.equal(active.dialog.open,false);assert.equal(active.captcha.take(),null);
 const pending=setup(()=>assert.fail('cancelled challenge must not render'));let loaded;
 pending.captcha.load=()=>new Promise(resolve=>{loaded=resolve;});const promise=pending.captcha.authorize();pending.captcha.cancel();loaded({render:()=>assert.fail('no render')});await assert.rejects(promise);assert.equal(pending.dialog.open,false);
});
test('a CAPTCHA-needed update arriving during an automatic check is not lost',async()=>{
 const values=new Map([['captcha-auto:first-end:v1',{due:true,attempted:false}]]);let release,checks=0,prompts=0;
 const store={meta:async k=>values.get(k),changeMeta:async(k,fn)=>values.set(k,fn(values.get(k)))};
 const gate=new AutoPrompt({enabled:true,store,navigator:{onLine:true},getStatus:async()=>{if(++checks===1)return new Promise(r=>{release=r;});return {error:'captcha_required'};},authorize:async()=>{prompts++;}});
 const checking=gate.maybe();while(!release)await new Promise(r=>setImmediate(r));gate.wake();release({error:null});await checking;
 for(let i=0;i<10&&!prompts;i++)await new Promise(r=>setImmediate(r));assert.equal(prompts,1);
});

test('temporary CAPTCHA load failure retries after reconnection rather than consuming the invitation',async()=>{
 const values=new Map();let attempts=0;
 const gate=new AutoPrompt({enabled:true,navigator:{onLine:true},store:{meta:async k=>values.get(k),changeMeta:async(k,fn)=>values.set(k,fn(values.get(k)))},getStatus:()=>({error:'captcha_required'}),authorize:async()=>{if(++attempts===1)throw new Error('captcha_unavailable');}});
 await gate.reachedEnd();await gate.maybe();assert.equal(attempts,1);await gate.online();
 for(let i=0;i<10&&attempts<2;i++)await new Promise(r=>setImmediate(r));assert.equal(attempts,2);
});

function errorsSetup(){
 const dialog=new Dialog(),message={textContent:''},retry=new EventTarget();retry.hidden=true;let removed=0;const callbacks=[],states=[];
 const captcha=new Captcha({enabled:true,siteKey:'public-test',onState:state=>states.push(state),document:{getElementById:id=>({trainingCaptchaDialog:dialog,trainingCaptchaMessage:message,trainingCaptchaRetry:retry,trainingCaptchaWidget:{replaceChildren(){}}})[id]},
 window:{turnstile:{render(_el,options){callbacks.push(options);return callbacks.length;},remove(){removed++;}}}});
 return {captcha,dialog,message,retry,callbacks,states,removed:()=>removed};
}
test('Cloudflare errors keep the dialog open and display a safe actionable code until retry or cancel',async()=>{
 const b=errorsSetup();let settled=false;const waiting=b.captcha.authorize().finally(()=>{settled=true;});await new Promise(r=>setImmediate(r));
 b.callbacks[0]['error-callback']('110200');await new Promise(r=>setImmediate(r));
 assert.equal(b.dialog.open,true);assert.equal(settled,false);assert.match(b.message.textContent,/dominio.*110200/);assert.equal(b.retry.hidden,false);assert.equal(b.captcha.take(),null);
 assert.deepEqual(b.states.at(-1),{state:'error',error:'captcha_domain_not_allowed',code:'110200'});
 b.retry.dispatchEvent(new Event('click'));await new Promise(r=>setImmediate(r));assert.equal(b.callbacks.length,2);assert.equal(b.retry.hidden,true);
 b.callbacks[0].callback('stale-test-token');assert.equal(settled,false);b.callbacks[1].callback('fresh-test-token');await waiting;assert.equal(b.captcha.take(),'fresh-test-token');assert.equal(b.dialog.open,false);
});
test('expiration and script failures stay readable without a premature close or fabricated token',async()=>{
 for(const event of ['expired-callback','timeout-callback']){const b=errorsSetup(),waiting=b.captcha.authorize();await new Promise(r=>setImmediate(r));b.callbacks[0][event]();assert.equal(b.dialog.open,true);assert.equal(b.retry.hidden,false);assert.equal(b.captcha.take(),null);b.dialog.close();await assert.rejects(waiting,e=>e.code==='captcha_cancelled');}
 const b=errorsSetup();b.captcha.load=async()=>{throw new Error('network failure');};const waiting=b.captcha.authorize();await new Promise(r=>setImmediate(r));assert.equal(b.dialog.open,true);assert.match(b.message.textContent,/conexión/);b.dialog.close();await assert.rejects(waiting);
});
test('invalid callback tokens and non-code diagnostics are neither accepted nor displayed',async()=>{
 const b=errorsSetup(),waiting=b.captcha.authorize();await new Promise(r=>setImmediate(r));b.callbacks[0].callback('');assert.equal(b.dialog.open,true);assert.equal(b.captcha.take(),null);
 b.callbacks[0]['error-callback']('not-a-public-code');assert.ok(!b.message.textContent.includes('not-a-public-code'));assert.equal(b.states.at(-1).code,null);b.dialog.close();await assert.rejects(waiting);
});

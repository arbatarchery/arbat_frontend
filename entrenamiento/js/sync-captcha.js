(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArbatSyncCaptcha=api;})(globalThis,()=>{
 'use strict';
 class Captcha{
  constructor({enabled=false,siteKey,window=globalThis,document=globalThis.document,onState=()=>{}}={}){Object.assign(this,{enabled,siteKey,window,document,onState});this.token=null;this.expires=0;this.loading=null;this.waiting=null;this.generation=0;}
  take(){const token=this.expires>Date.now()?this.token:null;this.token=null;return token;}
  notify(detail){try{this.onState(detail);}catch{}}
  async load(){if(this.window.turnstile)return this.window.turnstile;if(this.loading)return this.loading;
   this.loading=new Promise((resolve,reject)=>{const script=this.document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;
    const timer=setTimeout(()=>reject(new Error('captcha_unavailable')),15000);script.onload=()=>{clearTimeout(timer);this.window.turnstile?resolve(this.window.turnstile):reject(new Error('captcha_unavailable'));};script.onerror=()=>{clearTimeout(timer);reject(new Error('captcha_unavailable'));};this.document.head.append(script);
   }).catch(error=>{this.loading=null;throw error;});return this.loading;
  }
  async authorize(){
   if(!this.enabled||!this.siteKey)throw Object.assign(new Error('captcha_configuration_required'),{code:'captcha_configuration_required'});
   if(this.waiting)return this.waiting;
   this.waiting=this.show().finally(()=>{this.waiting=null;});return this.waiting;
  }
  cancel(){this.generation++;this.cancelWaiting?.();}
  async show(){
   const generation=this.generation,dialog=this.document.getElementById('trainingCaptchaDialog'),container=this.document.getElementById('trainingCaptchaWidget');
   if(!dialog||!container)throw new Error('captcha_unavailable');
   const message=this.document.getElementById('trainingCaptchaMessage'),retry=this.document.getElementById('trainingCaptchaRetry');
   const setMessage=text=>{if(message)message.textContent=text;};
   dialog.showModal();this.token=null;
   return new Promise((resolve,reject)=>{
    let widget,turnstile,finished=false,timer,attempt=0;
    const finish=(error,token)=>{if(finished)return;finished=true;attempt++;clearTimeout(timer);dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('close',cancel);retry?.removeEventListener?.('click',restart);this.cancelWaiting=null;
     if(widget!==undefined)turnstile?.remove(widget);container.replaceChildren();if(dialog.open)dialog.close();
     if(error)reject(Object.assign(new Error(error),{code:error}));else{this.token=token;this.expires=Date.now()+240000;this.notify({state:'verified'});resolve(true);}};
    const cancel=()=>finish('captcha_cancelled');this.cancelWaiting=cancel;dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',cancel);
    const fail=(error='captcha_unavailable',code=null)=>{
     clearTimeout(timer);this.token=null;const safeCode=/^\d{6}$/.test(String(code))?String(code):null;
     if(safeCode==='110200')error='captcha_domain_not_allowed';else if(['110100','110110'].includes(safeCode))error='captcha_sitekey_invalid';
     const text=error==='captcha_domain_not_allowed'?'Cloudflare no permite esta verificación en este dominio. Debe añadirse en los dominios permitidos del widget.'
      :error==='captcha_sitekey_invalid'?'Cloudflare no reconoce la configuración de esta verificación.'
      :error==='captcha_expired'?'La verificación venció. Pulsa Reintentar verificación para comenzar de nuevo.'
      :'No se pudo completar la verificación. Comprueba la conexión y pulsa Reintentar verificación.';
     setMessage(text+(safeCode?` Código de Cloudflare: ${safeCode}.`:''));if(retry){retry.hidden=false;retry.disabled=false;}
     this.notify({state:'error',error,code:safeCode});
    };
    const render=async()=>{
     const current=++attempt;clearTimeout(timer);if(retry)retry.hidden=true;setMessage('Cargando verificación… Puede validarse automáticamente o pedirte una interacción.');this.notify({state:'loading'});
     if(widget!==undefined){turnstile?.remove(widget);widget=undefined;}container.replaceChildren();
     try{
      turnstile=await this.load();if(finished||current!==attempt||generation!==this.generation)return;
      timer=setTimeout(()=>fail(),120000);
      widget=turnstile.render(container,{sitekey:this.siteKey,theme:'auto',size:'compact',retry:'never','refresh-expired':'manual','refresh-timeout':'manual',
       callback:token=>{if(!finished&&current===attempt){if(typeof token==='string'&&token.length>0&&token.length<=8192)finish(false,token);else fail();}},
       'error-callback':code=>{if(!finished&&current===attempt)fail('captcha_unavailable',code);return true;},
       'expired-callback':()=>{if(!finished&&current===attempt)fail('captcha_expired');},
       'timeout-callback':()=>{if(!finished&&current===attempt)fail();}});
      if(finished)turnstile.remove(widget);
     }catch{if(!finished&&current===attempt)fail();}
    };
    const restart=()=>{if(!finished)render();};retry?.addEventListener?.('click',restart);render();
   });
  }
 }
 // Durable single automatic invitation per browser store. Closing the dialog
 // keeps manual retry available without interrupting later ends repeatedly.
 class AutoPrompt{
  constructor({enabled=false,store,navigator=globalThis.navigator,events=globalThis,getStatus,authorize,hasBuddy=()=>false,onError=()=>{},now=Date.now}={}){
   Object.assign(this,{enabled,store,navigator,events,getStatus,authorize,hasBuddy,onError,now});this.busy=false;this.key='captcha-auto:first-end:v1';
   this.wake=()=>this.maybe().catch(onError);
   this.online=()=>this.store.changeMeta(this.key,value=>value?{...value,nextAttemptAt:0}:value).then(this.wake).catch(onError);
  }
  start(){if(this.enabled){this.events?.addEventListener?.('online',this.online);this.events?.addEventListener?.('arbat:sync-state',this.wake);}}
  stop(){this.events?.removeEventListener?.('online',this.online);this.events?.removeEventListener?.('arbat:sync-state',this.wake);}
  async reachedEnd(){if(!this.enabled)return;await this.store.changeMeta(this.key,value=>value||{due:true,attempted:false});return this.maybe();}
  async maybe(){
   if(!this.enabled||this.navigator?.onLine===false||this.hasBuddy())return;
   if(this.busy){this.again=true;return;}
   this.busy=true;
   try{
    const state=await this.store.meta(this.key);if(!state?.due||state.attempted||state.nextAttemptAt>this.now())return;
    const status=await this.getStatus();
    if(this.navigator?.onLine===false||this.hasBuddy()||status?.error!=='captcha_required')return;
    let claimed=false;
    await this.store.changeMeta(this.key,value=>{if(value?.due&&!value.attempted){claimed=true;return {...value,attempted:true};}return value;});
    if(claimed)await this.authorize();
   }catch(error){if(error?.code!=='captcha_cancelled'&&error?.message!=='captcha_cancelled')await this.store.changeMeta(this.key,value=>value?.attempted?{...value,attempted:false,nextAttemptAt:this.now()+30000}:value);this.onError(error);}finally{this.busy=false;if(this.again){this.again=false;this.wake();}}
  }
 }
 return {Captcha,AutoPrompt};
});

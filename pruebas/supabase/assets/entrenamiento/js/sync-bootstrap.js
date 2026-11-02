(function(window){
 'use strict';
 const localStorage=window.ArbatTrainingStorage||window.localStorage;
 if(!window.ArbatSyncStore||!window.ArbatSyncEngine)return;
 const runtime=window.ArbatTrainingSyncConfig||{enabled:false};
 const config={...runtime,publicKey:runtime.publicKey||runtime.publishableKey};
 const store=new window.ArbatSyncStore.Store({name:config.storeName||'arbat-training-sync-v1'});
 let captchaProblem=null;
 const captcha=window.ArbatSyncCaptcha?new window.ArbatSyncCaptcha.Captcha({enabled:config.enabled===true,siteKey:config.turnstileSiteKey,onState:detail=>{if(detail.state==='error'){captchaProblem=detail;engine.emit('auth_required',detail.error).catch(()=>{});}else if(['loading','verified'].includes(detail.state))captchaProblem=null;}}):null;
 const identity=window.ArbatSyncIdentity?new window.ArbatSyncIdentity.Identity({store,...config,getBuddy:()=>{
  const user=window.ArbatUser?.get?.()||window.Buddy?.auth?.getUser?.();
  if(user&&!(user.id??user._id))throw Object.assign(new Error('buddy_auth_required'),{code:'buddy_auth_required'});
  return {accountKey:user?String(user.id??user._id):null,buddyToken:window.Buddy?.auth?.getAccessToken?.()||null};
 },captchaProvider:config.captchaProvider||(()=>captcha?.take())}):null;
 let autoPrompt=null;
 let lastError=null,queue=Promise.resolve(),importPromise=null;const failed=[];
 const publish=detail=>{
  if(captchaProblem&&['captcha_required',captchaProblem.error].includes(detail.error))detail={...detail,error:captchaProblem.error,captchaCode:captchaProblem.code};
  if(lastError||detail.issues?.length)detail={...detail,state:'error'};
  window.ArbatTrainingSync.lastStatus=detail;
  window.dispatchEvent(new CustomEvent('arbat:sync-state',{detail}));
  const notice=document.getElementById('syncLocalNotice');
  if(notice){notice.hidden=!lastError&&!detail.issues?.length;notice.textContent=lastError?(failed.some(entry=>!entry.options.legacySaved)
   ?'No se pudo confirmar una copia local de algunos cambios. Mantén esta página abierta y reintenta el guardado.'
   :'Los datos siguen guardados en este dispositivo, pero no se pudo preparar su sincronización. Reintenta el guardado.')
   :detail.issues?.length?'Algunos datos locales necesitan revisión antes de sincronizarse. Los registros originales se conservan.':'';}
 };
 const engine=new window.ArbatSyncEngine.Engine({store,enabled:config.enabled===true,
  transport:window.ArbatSyncEngine.createTransport(config),identityProvider:async()=>failed.length?null:await(config.identityProvider?config.identityProvider():identity?.identity())||null,onState:publish});
 const historyTransport=window.ArbatSyncEngine.createTransport(config);
 const history=window.ArbatSyncHistory?new window.ArbatSyncHistory.Reader({enabled:config.enabled===true&&config.historyEnabled===true,url:config.url,publicKey:config.publicKey,
  identityProvider:async()=>failed.length?null:await(config.identityProvider?config.identityProvider():identity?.identity({forHistory:true}))||null,transport:{claim:async id=>{
   const keys=(await store.readAll('sessions')).filter(r=>!r.accountKey&&(!r.principalId||r.principalId===id.principalId)).map(r=>r.key);
   const result=await historyTransport.claim(id);if(result.status==='accepted'){await store.confirmClaim(id,result);await store.assignAccount(keys,id.principalId,id.accountKey);}return result;
  }}}):null;
 const capture=(snapshot,options={})=>{
  // Clone now, before the application mutates its state again. No sync fields are
  // ever added to the legacy object, CSV or Buddy payload.
  const copy=JSON.parse(JSON.stringify(snapshot));
  queue=queue.then(async()=>{
   try{const record=await store.capture(copy,options);lastError=failed.length?'local_storage_unavailable':null;publish({...await store.status(),state:record.issue?'error':config.enabled?'pending':'disabled',error:record.issue||lastError});engine.schedule(0);if(options.source==='current'&&copy.completed?.length)autoPrompt?.reachedEnd().catch(()=>{});return record;}
   catch{failed.push({snapshot:copy,options});lastError='local_storage_unavailable';publish({state:'error',error:lastError,localSaved:options.legacySaved===true});return null;}
  });return queue;
 };
 const api={store,engine,lastStatus:{state:'disabled',pending:0},authObserved:false,capture,enabled:config.enabled===true,
  historyEnabled:config.enabled===true&&config.historyEnabled===true,
  async savedAccount(legacyId){try{const row=await store.recoverCurrent();return row?.snapshot?.id===legacyId?row.accountKey:null;}catch{return null;}},
  async remoteHistory(options){if(!history)throw new Error('history_disabled');return history.get(options);},
  async authorizeHistory(){await captcha?.authorize();},
  async retry(){await api.retryLocal();let result=await engine.flush();if(result?.error==='captcha_required'&&captcha){await captcha.authorize();result=await engine.flush();}return result;},
  async restoreCurrent(){try{
   const record=await store.recoverCurrent();if(!record)return null;
   let saved=null;try{saved=JSON.parse(localStorage.getItem('arbat-training-current'));}catch{}
   const savedFingerprint=saved?await window.ArbatSyncStore.fingerprint(saved,window.crypto):null;
   if(record.legacySaved===false&&(!saved||savedFingerprint===record.fingerprint||savedFingerprint===record.legacyBaseline)
      ||record.snapshot?.endedAt&&saved?.id===record.snapshot.id)return record.snapshot;
   return null;
  }catch{return null;}},
  importLegacy(){
   if(importPromise)return importPromise;
   importPromise=queue.then(async()=>{try{const result=await store.importLegacy(localStorage);publish({...await store.status(),state:config.enabled?'pending':'disabled'});engine.schedule(0);return result;}
    catch{lastError='local_storage_unavailable';publish({state:'error',error:lastError});return {records:[],issues:[{code:lastError}]};}});
   // Each import record has its own transaction. New live captures must not
   // wait behind the entire history; liveCaptured guards against stale imports.
   return importPromise;
  },
  async retryLocal(){const entries=failed.splice(0);for(const entry of entries)capture(entry.snapshot,entry.options);await queue;lastError=failed.length?'local_storage_unavailable':null;publish({...await store.status(),state:lastError?'error':config.enabled?'pending':'disabled'});},
  async settled(){await queue;if(importPromise)await importPromise;await queue;},
  async localSessions(){await queue;const ops=await store.readAll('operations'),counts=new Map();for(const op of ops)counts.set(op.sessionKey,(counts.get(op.sessionKey)||0)+1);return (await store.readAll('sessions')).filter(r=>r.snapshot).map(r=>({key:r.key,accountKey:r.accountKey,legacySaved:r.legacySaved,snapshot:r.snapshot,confirmedRevision:r.confirmedRevision,issue:r.issue,pending:counts.get(r.key)||0}));}
 };
 window.ArbatTrainingSync=api;
 for(const event of ['buddy:auth-ready','buddy:auth-state-changed','buddy:user-loaded'])window.addEventListener(event,()=>{api.authObserved=true;if(window.ArbatUser?.get?.()||window.Buddy?.auth?.getUser?.())captcha?.cancel?.();});
 window.addEventListener('online',()=>{if(failed.length)api.retryLocal().catch(()=>{});});
 // Legacy import is scheduled after the initial application save so marking does
 // not wait for a potentially large history scan. Network remains disabled.
 setTimeout(()=>api.importLegacy().catch(()=>{}),0);
 autoPrompt=window.ArbatSyncCaptcha?.AutoPrompt?new window.ArbatSyncCaptcha.AutoPrompt({enabled:config.enabled===true,store,navigator:window.navigator,events:window,
  hasBuddy:()=>!!(window.ArbatUser?.get?.()||window.Buddy?.auth?.getUser?.()),
  getStatus:()=>api.lastStatus,authorize:async()=>{if(window.ArbatUser?.get?.()||window.Buddy?.auth?.getUser?.())return;await captcha?.authorize();engine.schedule(0);}}):null;
 autoPrompt?.start();
 engine.start();
})(window);

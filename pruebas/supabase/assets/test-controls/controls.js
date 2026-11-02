(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{if(root.ArbatTrainingSyncConfig?.storagePrefix==='arbat-supabase-domain-test-v1:')api.install(root);if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',()=>api.mount(root));else api.mount(root);}})(globalThis,()=>{
 'use strict';
 function install(window){
  const config=window.ArbatTrainingSyncConfig,origin=new URL(config.url).origin,originalFetch=window.fetch.bind(window);let offline=false;
  window.fetch=(input,options)=>{const url=new URL(typeof input==='string'?input:input.url,window.location.href);if(offline&&url.origin===origin)return Promise.reject(new TypeError('preview_offline'));return originalFetch(input,options);};
  const state=()=>window.ArbatTrainingSync;
  const api={setOffline(value){offline=Boolean(value);window.dispatchEvent(new window.Event(offline?'offline':'online'));return offline;},
   async verify(){
    if(offline)throw new Error('Restaura la conexión de prueba antes de comprobar el respaldo.');
    const sync=state();await sync.settled();
    if(sync.lastStatus.pending!==0||sync.lastStatus.state!=='synced')throw new Error('Espera a que la barra esté verde y los pendientes lleguen a cero.');
    const before=await sync.store.recoverCurrent();if(!before?.projection||!before.confirmedRevision)throw new Error('Marca primero una flecha de prueba.');
    const identity=await sync.engine.identity();if(!identity||identity.accountKey)throw new Error('Esta comprobación es solo para la prueba sin cuenta.');
    const headers={apikey:config.publishableKey||config.publicKey,Authorization:`Bearer ${identity.supabaseToken}`};
    const read=async(table,params)=>{const url=new URL(`/rest/v1/${table}`,config.url);for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);
     const response=await window.fetch(url.toString(),{method:'GET',headers,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
     if(!response.ok)throw new Error('No se pudo consultar el respaldo. Conserva los datos y comparte este mensaje.');
     const raw=await response.text();if(new TextEncoder().encode(raw).length>1048576)throw new Error('La respuesta supera el límite de esta prueba.');return JSON.parse(raw);
    };
    const [sessions,arrows]=await Promise.all([read('training_sessions',{select:'id,revision',id:`eq.${before.id}`}),read('training_arrows',{select:'id',session_id:`eq.${before.id}`,deleted_at:'is.null'})]);
    const after=await sync.store.recoverCurrent();
    if(after.fingerprint!==before.fingerprint||state().lastStatus.pending!==0)throw new Error('Los datos cambiaron durante la comprobación. Espera a que estén en verde y reintenta.');
    const expected=before.projection.arrows.map(a=>a.id).sort(),actual=arrows.map(a=>a.id).sort();
    if(sessions.length!==1||sessions[0].id!==before.id||Number(sessions[0].revision)!==before.confirmedRevision||JSON.stringify(expected)!==JSON.stringify(actual))throw new Error('El respaldo todavía no coincide con la copia local. Conserva la página para revisarlo.');
    return {arrows:actual.length,revision:Number(sessions[0].revision)};
   }};
  window.ArbatPreviewTest=api;return api;
 }
 function mount(window){
  const document=window.document,pause=document.getElementById('previewPause'),verify=document.getElementById('previewVerify'),message=document.getElementById('previewResult');if(!pause||!verify||!message)return;
  const child=()=>{const api=document.querySelector('iframe')?.contentWindow?.ArbatPreviewTest;if(!api)throw new Error('Espera a que cargue la vista previa.');return api;};let offline=false;
  pause.addEventListener('click',()=>{try{offline=child().setOffline(!offline);pause.textContent=offline?'Restaurar conexión':'Simular sin conexión';pause.setAttribute('aria-pressed',String(offline));message.textContent=offline?'Conexión de prueba pausada. Marca una flecha ficticia: deberá quedar pendiente.':'Conexión restaurada. Espera a que la barra vuelva a verde.';}catch(error){message.textContent=error.message;}});
  verify.addEventListener('click',async()=>{verify.disabled=true;message.textContent='Consultando el respaldo…';try{const result=await child().verify();message.textContent=`Respaldo verificado: ${result.arrows} flechas, revisión ${result.revision}.`;}catch(error){message.textContent=error.message==='preview_offline'?'Restaura la conexión de prueba.':error.message;}finally{verify.disabled=false;}});
 }
 return {install,mount};
});

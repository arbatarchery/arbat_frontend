(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.ArbatSyncUI=api;api.mount(root,root.document);}})(globalThis,()=>{
 'use strict';
 const authErrors={captcha_unavailable:'No se pudo cargar o completar la verificación. Comprueba la conexión y reintenta.',captcha_expired:'La verificación venció. Reintenta para guardar en la nube.',captcha_domain_not_allowed:'Cloudflare todavía no permite la verificación en este dominio. Revisa los dominios del widget.',captcha_sitekey_invalid:'La configuración pública de la verificación no es válida.',captcha_rejected:'Supabase rechazó la verificación. Reintenta y revisa la configuración de Turnstile si vuelve a ocurrir.',anonymous_signin_rate_limited:'Hay demasiados intentos de acceso. Espera unos minutos y reintenta.',anonymous_signin_disabled:'El guardado en la nube sin cuenta no está habilitado en el servidor.',anonymous_signin_failed:'No se pudo iniciar la sesión para guardar en la nube. Tus flechas siguen guardadas en este dispositivo.'};
 const legend=[['green','Verde','Guardado local confirmado y todos los cambios confirmados por el servidor.'],
 ['yellow','Amarillo','Hay cambios pendientes, falta conexión o se necesita confirmar la sesión.'],
 ['red','Rojo','Ocurrió un error que requiere atención. Los detalles indican si afecta el guardado local o el guardado en la nube.'],
 ['gray','Gris','El guardado en la nube está desactivado o todavía no hay confirmaciones del servidor.'],
 ['blue','Celeste','Se está enviando, importando o asignando información a tu cuenta.']];
 function present(status={}){
  if(authErrors[status.error])return {color:'red',title:'No se pudo guardar en la nube',description:authErrors[status.error]};
  const pending=Math.max(0,Number(status.pending)||0);
  if(status.state==='error'||status.blocked||status.issues?.length||status.localSaved===false)return {color:'red',title:'Revisa el guardado',description:status.localSaved===false?'No se confirmó una copia local de algunos cambios. Mantén esta página abierta.':'Hay cambios que necesitan revisión antes de completar el guardado en la nube.'};
  if(status.state==='disabled')return {color:'gray',title:'Guardado en este dispositivo',description:'El guardado en la nube está desactivado. No se han enviado datos.'};
  if(['syncing','importing','claiming'].includes(status.state))return {color:'blue',title:'Preparando el envío a la nube',description:'Puedes seguir registrando flechas. Esperamos la confirmación de los cambios.'};
  if(status.state==='synced'&&pending===0&&status.localSaved===true&&status.lastConfirmedAt)return {color:'green',title:'Datos guardados en la nube',description:'Todos los cambios guardados localmente tienen confirmación del servidor.'};
  if(pending||['offline','pending','auth_required'].includes(status.state))return {color:'yellow',title:'Envío a la nube pendiente',description:status.error==='captcha_required'?'Confirma que eres una persona para guardar en la nube. Puedes seguir registrando flechas.':status.state==='offline'?'Sin conexión. Los cambios guardados localmente se enviarán al recuperarla.':'Los cambios todavía no tienen confirmación del servidor.'};
  return {color:'gray',title:'Sin confirmaciones remotas',description:'La barra cambiará cuando haya datos y confirmaciones de la nube.'};
 }
 function summary(status={},value=present(status)){
  const count=Math.max(0,Number(status.pending)||0),pending=count===1?'1 cambio pendiente':`${count} cambios pendientes`;
  if(value.color==='green')return 'Guardado en este dispositivo y en la nube';
  if(authErrors[status.error])return status.error==='captcha_domain_not_allowed'?'Verificación no autorizada para este dominio · Ver detalles':'No se pudo guardar en la nube · Ver detalles';
  if(value.color==='red')return status.localSaved===false?'Error al guardar en este dispositivo · Revisa los detalles':'El guardado en la nube necesita atención · Revisa los detalles';
  if(value.color==='blue')return status.state==='claiming'?'Vinculando los datos de la nube con tu cuenta…':count?`Enviando ${count===1?'1 cambio':count+' cambios'} a la nube…`:'Preparando el envío a la nube…';
  if(status.state==='offline')return `Sin conexión · ${pending}`;
  if(status.error==='captcha_required')return 'Verificación pendiente para guardar en la nube';
  if(status.state==='auth_required')return 'Sesión pendiente de confirmar para completar el guardado en la nube';
  if(value.color==='yellow')return `Guardado en este dispositivo · ${pending}`;
  return status.state==='disabled'?'Guardado solo en este dispositivo · Nube desactivada':'Todavía no hay datos confirmados en la nube';
 }
 function claimMessage(receipt,accountKey){
  if(!accountKey||receipt?.accountKey!==String(accountKey)||(receipt.sessionsClaimed!==null&&(!Number.isSafeInteger(receipt.sessionsClaimed)||receipt.sessionsClaimed<0)))return '';
  const count=receipt.sessionsClaimed;
  return count>0?`${count===1?'Se asignó 1 sesión ya guardada en la nube':'Se asignaron '+count+' sesiones ya guardadas en la nube'} a tu cuenta. Confirmado por el servidor.`:'Vinculación con tu cuenta confirmada por el servidor.';
 }
 function mount(window,document){
  const trigger=document?.getElementById('syncStatusButton'),dialog=document?.getElementById('syncStatusDialog');if(!trigger||!dialog)return;
  const $=id=>document.getElementById(id),desktop=$('syncDesktopStatus'),triggers=[trigger,desktop].filter(Boolean);let opener=trigger;let latest=window.ArbatTrainingSync?.lastStatus||{state:'disabled'},busy=false,lastRetryError=null;
  const notice=$('syncClaimNotice'),shownClaims=new Set();let claimTimer=null,currentClaim=null;
  const updateClaim=(receipt,accountKey)=>{
   if(!notice)return;const text=claimMessage(receipt,accountKey);
   const key=text?JSON.stringify([receipt.accountKey,receipt.ownerId,receipt.sessionsClaimed]):null;
   if(key===currentClaim)return;
   if(claimTimer!==null){window.clearTimeout(claimTimer);claimTimer=null;}currentClaim=key;
   notice.textContent=text;notice.hidden=!text||shownClaims.has(key);if(notice.hidden)return;
   shownClaims.add(key);claimTimer=window.setTimeout(()=>{claimTimer=null;if(currentClaim===key)notice.hidden=true;},10000);
  };
  const update=detail=>{latest=detail?{...detail,claim:detail.claim===undefined?latest.claim:detail.claim}:latest;const value=present(latest);for(const button of triggers){button.dataset.color=value.color;button.setAttribute('aria-label',`${summary(latest,value)}. Ver detalles de la nube.`);}if($('syncDesktopText'))$('syncDesktopText').textContent=summary(latest,value);
   $('syncStateTitle').textContent=value.title;$('syncStateDescription').textContent=lastRetryError||value.description+(/^\d{6}$/.test(latest.captchaCode||'')?` Código de Cloudflare: ${latest.captchaCode}.`:'');
   $('syncPendingCount').textContent=String(Math.max(0,Number(latest.pending)||0));
   $('syncLocalSaved').textContent=latest.localSaved===true?'Confirmado':latest.localSaved===false?'No confirmado':'Sin confirmar todavía';
   $('syncLastConfirmed').textContent=latest.lastConfirmedAt?new Intl.DateTimeFormat('es-BO',{dateStyle:'short',timeStyle:'short'}).format(new Date(latest.lastConfirmedAt)):'Todavía no hay confirmaciones';
   const user=window.ArbatUser?.get?.()||window.Buddy?.auth?.getUser?.();$('syncAccount').textContent=user?'Con tu cuenta':'Sin cuenta · este dispositivo';
   updateClaim(latest.claim,user?.id??user?._id);
   const retry=$('syncRetry');retry.disabled=busy||Boolean(latest.blocked)||(!window.ArbatTrainingSync?.enabled&&latest.state!=='error');
   retry.textContent=busy?'Reintentando…':latest.blocked?'Revisión pendiente':latest.error==='captcha_required'?'Confirmar y continuar':latest.error?.startsWith('captcha_')?'Reintentar verificación':'Reintentar guardado y envío a la nube';
  };
  for(const button of triggers)button.addEventListener('click',()=>{opener=button;update();if(!dialog.open)dialog.showModal();for(const control of triggers)control.setAttribute('aria-expanded','true');});
  $('syncClose').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{for(const control of triggers)control.setAttribute('aria-expanded','false');opener.focus();});
  $('syncRetry').addEventListener('click',async()=>{if(busy)return;busy=true;lastRetryError=null;update();try{await window.ArbatTrainingSync?.retry();}
   catch(error){lastRetryError=error?.code==='captcha_cancelled'?null:error?.code==='captcha_configuration_required'?'El guardado en la nube todavía necesita configuración. Tus registros locales se conservan.':'No se pudo completar el intento. Tus registros locales se conservan.';}
   finally{busy=false;update();}
  });
  for(const event of ['buddy:auth-state-changed','buddy:auth-ready','buddy:auth-logout'])window.addEventListener(event,()=>update());
  window.addEventListener('arbat:sync-state',event=>{lastRetryError=null;update(event.detail);});update();
 }
 return {present,summary,claimMessage,legend,mount};
});

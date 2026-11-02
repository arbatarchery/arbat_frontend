(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.ArbatSyncUI=api;api.mount(root,root.document);}})(globalThis,()=>{
 'use strict';
 const legend=[['green','Verde','Guardado local confirmado y todos los cambios confirmados por el servidor.'],
 ['yellow','Amarillo','Hay cambios pendientes, falta conexión o se necesita confirmar la sesión.'],
 ['red','Rojo','Ocurrió un error que requiere atención. Los detalles indican si afecta el guardado local o el respaldo.'],
 ['gray','Gris','El respaldo está desactivado o todavía no hay confirmaciones del servidor.'],
 ['blue','Celeste','Se está enviando, importando o asignando información a tu cuenta.']];
 function present(status={}){
  const pending=Math.max(0,Number(status.pending)||0);
  if(status.state==='error'||status.blocked||status.issues?.length||status.localSaved===false)return {color:'red',title:'Revisa el guardado',description:status.localSaved===false?'No se confirmó una copia local de algunos cambios. Mantén esta página abierta.':'Hay cambios que necesitan revisión antes de completar el respaldo.'};
  if(status.state==='disabled')return {color:'gray',title:'Guardado en este dispositivo',description:'El respaldo remoto está desactivado. No se han enviado datos.'};
  if(['syncing','importing','claiming'].includes(status.state))return {color:'blue',title:'Preparando el respaldo',description:'Puedes seguir registrando flechas. Esperamos la confirmación de los cambios.'};
  if(status.state==='synced'&&pending===0&&status.localSaved===true&&status.lastConfirmedAt)return {color:'green',title:'Datos respaldados',description:'Todos los cambios guardados localmente tienen confirmación del servidor.'};
  if(pending||['offline','pending','auth_required'].includes(status.state))return {color:'yellow',title:'Respaldo pendiente',description:status.error==='captcha_required'?'Confirma que eres una persona para iniciar el respaldo. Puedes seguir registrando flechas.':status.state==='offline'?'Sin conexión. Los cambios guardados localmente se enviarán al recuperarla.':'Los cambios todavía no tienen confirmación del servidor.'};
  return {color:'gray',title:'Sin confirmaciones remotas',description:'La barra cambiará cuando haya datos y confirmaciones del respaldo.'};
 }
 function summary(status={},value=present(status)){
  const count=Math.max(0,Number(status.pending)||0),pending=count===1?'1 cambio pendiente':`${count} cambios pendientes`;
  if(value.color==='green')return 'Guardado en este dispositivo y respaldado';
  if(value.color==='red')return status.localSaved===false?'Error al guardar en este dispositivo · Revisa los detalles':'El respaldo necesita atención · Revisa los detalles';
  if(value.color==='blue')return status.state==='claiming'?'Vinculando el respaldo con tu cuenta…':count?`Enviando ${count===1?'1 cambio':count+' cambios'} al respaldo…`:'Preparando el respaldo…';
  if(status.state==='offline')return `Sin conexión · ${pending}`;
  if(status.error==='captcha_required')return 'Verificación pendiente para iniciar el respaldo';
  if(status.state==='auth_required')return 'Sesión pendiente de confirmar para completar el respaldo';
  if(value.color==='yellow')return `Guardado en este dispositivo · ${pending}`;
  return status.state==='disabled'?'Guardado solo en este dispositivo · Respaldo desactivado':'Todavía no hay datos confirmados en el respaldo';
 }
 function mount(window,document){
  const trigger=document?.getElementById('syncStatusButton'),dialog=document?.getElementById('syncStatusDialog');if(!trigger||!dialog)return;
  const $=id=>document.getElementById(id),desktop=$('syncDesktopStatus'),triggers=[trigger,desktop].filter(Boolean);let opener=trigger;let latest=window.ArbatTrainingSync?.lastStatus||{state:'disabled'},busy=false,lastRetryError=null;
  const update=detail=>{latest=detail||latest;const value=present(latest);for(const button of triggers){button.dataset.color=value.color;button.setAttribute('aria-label',`${summary(latest,value)}. Ver detalles del respaldo.`);}if($('syncDesktopText'))$('syncDesktopText').textContent=summary(latest,value);
   $('syncStateTitle').textContent=value.title;$('syncStateDescription').textContent=lastRetryError||value.description;
   $('syncPendingCount').textContent=String(Math.max(0,Number(latest.pending)||0));
   $('syncLocalSaved').textContent=latest.localSaved===true?'Confirmado':latest.localSaved===false?'No confirmado':'Sin confirmar todavía';
   $('syncLastConfirmed').textContent=latest.lastConfirmedAt?new Intl.DateTimeFormat('es-BO',{dateStyle:'short',timeStyle:'short'}).format(new Date(latest.lastConfirmedAt)):'Todavía no hay confirmaciones';
   const user=window.ArbatUser?.get?.()||window.Buddy?.auth?.getUser?.();$('syncAccount').textContent=user?'Con tu cuenta':'Sin cuenta · este dispositivo';
   const retry=$('syncRetry');retry.disabled=busy||Boolean(latest.blocked)||(!window.ArbatTrainingSync?.enabled&&latest.state!=='error');
   retry.textContent=busy?'Reintentando…':latest.blocked?'Revisión pendiente':latest.error==='captcha_required'?'Confirmar y continuar':'Reintentar guardado y respaldo';
  };
  for(const button of triggers)button.addEventListener('click',()=>{opener=button;update();if(!dialog.open)dialog.showModal();for(const control of triggers)control.setAttribute('aria-expanded','true');});
  $('syncClose').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{for(const control of triggers)control.setAttribute('aria-expanded','false');opener.focus();});
  $('syncRetry').addEventListener('click',async()=>{if(busy)return;busy=true;lastRetryError=null;update();try{await window.ArbatTrainingSync?.retry();}
   catch(error){lastRetryError=error?.code==='captcha_configuration_required'?'El respaldo todavía necesita configuración. Tus registros locales se conservan.':'No se pudo completar el intento. Tus registros locales se conservan.';}
   finally{busy=false;update();}
  });
  window.addEventListener('arbat:sync-state',event=>{lastRetryError=null;update(event.detail);});update();
 }
 return {present,summary,legend,mount};
});

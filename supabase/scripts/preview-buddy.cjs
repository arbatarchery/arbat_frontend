(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else api.mount(root);})(globalThis,()=>{
 'use strict';
 const BASE='https://statetty.com/assets/buddy/modules/';
 function mount(window){
  if(window.ArbatTrainingSyncConfig?.storagePrefix!=='arbat-supabase-preview-v1:')return;
  const document=window.document,$=id=>document.getElementById(id),start=$('previewBuddyStart'),form=$('previewBuddyForm'),email=$('previewBuddyEmail'),send=$('previewBuddySend'),logout=$('previewBuddyLogout'),status=$('previewBuddyStatus');
  if(!start||!form||!email||!send||!status)return;
  let loading=null,loaded=false,networkError=false;
  const preference='arbat-supabase-preview-v1:buddy-enabled';
  const update=()=>{
   const user=window.Buddy?.auth?.getUser?.(),state=window.Buddy?.auth?.getState?.();
   start.hidden=!!user;form.hidden=!loaded||!!user;logout.hidden=!user;send.disabled=!!state?.busy;
   if(user){status.textContent=`Buddy conectado${user.name?' · '+user.name:''}. El respaldo verificará tu cuenta en el servidor.`;networkError=false;}
   else if(state?.checking)status.textContent='Comprobando la sesión de Buddy…';
   else if(loaded&&!networkError)status.textContent='Usa tu cuenta Buddy habitual. Recibirás un enlace para volver a esta vista de prueba.';
  };
  const loadScript=path=>new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src=BASE+path+'?v=a12';script.referrerPolicy='no-referrer';
   const timer=setTimeout(()=>reject(new Error('buddy_load_failed')),15000);
   script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);reject(new Error('buddy_load_failed'));};document.head.append(script);
  });
  const connect=async()=>{
   if(loaded){update();return;}if(loading)return loading;
   try{window.localStorage.setItem(preference,'1');}catch{}
   start.disabled=true;status.textContent='Cargando el acceso oficial de Buddy…';
   loading=(async()=>{
    window.BuddyConfig={...(window.BuddyConfig||{}),debug:false,debugMode:false,app:{siteId:'arbat'}};
    await loadScript('telemetry/config.js');await loadScript('telemetry/buddy_telemetry.js');
    // Auth uses the official request transport, but fictitious training events
    // from this isolated preview must not be sent to Statetty telemetry.
    window.Buddy.telemetry.send=()=>Promise.resolve(false);
    await loadScript('auth/config.js');await loadScript('auth/buddy_auth.js');
    loaded=true;update();
   })().catch(()=>{networkError=true;status.textContent='No se pudo cargar Buddy. Comprueba la conexión y reintenta.';loading=null;}).finally(()=>{start.disabled=false;});
   return loading;
  };
  start.addEventListener('click',()=>connect());
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(!loaded||send.disabled)return;send.disabled=true;
   try{
    await window.Buddy.auth.requestLogin(email.value);
    networkError=false;status.textContent='Enlace enviado. Ábrelo en este mismo navegador para regresar a la prueba. No copies el enlace ni sus códigos al chat.';
   }catch{
    networkError=true;status.textContent='No se pudo solicitar el acceso. Buddy debe permitir http://localhost:8000 como origen de prueba; comprueba también la conexión.';
   }finally{send.disabled=false;}
  });
  logout.addEventListener('click',async()=>{if(window.confirm('¿Cerrar la sesión Buddy de esta vista de prueba?'))await window.Buddy.auth.logout();});
  for(const event of ['buddy:auth-ready','buddy:auth-state-changed','buddy:auth-verified','buddy:auth-logout'])window.addEventListener(event,update);
  window.addEventListener('buddy:auth-error',()=>{networkError=true;status.textContent='Buddy no pudo verificar la sesión. Reintenta con un enlace nuevo y revisa que localhost esté autorizado.';});
  let restore=false;try{restore=window.localStorage.getItem(preference)==='1';}catch{}
  if(restore||new URL(window.location.href).searchParams.has('auth'))connect();
  window.ArbatPreviewBuddy={connect};
 }
 return {mount};
});

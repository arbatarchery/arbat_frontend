(() => {
 'use strict';
 const $=id=>document.getElementById(id),D=window.ArbatDiagnostics;
 if(!D)return;
 const labels={ok:'Correcto',unknown:'Sin comprobar',warning:'Advertencia',error:'Error'};
 const names={database:'Base de datos',server:'Función training-sync',identity:'Identificación · Buddy',history:'Consultas de Historial',city:'Proveedor de ciudad',usage:'Guardado de ciudades',space:'Tamaño actual del proyecto',disk:'Disco y WAL',egress:'Transferencia mensual',functions:'Ejecuciones mensuales'};
 let owner=null,allowed=false,generation=0,controller=null,checking=false,lastCheck=0,report=null,probe={},copyReport='';
 const account=()=>{const user=window.ArbatUser?.get?.()||window.Buddy?.auth?.getUser?.();return user?String(user.id??user._id):null;};
 const node=(tag,value)=>{const n=document.createElement(tag);if(value!=null)n.textContent=String(value);return n;};
 const time=v=>v?new Date(v).toLocaleString('es-BO',{timeZone:'America/La_Paz'}):'Sin comprobar';
 function indicator(status){const n=node('span',labels[status]);n.className='system-indicator system-'+status;return n;}
 function effective(row){return row&&Date.now()-row.at>3600000&&row.status==='ok'?{...row,status:'warning',note:'Comprobación de hace más de 1 hora; actualizar.'}:row;}
 function reset(){generation++;controller?.abort();controller=null;allowed=false;checking=false;owner=null;report=null;probe={};lastCheck=0;D.clear();const panel=$('systemStatus');if(panel){panel.hidden=true;panel.open=false;$('systemStatusAreas').replaceChildren();}copyReport='';}
 function authorize(role){
  const current=account();if(!current){reset();return;}
  if(owner&&owner!==current)reset();
  if(!['admin','superadmin'].includes(role)){reset();return;}
  owner=current;allowed=true;$('systemStatus').hidden=false;render();if(!lastCheck)check();
 }
 function rows(){
  const recent=D.snapshot({serverOnly:true}).latest,values={...recent,...probe};
  const b=report?.database_bytes,limit=report?.reference_database_bytes;
  if(Number.isFinite(b)&&b>=0&&Number.isFinite(limit)&&limit>0){const pct=b/limit*100;values.space={status:pct>=95?'error':pct>=80?'warning':'ok',at:Date.parse(report.checked_at),note:`${(b/1000000).toFixed(1)} MB / ${(limit/1000000).toFixed(0)} MB de referencia Free · ${pct.toFixed(1)} %. Tamaño actual de este proyecto; no es el promedio facturado ni el total de la organización.`};}
  return Object.fromEntries(Object.keys(names).map(key=>[key,effective(values[key])||{status:'unknown',note:['egress','functions'].includes(key)?(key==='functions'?'Consumo oficial no conectado. Referencia Free: 500.000 ejecuciones por ciclo.':'Consumo oficial no conectado. Referencia Free: 5 GB sin caché y 5 GB con caché por ciclo; cuotas independientes.'):key==='disk'?'El tamaño de datos no incluye el disco total ni WAL. Consultar Supabase.':'Todavía no hay una comprobación confirmada.'}]));
 }
 function render(){
  if(!allowed||owner!==account()||!$('systemStatus'))return;
  const all=rows(),groups=[['Comunicaciones',['server','identity','history','city']],['Guardado de datos',['database','usage']],['Capacidad · Plan Free',['space','disk','egress','functions']]];
  const root=$('systemStatusAreas');root.replaceChildren();const overall=D.worst(Object.values(all).map(r=>r.status));
  $('systemStatusIndicator').replaceChildren(indicator(overall));
  $('systemStatusChecked').textContent=checking?'Comprobando servicios…':`Última comprobación del panel: ${time(lastCheck)}. Estado según las últimas respuestas comprobadas de los servicios.`;
  for(const [title,keys] of groups){const section=node('section'),heading=node('h3',title);heading.append(indicator(D.worst(keys.map(k=>all[k].status))));section.append(heading);
   const list=node('ul');list.className='system-services';
   for(const key of keys){const r=all[key],li=node('li'),heading=node('div');heading.className='system-service-name';heading.append(node('strong',names[key]),indicator(r.status));li.append(heading);
    const detail=[r.note,r.code&&r.code!=='ok'?`Código: ${r.code}`:null,r.action?`Acción: ${r.action}`:null,r.http?`HTTP ${r.http}`:null,Number.isFinite(r.ms)?`${r.ms} ms`:null,r.at?`Comprobado: ${time(r.at)}`:null].filter(Boolean).join(' · ');li.append(node('p',detail));list.append(li);
   }section.append(list);root.append(section);
  }
  $('systemStatusCheck').disabled=checking;
  copyReport=JSON.stringify({checked_at:lastCheck?new Date(lastCheck).toISOString():null,status:overall,services:all},null,2);
 }
 async function check(){
  if(!allowed||owner!==account()||checking)return;
  if(lastCheck&&Date.now()-lastCheck<30000){$('systemStatusMessage').textContent='Espera 30 segundos entre comprobaciones.';return;}
  const token=generation,current=owner;controller?.abort();controller=new AbortController();const signal=controller.signal;checking=true;$('systemStatusMessage').textContent='';render();
  const valid=()=>token===generation&&allowed&&current===account();
  const tasks=[(async()=>{const start=Date.now();try{
   const result=await window.ArbatTrainingSync.systemStatus({signal});if(!valid())return;
   if(!['admin','superadmin'].includes(result.role)||result.status!=='accepted'){reset();return;}
   report=result;const at=Date.now(),ms=at-start;
   probe.server={status:ms>3000?'warning':'ok',at,ms,action:'system.status',code:'ok'};
   probe.database={status:result.database_read_only?'error':'ok',at,action:'system.status',code:result.database_read_only?'database_read_only':'ok',note:result.database_read_only?'El servidor informa modo de solo lectura.':'Lectura confirmada. Esta prueba no inserta flechas.'};
   probe.identity={status:'ok',at,note:'Cuenta y permisos administrativos verificados por el servidor.'};
  }catch(e){if(!valid()||signal.aborted)return;if(e.httpStatus===401||e.httpStatus===403){reset();return;}probe.server={status:e.httpStatus===429?'warning':e.httpStatus?'error':'unknown',at:Date.now(),action:'system.status',code:e.httpStatus?D.safeCode(e.serverCode||e.code||'system_status_unavailable'):undefined,note:e.httpStatus?undefined:'Sin respuesta confirmada; no es posible determinar el estado del servidor.',http:e.httpStatus};probe.database={status:'unknown',at:Date.now(),note:'No se pudo comprobar la base por esta vía. Revisar el error de training-sync.'};}})(),
  (async()=>{try{const url=new URL(window.ArbatTrainingSyncConfig.cityUrl);url.searchParams.set('event_id',crypto.randomUUID());url.searchParams.set('browser_id',crypto.randomUUID());url.searchParams.set('event_kind','history_open');
   const start=Date.now(),response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});
   const data=await response.json();if(!valid())return;
   const ok=response.ok&&typeof data.proof==='string';delete probe.city;D.record({service:'city',action:'city.lookup',code:ok?'ok':data.error||'city_unavailable',http:response.status,ms:Date.now()-start});
  }catch(e){if(valid()&&!signal.aborted)probe.city={status:'unknown',at:Date.now(),note:'Sin respuesta confirmada del proveedor de ciudad; estado sin comprobar.'};}})()];
  await Promise.allSettled(tasks);if(!valid())return;checking=false;lastCheck=Date.now();render();
 }
 window.addEventListener('arbat:history-role',e=>authorize(e.detail.role));
 window.addEventListener('arbat:history-loaded',e=>{if(e.detail.role==null&&allowed&&owner===account())render();else authorize(e.detail.role);});
 window.addEventListener('arbat:diagnostic',render);
 for(const name of ['buddy:auth-state-changed','buddy:user-loaded','buddy:auth-ready'])window.addEventListener(name,()=>{if(owner!==account())reset();});
 document.addEventListener('DOMContentLoaded',()=>{
  $('systemStatus').open=false;$('systemStatusCheck').addEventListener('click',check);
  $('systemStatusCopy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(copyReport);$('systemStatusMessage').textContent='Diagnóstico copiado, sin credenciales ni nombres de arqueros.';}catch{$('systemStatusMessage').textContent='No se pudo copiar. Puedes seleccionar los códigos visibles.';}});
 });
 setInterval(()=>{if(allowed)render();},60000);
})();

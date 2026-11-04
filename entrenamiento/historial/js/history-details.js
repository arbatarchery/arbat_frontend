(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const desktopScreen=window.matchMedia('(min-width: 860px)');
 let loaded=null,sequence=0,comparisonController=null;
 const signed=()=>!!(window.ArbatUser?.get?.()||window.Buddy?.auth?.getUser?.());
 const text=(tag,value)=>{const node=document.createElement(tag);node.textContent=String(value??'—');return node;};
 const number=n=>Number(n||0).toLocaleString('es-BO',{maximumFractionDigits:2});
 const score=a=>a?.label==='M'?0:Number(a?.score)||0;
 const time=v=>{const d=new Date(v);return v&&!Number.isNaN(+d)?d.toLocaleString('es-BO'):'—';};
 function accountView(){
  const authenticated=signed();$('trainingHistory')?.classList.toggle('history-authenticated',authenticated);
  if(!$('historyLogin'))return;
  $('historyLogin').hidden=authenticated;$('historyDetails').hidden=!authenticated||!desktopScreen.matches;$('historyDesktopInvite').hidden=desktopScreen.matches;$('historyCharts').hidden=!authenticated;
  const select=$('periodSelect');select.disabled=!authenticated;if(!authenticated)select.value='7';
  if(!authenticated){$('historySessionTable').replaceChildren();$('usagePanel').hidden=true;}
 }
 function desktop(){const open=desktopScreen.matches;for(const id of ['historyCharts','historyDetails'])$(id).open=open;}
 function ends(session){
  const rows=(session.completed||[]).map((end,index)=>({...end,ordinal:index+1}));
  if(session.current?.length)rows.push({arrows:session.current,ordinal:rows.length+1,inProgress:true});
  // Older snapshots sometimes contain only a flat arrow collection.
  if(!rows.length&&session.arrows?.length)rows.push({arrows:session.arrows,ordinal:1});
  return rows.map(end=>({...end,sessionType:end.sessionType||session.sessionType||'training',shootingDistance:end.shootingDistance||session.shootingDistance||'',targetSize:end.targetSize||session.targetSize||''}));
 }
 function filtered(session){return ends(session).filter(e=>(!$('detailType').value||e.sessionType===$('detailType').value)&&(!$('detailDistance').value||String(e.shootingDistance)===$('detailDistance').value)&&(!$('detailTarget').value||String(e.targetSize)===$('detailTarget').value));}
 function table(headers){const node=document.createElement('table'),head=document.createElement('thead'),row=document.createElement('tr'),body=document.createElement('tbody');headers.forEach(h=>{const cell=text('th',h);cell.scope='col';row.append(cell);});head.append(row);node.append(head,body);return {node,body};}
 function total(arrows){return arrows.reduce((sum,a)=>sum+score(a),0);}
 function distribution(arrows){const bins=new Map();for(const a of arrows){const label=String(a.label??a.score??'M');bins.set(label,(bins.get(label)||0)+1);}return ['X','10','9','8','7','6','5','4','3','2','1','M'].filter(k=>bins.has(k)).map(k=>`${k}: ${bins.get(k)}`).join(' · ')||'Sin flechas';}
 function renderDetails(){
  if(!loaded||!signed()||!desktopScreen.matches)return;
  const root=$('historySessionTable');root.replaceChildren();
  const {node,body}=table(['Fecha y hora','Tipo / distancia / diana','Andanadas','Flechas','Puntos','Promedio','10 / X / M','Detalle y notas']);let all=[];
  for(const s of [...loaded.sessions].sort((a,b)=>String(b.startedAt||b.date).localeCompare(String(a.startedAt||a.date)))){
   const included=filtered(s);if(!included.length)continue;
   const arrows=included.flatMap(e=>e.arrows||[]);all.push(...arrows);const row=document.createElement('tr');
   const settings=[...new Set(included.map(e=>`${e.sessionType==='competition'?'Competencia':'Entrenamiento'} · ${e.shootingDistance||'—'} · ${e.targetSize||'—'}`))].join(' / ');
   [time(s.startedAt||s.date),settings,included.length,arrows.length,number(total(arrows)),arrows.length?number(total(arrows)/arrows.length):'—',
    ['10','X','M'].map(k=>arrows.filter(a=>String(a.label)===k).length).join(' / ')].forEach(v=>row.append(text('td',v)));
   const cell=document.createElement('td'),details=document.createElement('details');details.append(text('summary','Ver andanadas y flechas'));
   details.append(text('p',`Final: ${s.isCurrent?'En curso':time(s.endedAt)}${s.notes?' · Notas: '+s.notes:''}`));
   // Build potentially large arrow details only when the session is expanded.
   details.addEventListener('toggle',()=>{if(!details.open||details.dataset.built)return;details.dataset.built='1';
    for(const e of included){const points=total(e.arrows||[]),end=document.createElement('details');
     end.append(text('summary',`Andanada ${e.ordinal}${e.inProgress?' · En curso':''} · ${(e.arrows||[]).length} flechas · ${number(points)} puntos · Promedio ${e.arrows?.length?number(points/e.arrows.length):'—'}`));
     end.append(text('p',`Final: ${time(e.endedAt)}${e.notes?' · Notas: '+e.notes:''}`));
     const t=table(['Flecha','Puntaje','Fecha y hora','Impacto X','Impacto Y']);
     (e.arrows||[]).forEach((a,index)=>{const tr=document.createElement('tr');[index+1,a.label??a.score,time(a.recordedAt),Number.isFinite(a.x)?number(a.x):'—',Number.isFinite(a.y)?number(a.y):'—'].forEach(v=>tr.append(text('td',v)));t.body.append(tr);});end.append(t.node);details.append(end);
    }
   });cell.append(details);row.append(cell);body.append(row);
  }
  $('detailDistribution').textContent=`Distribución de puntajes de la tabla · ${all.length} flechas · ${distribution(all)}`;
  if(!body.children.length)root.append(text('p','No hay sesiones con estos filtros.'));else root.append(node);
 }
 async function comparison(){
  if(!loaded||!signed()||!desktopScreen.matches||!window.ArbatTrainingSync?.remoteHistory)return;
  const token=sequence,view=loaded;comparisonController?.abort();comparisonController=new AbortController();const signal=AbortSignal.any([comparisonController.signal,view.signal]);
  $('historyCompare').disabled=true;$('historyComparison').textContent='Cargando el período anterior…';
  const key=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  const end=new Date(view.range.start);end.setDate(end.getDate()-1);const start=new Date(end);start.setDate(start.getDate()-view.range.days+1);
  try{const prior=await window.ArbatTrainingSync.remoteHistory({from:key(start),to:key(end),targetSubject:view.user.id===view.ownId?null:view.user.id,signal});
   if(token!==sequence||!signed())return;
   const previous=(Array.isArray(prior)?prior:prior.sessions||[]).flatMap(s=>s.arrows||[...(s.completed||[]).flatMap(e=>e.arrows||[]),...(s.current||[])]),current=view.sessions.flatMap(s=>s.arrows||[]);
   const average=list=>list.length?number(total(list)/list.length):'—';
   $('historyComparison').textContent=`Períodos completos, sin filtros de tabla. Actual: ${current.length} flechas, promedio ${average(current)}. Anterior (${key(start)} — ${key(end)}): ${previous.length} flechas, promedio ${average(previous)}.`;
  }catch{if(token===sequence&&!signal.aborted)$('historyComparison').textContent='No se pudo cargar la comparación. Puedes reintentar.';}
  finally{if(token===sequence)$('historyCompare').disabled=false;}
 }
 async function usage(view,token){
  const panel=$('usagePanel');panel.hidden=!['admin','superadmin'].includes(view.role);$('usageData').replaceChildren();if(panel.hidden)return;
  $('usageMessage').textContent='Cargando aperturas y ciudades…';
  try{const report=await window.ArbatTrainingSync.usageSummary({from:view.range.startKey,to:view.range.endKey,signal:view.signal});if(token!==sequence||!signed())return;
   const data=$('usageData'),n=report.totals;
   $('usageMessage').textContent=`${number(n.opens)} aperturas · ${number(n.accounts)} cuentas · ${number(n.anonymous_browsers)} navegadores anónimos · ${number(n.cities)} ciudades · ${number(n.countries)} países.`;
   data.append(text('h3','Ciudades observadas'));const cities=table(['Ciudad','Región / país','Aperturas','Andanadas','Última observación']);
   report.cities.forEach(c=>{const row=document.createElement('tr');[c.city,[c.region,c.country].filter(Boolean).join(' / '),c.opens,c.ends,time(c.last_seen)].forEach(v=>row.append(text('td',v)));cities.body.append(row);});const cityScroll=document.createElement('div');cityScroll.className='coach-table-scroll';cityScroll.append(cities.node);data.append(cityScroll);
   data.append(text('h3','Frecuencia de consulta'));const visitors=table(['Arquero / navegador','Aperturas','Días de consulta','Navegadores','Ciudades / países','Última apertura','Última ciudad']);
   report.visitors.forEach(v=>{const row=document.createElement('tr');[v.name,v.opens,v.days,v.browsers,`${v.cities} / ${v.countries}`,time(v.last_open),v.last_city].forEach(value=>row.append(text('td',value)));visitors.body.append(row);});const scroll=document.createElement('div');scroll.className='coach-table-scroll';scroll.append(visitors.node);data.append(scroll);
   data.append(text('p','Se muestran hasta 50 ciudades, 100 cuentas o navegadores y 50 avisos recientes del período. Los totales incluyen todos los eventos del período.'));
   data.append(text('h3','Cambios de ciudad'));if(!report.alerts.length)data.append(text('p','Sin cambios de ciudad detectados en observaciones realizadas al terminar andanadas.'));
   report.alerts.forEach(a=>{const note=text('p',`${a.name} · ${a.kind==='within_session'?'Distintas ciudades en una sesión':'Ciudad distinta entre sesiones'} · ${a.kind==='within_session'?(a.cities_observed||[]).join(' / '):a.previous_city+' → '+a.city} · ${time(a.first_at)}. Es un aviso informativo; revisa la red o ubicación aproximada.`);note.className='usage-warning';data.append(note);});
  }catch{if(token===sequence)$('usageMessage').textContent='Los datos de uso todavía no están disponibles. El entrenamiento y su historial siguen funcionando.';}
 }
 window.addEventListener('arbat:history-loading',()=>{sequence++;loaded=null;comparisonController?.abort();accountView();if($('historyDetails')){$('historyDetails').hidden=true;$('usagePanel').hidden=true;$('historySessionTable').replaceChildren();$('historyComparison').textContent='';$('historyCompare').disabled=false;}});
 window.addEventListener('arbat:history-loaded',event=>{
  const view=event.detail;loaded={...view,ownId:String((window.ArbatUser?.get?.()||window.Buddy?.auth?.getUser?.())?.id??(window.ArbatUser?.get?.()||window.Buddy?.auth?.getUser?.())?._id??'')};accountView();
  if(!signed())return;
  for(const [id,field] of [['detailDistance','shootingDistance'],['detailTarget','targetSize']]){const select=$(id),previous=select.value;select.replaceChildren(new Option('Todas',''));const values=[...new Set(view.sessions.flatMap(ends).map(e=>String(e[field]||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es',{numeric:true}));for(const v of values)select.append(new Option(v,v));if(values.includes(previous))select.value=previous;}
  renderDetails();usage(view,sequence);
 });
 desktopScreen.addEventListener('change',()=>{
  accountView();
  if(desktopScreen.matches)renderDetails();else{comparisonController?.abort();$('historySessionTable').replaceChildren();$('historyComparison').textContent='';$('historyCompare').disabled=false;}
 });
 document.addEventListener('DOMContentLoaded',()=>{accountView();desktop();$('historyLoginButton')?.addEventListener('click',()=>{
  if(window.ArbatUser?.login)window.ArbatUser.login();else if(window.Buddy?.auth?.startAuthenticationPrompt)window.Buddy.auth.startAuthenticationPrompt();else $('historyLoginMessage').textContent='El inicio de sesión todavía se está preparando. Inténtalo de nuevo en unos segundos.';
 });for(const id of ['detailType','detailDistance','detailTarget'])$(id)?.addEventListener('change',renderDetails);$('historyCompare')?.addEventListener('click',comparison);});
})();

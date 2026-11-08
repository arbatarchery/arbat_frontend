(() => {
 'use strict';
 const $=id=>document.getElementById(id);
 const desktopScreen=window.matchMedia('(min-width: 860px)');
 let loaded=null,sequence=0;
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
  if(session.current?.length)rows.push({arrows:session.current,ordinal:rows.length+1,inProgress:!session.endedAt,endedAt:session.current.at(-1)?.recordedAt});
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
  const {node,body}=table(['Detalle','Fecha y hora','Tipo / distancia / diana','Andanadas','Flechas','Puntos','Promedio']);let all=[];
  for(const s of [...loaded.sessions].sort((a,b)=>String(b.startedAt||b.date).localeCompare(String(a.startedAt||a.date)))){
   const included=filtered(s);if(!included.length)continue;
   const arrows=included.flatMap(e=>e.arrows||[]);all.push(...arrows);const row=document.createElement('tr');
   const settings=[...new Set(included.map(e=>`${e.sessionType==='competition'?'Competencia':'Entrenamiento'} · ${e.shootingDistance||'—'} · ${e.targetSize||'—'}`))].join(' / ');
   [loaded.user?.allAthletes?`${s.owner?.name||'Arquero'} · ${time(s.startedAt||s.date)}`:time(s.startedAt||s.date),settings,included.length,arrows.length,number(total(arrows)),arrows.length?number(total(arrows)/arrows.length):'—'].forEach(v=>row.append(text('td',v)));
   const cell=document.createElement('td'),details=document.createElement('details'),summary=text('summary','Más');details.className='history-session-toggle';details.append(summary);
   cell.append(details);row.prepend(cell);body.append(row);
   const expandedRow=document.createElement('tr'),expandedCell=document.createElement('td');expandedCell.colSpan=7;expandedRow.className='history-expanded-session';expandedRow.hidden=true;expandedRow.append(expandedCell);body.append(expandedRow);
   // Build only this session's ends when expanded, and each constellation on its own toggle.
   details.addEventListener('toggle',()=>{
    summary.textContent=details.open?'Menos':'Más';expandedRow.hidden=!details.open;if(!details.open||details.dataset.built)return;details.dataset.built='1';
    expandedCell.append(text('p',`Final: ${s.isCurrent?'En curso':time(s.endedAt)}${s.notes?' · Notas: '+s.notes:''}`));
    for(const e of included){const points=total(e.arrows||[]),end=document.createElement('details');end.className='history-end';
     end.append(text('summary',`Andanada ${e.ordinal}${e.inProgress?' · En curso':''} · ${(e.arrows||[]).length} flechas · ${number(points)} puntos · Promedio ${e.arrows?.length?number(points/e.arrows.length):'—'}`));
     end.addEventListener('toggle',()=>{
      if(!end.open||end.dataset.built)return;end.dataset.built='1';
      end.append(text('p',`Final: ${time(e.endedAt)}${e.notes?' · Notas: '+e.notes:''}`));
      const layout=document.createElement('div');layout.className='history-end-layout';
      const figure=document.createElement('figure');figure.className='history-end-constellation';
      figure.append(text('figcaption',`Constelación · Andanada ${e.ordinal}`));
      if(window.ArbatConstellation?.createEndCanvas){const canvas=window.ArbatConstellation.createEndCanvas(e.arrows||[]);canvas.setAttribute('role','img');canvas.setAttribute('aria-label',`Constelación de las ${e.arrows?.length||0} flechas de la andanada ${e.ordinal}`);figure.append(canvas);}else figure.append(text('p','Constelación no disponible.'));
      const t=table(['Flecha','Puntaje y dirección horaria','Fecha y hora']);
      (e.arrows||[]).forEach((a,index)=>{const tr=document.createElement('tr');[index+1,window.ArbatHistoryArrowDetails.clockLabel(a),time(a.recordedAt)].forEach(v=>tr.append(text('td',v)));t.body.append(tr);});
      const scroll=document.createElement('div');scroll.className='history-end-arrows';scroll.append(t.node);layout.append(figure,scroll);end.append(layout);
     });expandedCell.append(end);
    }
   });
  }
  $('detailDistribution').textContent=`Distribución de puntajes de la tabla · ${all.length} flechas · ${distribution(all)}`;
  if(!body.children.length)root.append(text('p','No hay sesiones con estos filtros.'));else root.append(node);
 }
 let usageCache=null;
 async function usage(view,token){
  const panel=$('usagePanel');panel.hidden=!['admin','superadmin'].includes(view.role);$('usageData').replaceChildren();if(panel.hidden)return;
  $('usageMessage').textContent='Cargando aperturas y ciudades…';
  try{const key=JSON.stringify([view.account,view.range.startKey,view.range.endKey]);
   if(!usageCache||usageCache.key!==key||usageCache.signal.aborted)usageCache={key,signal:view.periodSignal||view.signal,promise:window.ArbatTrainingSync.usageSummary({from:view.range.startKey,to:view.range.endKey,signal:view.periodSignal||view.signal})};
   const report=await usageCache.promise;if(token!==sequence||!signed())return;
   const data=$('usageData'),n=report.totals;
   $('usageMessage').textContent=`${number(n.opens)} aperturas · ${number(n.accounts)} cuentas · ${number(n.anonymous_browsers)} navegadores anónimos · ${number(n.cities)} ciudades · ${number(n.countries)} países.`;
   data.append(text('h3','Ciudades observadas'));const cities=table(['Ciudad','Región / país','Usuarios','Aperturas','Andanadas','Última observación']);
   report.cities.forEach(c=>{
    const row=document.createElement('tr');row.append(text('td',c.city),text('td',[c.region,c.country].filter(Boolean).join(' / ')));
    const cell=document.createElement('td'),toggle=text('button',Array.isArray(c.users)?`Ver usuarios (${number(c.users_total??c.users.length)})`:'Usuarios no disponibles');
    toggle.type='button';toggle.className='city-users-toggle';toggle.setAttribute('aria-expanded','false');cell.append(toggle);row.append(cell);
    [number(c.opens),number(c.ends),time(c.last_seen)].forEach(value=>row.append(text('td',value)));cities.body.append(row);
    const userRows=[];
    const appendRow=tr=>{tr.hidden=true;tr.className='city-user-row';userRows.push(tr);cities.body.append(tr);};
    const notice=message=>{const tr=document.createElement('tr'),td=text('td',message);td.colSpan=6;tr.append(td);appendRow(tr);};
    if(Array.isArray(c.users)){
     c.users.forEach(user=>{
      const tr=document.createElement('tr'),name=document.createElement('td');
      name.className='city-user-name';
      if(user.subject){const button=text('button',user.name);button.type='button';button.className='city-user-link';button.addEventListener('click',()=>window.ArbatTrainingHistory?.selectAthlete(user.subject));name.append(button);}else name.textContent=user.name;
      tr.append(text('td',''),text('td',''),name);
      [number(user.opens),number(user.ends),time(user.last_seen)].forEach(value=>tr.append(text('td',value)));appendRow(tr);
     });
     if(!c.users.length)notice('Sin usuarios registrados para esta ciudad.');
     if(c.users_total>c.users.length)notice(`Se muestran los ${c.users.length} usuarios o navegadores con observación más reciente. Los totales de la ciudad incluyen todos.`);
    }else notice('El detalle de usuarios por ciudad todavía no está disponible.');
    toggle.addEventListener('click',()=>{
     const expanded=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(expanded));
     userRows.forEach(tr=>{tr.hidden=!expanded;});
    });
   });const cityScroll=document.createElement('div');cityScroll.className='coach-table-scroll';cityScroll.append(cities.node);data.append(cityScroll);
   data.append(text('h3','Frecuencia de consulta de historial'));const visitors=table(['Arquero / navegador','Aperturas','Días de consulta','Navegadores','Ciudades / países','Última apertura','Última ciudad']);
   report.visitors.forEach(v=>{const row=document.createElement('tr');[v.name,v.opens,v.days,v.browsers,`${v.cities} / ${v.countries}`,time(v.last_open),v.last_city].forEach(value=>row.append(text('td',value)));visitors.body.append(row);});const scroll=document.createElement('div');scroll.className='coach-table-scroll';scroll.append(visitors.node);data.append(scroll);
   data.append(text('p','Se muestran hasta 50 ciudades, 100 cuentas o navegadores y 50 avisos recientes del período. Los totales incluyen todos los eventos del período.'));
   data.append(text('h3','Cambios de ciudad'));if(!report.alerts.length)data.append(text('p','Sin cambios de ciudad detectados en observaciones realizadas al terminar andanadas.'));
   report.alerts.forEach(a=>{const note=text('p',`${a.name} · ${a.kind==='within_session'?'Distintas ciudades en una sesión':'Ciudad distinta entre sesiones'} · ${a.kind==='within_session'?(a.cities_observed||[]).join(' / '):a.previous_city+' → '+a.city} · ${time(a.first_at)}. Es un aviso informativo; revisa la red o ubicación aproximada.`);note.className='usage-warning';data.append(note);});
  }catch{if(token===sequence)$('usageMessage').textContent='Los datos de uso todavía no están disponibles. El entrenamiento y su historial siguen funcionando.';}
 }
 window.addEventListener('arbat:history-loading',()=>{sequence++;loaded=null;accountView();if($('historyDetails')){$('historyDetails').hidden=true;$('usagePanel').hidden=true;$('historySessionTable').replaceChildren();}});
 window.addEventListener('arbat:history-loaded',event=>{
  const view=event.detail;loaded=view;accountView();
  if(!signed())return;
  for(const [id,field] of [['detailDistance','shootingDistance'],['detailTarget','targetSize']]){const select=$(id),previous=select.value;select.replaceChildren(new Option('Todas',''));const values=[...new Set(view.sessions.flatMap(ends).map(e=>String(e[field]||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es',{numeric:true}));for(const v of values)select.append(new Option(v,v));if(values.includes(previous))select.value=previous;}
  renderDetails();usage(view,sequence);
 });
 desktopScreen.addEventListener('change',()=>{
  accountView();
  if(desktopScreen.matches)renderDetails();else{$('historySessionTable').replaceChildren();}
 });
 document.addEventListener('DOMContentLoaded',()=>{accountView();desktop();$('historyLoginButton')?.addEventListener('click',()=>{
  if(window.ArbatUser?.login)window.ArbatUser.login();else if(window.Buddy?.auth?.startAuthenticationPrompt)window.Buddy.auth.startAuthenticationPrompt();else $('historyLoginMessage').textContent='El inicio de sesión todavía se está preparando. Inténtalo de nuevo en unos segundos.';
 });for(const id of ['detailType','detailDistance','detailTarget'])$(id)?.addEventListener('change',renderDetails);});
})();

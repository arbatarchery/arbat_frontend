(() => {
  'use strict';
  const engine=window.ArbatRecognitions,storage=window.ArbatTrainingStorage||window.localStorage;
  const read=(key,fallback)=>{try{return JSON.parse(storage.getItem(key))??fallback;}catch{return fallback;}};
  const write=(key,value)=>{try{storage.setItem(key,JSON.stringify(value));return true;}catch{return false;}};
  const readDevice=()=>{try{return storage.getItem('arbat-anonymous-device-id')||'';}catch{return '';}};
  const identity=()=>{const u=window.ArbatUser?.get?.()||window.Buddy?.auth?.getUser?.();return String(u?.id??u?._id??u?.email??`anon:${readDevice()}`);};
  const dateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const format=(n,d=1)=>Number(n).toLocaleString('es-BO',{maximumFractionDigits:d});
  let cache=[],scope='',generation=0,dialog=null,aliases=new Map();
  const element=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
  function description(r){
    if(r.type==='record')return `${format(r.after,2)} puntos por flecha · marca anterior ${format(r.before,2)} · ${r.count} flechas · ${r.configuration[0]} m · diana ${r.configuration[1]} cm.`;
    if(r.type==='return')return `${r.count} días desde tu última sesión. Cada regreso es una nueva oportunidad para entrenar.`;
    if(r.type==='grouping'||r.type==='consistency')return `${format(r.change*100)}% menos ${r.type==='grouping'?'dispersión media':'variación entre agrupaciones'}. Últimas ${r.count} andanadas frente a las ${r.count} anteriores. Cada agrupación se mide respecto a su propio centroide.`;
    if(r.type==='precision')return `+${format(r.change*100)}% en el promedio: de ${format(r.before,2)} a ${format(r.after,2)} puntos por flecha. ${r.count} flechas en cada muestra.`;
    return r.message||'';
  }
  function card(r){const box=element('article');box.className='arbat-recognition';box.append(element('h3',r.title),element('p',description(r)));if(r.periods)box.append(element('small',`${r.configuration[0]} m · diana ${r.configuration[1]} cm · ${r.configuration[2]==='competition'?'Competencia':'Entrenamiento'} · ${r.periods[0].from} – ${r.periods[0].to} frente a ${r.periods[1].from} – ${r.periods[1].to} · ${format(r.before,2)} → ${format(r.after,2)} mm`));return box;}
  function backdropArrows(sessions, now=new Date()){
    const first=new Date(now);
    first.setDate(first.getDate()-6);
    const from=dateKey(first),to=dateKey(now);
    let best=[],bestDate='';
    for(const session of sessions){
      const date=session.date||(session.endedAt||session.startedAt||'').slice(0,10);
      if(session.isCurrent||!date||date<from||date>to)continue;
      const arrows=window.ArbatConstellation?.sessionArrows(session)||engine.arrows(session);
      if(arrows.length>best.length||(arrows.length===best.length&&date>bestDate)){
        best=arrows;
        bestDate=date;
      }
    }
    return best;
  }
  function show(title,content,sessions){
    dialog?.close();
    dialog?.remove();
    const modal=element('dialog');
    dialog=modal;
    modal.className='arbat-recognition-dialog';
    const heading=content.querySelector('h2')||element('h2',title);
    heading.id='arbatRecognitionTitle';
    modal.setAttribute('aria-labelledby',heading.id);
    if(!heading.parentNode)content.prepend(heading);
    content.classList.add('arbat-recognition-dialog-content');
    const backdrop=window.ArbatConstellation?.createEndCanvas(backdropArrows(sessions),{innerOnly:true});
    if(backdrop){
      backdrop.className='arbat-recognition-backdrop';
      backdrop.setAttribute('aria-hidden','true');
      modal.append(backdrop);
    }
    const close=element('button','Sigamos entrenando');
    close.type='button';
    close.className='btn arbat-recognition-close';
    close.addEventListener('click',()=>modal.close());
    modal.addEventListener('click',event=>{
      if(event.target!==modal)return;
      const {left,right,top,bottom}=modal.getBoundingClientRect();
      if(event.clientX<left||event.clientX>=right||event.clientY<top||event.clientY>=bottom)modal.close();
    });
    modal.addEventListener('close',()=>{
      if(dialog===modal)dialog=null;
      modal.remove();
    },{once:true});
    modal.append(content,close);
    document.body.append(modal);
    modal.showModal();
  }
  function remember(session,history,id){
    // Derived cache stays outside training snapshots, CSV and Statetty payloads.
    const key=`arbat-recognitions-results:${id}`,saved=read(key,{});
    const source=JSON.stringify([session,history]);let hash=2166136261;
    for(let i=0;i<source.length;i++){hash^=source.charCodeAt(i);hash=Math.imul(hash,16777619);}
    const signature=`${source.length}:${hash}`;
    if(saved[session.id]?.signature===signature)return saved[session.id].result;
    const result=engine.evaluate(session,history);saved[session.id]={signature,result};
    const entries=Object.entries(saved).slice(-100);write(key,Object.fromEntries(entries));return result;
  }
  function monthlyCard(summary){
    const box=element('section');box.className='arbat-monthly';
    box.append(element('p','arbat archery'),element('h2','Mi entrenamiento en números'),element('p','En los últimos 30 días lancé'),element('strong',format(summary.count,0)),element('p','FLECHAS'),element('p','Cada flecha es parte del camino.'),element('small',`${new Date(summary.from).toLocaleDateString('es-BO')} – ${new Date(summary.to).toLocaleDateString('es-BO')}`),element('p','Sentio, ergo attingo. · arbatarchery.com'));
    return box;
  }
  async function available(id){
    let local=read('arbat-training-history',[]);if(!Array.isArray(local))local=[];
    const current=read('arbat-training-current',null);if(current)local.push({...current,isCurrent:true});
    const sync=window.ArbatTrainingSync;let mappings=[];
    try{mappings=(await sync?.localSessions?.()||[]).filter(r=>(r.accountKey||engine.owner(r.snapshot))===id);}catch{}
    const belongs=s=>engine.owner(s)===id||!engine.owner(s)&&id.startsWith('anon:');
    local=local.filter(belongs);
    for(const row of mappings){if((row.accountKey||engine.owner(row.snapshot))!==id)continue;const index=local.findIndex(s=>s.id===row.snapshot.id);if(index<0)local.push(row.snapshot);else if(row.legacySaved===false)local[index]=row.snapshot;}
    if(sync?.historyEnabled){try{
      const remote=await sync.remoteHistory({from:'2000-01-01',to:dateKey(new Date())});
      local=window.ArbatSyncHistory.merge(local,remote,mappings);
    }catch{}}
    return {sessions:engine.unique(local.map(s=>({...s,id:mappings.find(r=>r.snapshot.id===s.id)?.key||s.id,owner:{id}}))),mappings};
  }
  async function refresh(){
    if(!document.getElementById('finishSessionBtn'))return;
    const id=identity(),ticket=++generation;scope=id;cache=[];aliases=new Map();
    const loaded=await available(id);if(ticket!==generation||id!==identity())return;const sessions=loaded.sessions;cache=sessions;aliases=new Map(loaded.mappings.map(r=>[r.snapshot.id,r.key]));
    const summary=engine.monthly(sessions);if(!summary)return;
    const key=`arbat-recognitions-month:${id}`,seen=read(key,{});
    if(seen[summary.month])return;
    // Persist before display; synchronization never replays an announcement.
    seen[summary.month]=summary;if(!write(key,seen))return;
    show('Tu entrenamiento de los últimos 30 días',monthlyCard(summary),sessions);
  }
  window.addEventListener('arbat:session-ended',event=>{
    const session=event.detail,id=identity();if(session.endReason!=='manual'||engine.owner(session)!==id)return;
    const key=`arbat-recognitions-announced:${id}`,seen=read(key,{});if(seen[session.id])return;
    const local=read('arbat-training-history',[]);
    const history=engine.unique([...(scope===id?cache:[]),...(Array.isArray(local)?local:[]).filter(s=>engine.owner(s)===id).map(s=>({...s,id:aliases.get(s.id)||s.id}))]);
    const canonicalSession={...session,id:aliases.get(session.id)||session.id};
    const result=remember(canonicalSession,history,id);seen[session.id]=true;write(key,seen);
    cache=engine.unique([...history,canonicalSession]);const box=element('div');
    for(const record of result.records)box.append(card(record));if(result.ordinary)box.append(card(result.ordinary));
    if(box.children.length)show('Tu evolución deportiva',box,cache);
  });
  window.addEventListener('arbat:history-loading',()=>{const root=document.getElementById('arbatRecognitions');if(root){root.replaceChildren();root.hidden=true;}dialog?.close();});
  window.addEventListener('arbat:history-loaded',event=>{
    const {sessions,user}=event.detail;let root=document.getElementById('arbatRecognitions');
    if(!root){root=element('details');root.open=true;root.className='history-expand';root.id='arbatRecognitions';const list=document.getElementById('sessionList');(list?.closest('.history-sessions')||list)?.before(root);}
    root.hidden=false;root.replaceChildren(element('summary','Tu evolución deportiva'),element('p','Comparaciones basadas en las sesiones disponibles del período seleccionado.'));
    const ordered=engine.unique(sessions).filter(s=>s.endedAt&&!s.isCurrent).sort((a,b)=>Date.parse(b.startedAt||b.date)-Date.parse(a.startedAt||a.date));
    for(const session of ordered.slice(0,12)){
      const scoped=sessions.map(s=>({...s,owner:{id:user.id}}));
      const result=remember({...session,owner:{id:user.id}},scoped,user.id);
      if(result.ordinary){const item=card(result.ordinary);item.prepend(element('small',session.date));root.append(item);}
      for(const record of result.records)root.append(card({...record,title:'Mejor promedio entre sesiones comparables de este período'}));
    }
    if(root.children.length===2)root.append(element('p','Continúa registrando entrenamientos para identificar tendencias. Las comparaciones usan los datos disponibles en el período seleccionado.'));
    if(user.id===identity()){
      const saved=read(`arbat-recognitions-month:${user.id}`,{}),last=Object.keys(saved).sort().at(-1);
      if(last){const button=element('button','Ver mi resumen mensual');button.type='button';button.className='btn';button.addEventListener('click',()=>show('Tu entrenamiento en números',monthlyCard(saved[last]),sessions));root.append(button);}
    }
  });
  for(const name of ['buddy:auth-ready','buddy:auth-state-changed','buddy:user-loaded'])window.addEventListener(name,()=>{if(scope!==identity()){dialog?.close();const root=document.getElementById('arbatRecognitions');if(root){root.replaceChildren();root.hidden=true;}}refresh();});
  document.addEventListener('DOMContentLoaded',()=>{refresh();});
})();

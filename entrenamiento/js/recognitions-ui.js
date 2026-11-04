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
  function show(title,content){
    dialog?.close();dialog?.remove();dialog=element('dialog');dialog.className='arbat-recognition-dialog';
    const heading=element('h2',title);heading.id='arbatRecognitionTitle';dialog.setAttribute('aria-labelledby',heading.id);const close=element('button','Cerrar');close.type='button';close.className='btn';close.addEventListener('click',()=>dialog.close());
    dialog.append(heading,content,element('p','Calculado con el historial disponible. Las sesiones pendientes de sincronización pueden cambiar los resultados.'),close);document.body.append(dialog);dialog.showModal();
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
    box.append(element('p','arbat archery'),element('h3','Mi entrenamiento en números'),element('p','En los últimos 30 días lancé'),element('strong',format(summary.count,0)),element('p','FLECHAS'),element('p','Cada flecha es parte del camino.'),element('small',`${new Date(summary.from).toLocaleDateString('es-BO')} – ${new Date(summary.to).toLocaleDateString('es-BO')} · Datos disponibles en este dispositivo; el total puede cambiar al sincronizar.`),element('p','Sentio, ergo attingo. · arbatarchery.com'));
    const controls=element('div');
    for(const [label,w,h] of [['Historia 9:16',1080,1920],['Publicación 4:5',1080,1350]]){
      const button=element('button',label);button.type='button';button.className='btn';button.addEventListener('click',async()=>{
        const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const c=canvas.getContext('2d');
        c.fillStyle='#122e35';c.fillRect(0,0,w,h);c.textAlign='center';
        const line=(text,y,size,color='#fff')=>{c.font=`${size}px sans-serif`;c.fillStyle=color;c.fillText(text,w/2,y,w-100);};
        line('arbat archery',h*.13,65);line('MI ENTRENAMIENTO EN NÚMEROS',h*.24,34);line('En los últimos 30 días lancé',h*.36,40);line(format(summary.count,0),h*.53,170,'#ebce85');line('FLECHAS',h*.60,60);line('Cada flecha es parte del camino.',h*.72,36);line(`${new Date(summary.from).toLocaleDateString('es-BO')} – ${new Date(summary.to).toLocaleDateString('es-BO')}`,h*.78,28);line('Sentio, ergo attingo.',h*.87,30);line('arbatarchery.com',h*.92,40,'#ebce85');
        canvas.toBlob(async blob=>{if(!blob)return;const file=new File([blob],`arbat-${summary.month}-${w}x${h}.png`,{type:'image/png'});
          try{if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'Mi entrenamiento · arbat archery'});return;}}catch(e){if(e.name==='AbortError')return;}
          const url=URL.createObjectURL(blob),link=element('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        },'image/png');
      });controls.append(button);
    }
    box.append(controls);return box;
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
    show('Tu entrenamiento de los últimos 30 días',monthlyCard(summary));
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
    if(box.children.length)show('Tu evolución deportiva',box);
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
      if(last){const button=element('button','Ver mi resumen mensual');button.type='button';button.className='btn';button.addEventListener('click',()=>show('Tu entrenamiento en números',monthlyCard(saved[last])));root.append(button);}
    }
  });
  for(const name of ['buddy:auth-ready','buddy:auth-state-changed','buddy:user-loaded'])window.addEventListener(name,()=>{if(scope!==identity()){dialog?.close();const root=document.getElementById('arbatRecognitions');if(root){root.replaceChildren();root.hidden=true;}}refresh();});
  document.addEventListener('DOMContentLoaded',()=>{refresh();});
})();

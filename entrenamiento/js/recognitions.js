(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ArbatRecognitions=api;})(globalThis,()=>{
  'use strict';
  const RULES=Object.freeze({ends:6,arrows:36,grouping:.10,consistency:.10,precision:.03,meanTolerance:.02,returnDays:14,volume:.15});
  const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
  const deviation=a=>Math.sqrt(mean(a.map(v=>(v-mean(a))**2)));
  const arrows=s=>[...(s.completed||[]).flatMap(e=>e.arrows||[]),...(s.current||[])];
  const owner=s=>String(s.owner?.id||'');
  const time=s=>Date.parse(s.startedAt||s.date)||0;
  const unique=sessions=>{
    const found=new Map();
    for(const raw of sessions.filter(s=>s&&typeof s==='object')){
      let id=raw.id;
      if(!id){const source=JSON.stringify(raw);let hash=2166136261;for(let i=0;i<source.length;i++){hash^=source.charCodeAt(i);hash=Math.imul(hash,16777619);}id=`legacy:${source.length}:${hash}`;}
      found.set(id,raw.id?raw:{...raw,id});
    }
    return [...found.values()];
  };
  function configuration(e,s){
    const distance=Number(e.shootingDistance??s.shootingDistance),size=Number(e.targetSize??s.targetSize);
    if(!(distance>0&&size>0))return null;
    return JSON.stringify([distance,size,e.sessionType||s.sessionType||'training',e.targetConfiguration||s.targetConfiguration||'standard']);
  }
  function rms(end){
    const a=end.arrows||[];
    if(a.length<2||a.length!==(end.arrowLimit||a.length)||a.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return null;
    const x=mean(a.map(p=>p.x)),y=mean(a.map(p=>p.y));
    return Math.sqrt(mean(a.map(p=>(p.x-x)**2+(p.y-y)**2)));
  }
  function samples(sessions){
    const groups=new Map();
    for(const s of sessions)for(const e of s.completed||[]){
      const key=configuration(e,s);if(!key)continue;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push({end:e,session:s,rms:rms(e)===null?null:rms(e)*JSON.parse(key)[1]*10/92,scores:(e.arrows||[]).map(a=>a.label==='M'?0:Number(a.score)).filter(v=>Number.isFinite(v)&&v>=0&&v<=10)});
    }
    return groups;
  }
  const reduction=(before,after)=>before>0?(before-after)/before:0;
  const result=(type,title,before,after,count)=>({type,title,before,after,count,change:reduction(before,after)});
  function evaluate(session,history){
    const past=unique(history).filter(s=>s.id!==session.id&&owner(s)===owner(session)&&!s.isCurrent&&s.endedAt&&time(s)<=time(session)).sort((a,b)=>time(a)-time(b));
    const groups=samples([...past,session]),candidates=[],records=[];
    for(const [key,all] of groups){
      const current=all.filter(x=>x.session.id===session.id);if(!current.length)continue;
      const bySize=new Map();
      for(const item of all)if(item.rms!==null){const n=item.end.arrows.length;if(!bySize.has(n))bySize.set(n,[]);bySize.get(n).push(item);}
      for(const spatial of bySize.values()){
        const recent=spatial.slice(-RULES.ends),previous=spatial.slice(-2*RULES.ends,-RULES.ends);
        if(previous.length!==RULES.ends||!recent.some(x=>x.session.id===session.id))continue;
        const evidence={configuration:JSON.parse(key),periods:[previous,recent].map(items=>({from:items[0].session.date,to:items.at(-1).session.date}))};
        const a=previous.map(x=>x.rms),b=recent.map(x=>x.rms),before=mean(a),after=mean(b);
        if(reduction(before,after)+1e-12>=RULES.grouping)candidates.push({...result('grouping','¡Tus agrupaciones están mejorando!',before,after,RULES.ends),...evidence});
        if(reduction(deviation(a),deviation(b))+1e-12>=RULES.consistency&&after<=before*(1+RULES.meanTolerance))candidates.push({...result('consistency','¡Tus agrupaciones son más consistentes!',deviation(a),deviation(b),RULES.ends),...evidence});
      }
      const scores=all.flatMap(x=>x.scores),recent=scores.slice(-RULES.arrows),previous=scores.slice(-2*RULES.arrows,-RULES.arrows);
      if(previous.length===RULES.arrows&&recent.length===RULES.arrows&&mean(previous)>0&&(mean(recent)/mean(previous)-1)+1e-12>=RULES.precision)candidates.push({...result('precision','¡Tu promedio está mejorando!',mean(previous),mean(recent),RULES.arrows),change:mean(recent)/mean(previous)-1});
      const windows=[0,1,2].map(i=>scores.slice(-(3-i)*RULES.arrows,i===2?undefined:-(2-i)*RULES.arrows));
      if(windows.every(a=>a.length===RULES.arrows)&&mean(windows[0])<mean(windows[1])&&mean(windows[1])<mean(windows[2]))candidates.push({type:'trend',title:'¡Tu rendimiento mantiene una tendencia positiva!',message:'El promedio aumentó en tres muestras consecutivas de 36 flechas bajo condiciones equivalentes.'});
      const now=current.flatMap(x=>x.scores),prior=[...samples(past).get(key)||[]];
      const sessionMeans=[...new Set(prior.map(x=>x.session.id))].map(id=>prior.filter(x=>x.session.id===id).flatMap(x=>x.scores)).filter(a=>a.length>=RULES.arrows).map(mean);
      if(now.length>=RULES.arrows&&!prior.length)candidates.push({type:'reference',title:'¡Ya tienes tu primera referencia estadística!',message:`${now.length} flechas · ${mean(now).toFixed(2)} puntos por flecha · ${JSON.parse(key)[0]} m.`});
      if(now.length>=RULES.arrows&&sessionMeans.length&&mean(now)>Math.max(...sessionMeans))records.push({type:'record',title:'¡Nuevo récord personal!',before:Math.max(...sessionMeans),after:mean(now),count:now.length,configuration:JSON.parse(key)});
    }
    const last=past.at(-1),gap=last?(time(session)-time(last))/86400000:0;
    if(gap>=RULES.returnDays)candidates.push({type:'return',title:'¡Qué bueno verte de vuelta!',count:Math.floor(gap)});
    const endTime=time(session),days=86400000;
    const totals=[0,1].map(i=>[...past,session].filter(s=>time(s)>endTime-(i+1)*28*days&&time(s)<=endTime-i*28*days).reduce((n,s)=>n+arrows(s).length,0));
    const weeks=[0,1,2,3].map(i=>[...past,session].some(s=>time(s)>endTime-(i+1)*7*days&&time(s)<=endTime-i*7*days));
    if(weeks.every(Boolean))candidates.push({type:'regularity',title:'¡Cuatro semanas con entrenamiento!',message:'Registraste al menos una sesión en cada una de las últimas cuatro semanas.'});
    if(totals[1]>0&&totals[0]/totals[1]-1>=RULES.volume)candidates.push({type:'volume',title:'Tu entrenamiento en números',message:`${totals[0]} flechas en los últimos 28 días, frente a ${totals[1]} en los 28 anteriores. Cada flecha es parte del camino.`});
    const beforeTotal=past.reduce((n,s)=>n+arrows(s).length,0),afterTotal=beforeTotal+arrows(session).length;
    const milestone=[100,500,1000,5000,10000].filter(n=>beforeTotal<n&&afterTotal>=n).at(-1);
    if(milestone)candidates.push({type:'milestone',title:`¡${milestone.toLocaleString('es-BO')} flechas registradas!`,message:'Tu dedicación sigue sumando experiencia.'});
    const order=['grouping','consistency','precision','trend','regularity','volume','return','milestone','reference'];
    candidates.sort((a,b)=>order.indexOf(a.type)-order.indexOf(b.type)||(b.change||0)-(a.change||0));
    return {version:'1.2',sessionId:session.id,ordinary:candidates[0]||null,records};
  }
  function monthly(sessions,now=new Date()){
    const last=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();if(now.getDate()<last-6)return null;
    const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()-29),end=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);
    let count=0;
    for(const s of unique(sessions))for(const a of arrows(s)){
      const raw=a.recordedAt||s.startedAt||s.date;const d=/^\d{4}-\d{2}-\d{2}$/.test(raw)?new Date(raw+'T12:00:00'):new Date(raw);
      if(d>=start&&d<end)count++;
    }
    return count?{month:`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`,count,from:start.toISOString(),to:now.toISOString()}:null;
  }
  return {RULES,rms,evaluate,monthly,unique,arrows,owner};
});

(() => {
  'use strict';
  const MAX = 12, DEFAULT_END_SIZE = 6, MIN_VIEW_SIZE = 25, OUTER_R = 46, BAND = OUTER_R / 10, MOBILE_AIM_OFFSET_PX = 57, MOBILE_ARROW_RADIUS = 1.05, LINE_EPSILON = 1e-9;
  const localDateKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const dateKeyFrom = value => {
    const d=new Date(value);
    return Number.isNaN(d.getTime())?'':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const storageKey = 'arbat-training-current';
  const legacyStorageKey = `arbat-training-${localDateKey()}`;
  const historyStorageKey = 'arbat-training-history';
  const csvStorageKey = `${storageKey}-csv`;
  const anonymousDeviceKey = 'arbat-anonymous-device-id';
  const sessionId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const anonymousDeviceId = () => {
    let id='';
    try{id=localStorage.getItem(anonymousDeviceKey)||'';}catch(_){}
    if(!id){id=sessionId();try{localStorage.setItem(anonymousDeviceKey,id);}catch(_){}}
    return id;
  };
  const ownerSnapshot = () => {
    const user=window.ArbatUser&&typeof window.ArbatUser.get==='function'
      ? window.ArbatUser.get()
      : window.Buddy&&window.Buddy.auth&&typeof window.Buddy.auth.getUser==='function'
        ? window.Buddy.auth.getUser()
        : null;
    const id=user&&(user.id??user._id??user.email);
    if(id!=null&&String(id))return{id:String(id),name:String(user.name||user.firstName||user.email||'Usuario'),anonymous:false};
    const anonymousId=anonymousDeviceId();
    return{id:`anon:${anonymousId}`,name:'',anonymous:true,anonymousId};
  };
  const fresh = () => ({id:sessionId(),date:localDateKey(),startedAt:new Date().toISOString(),completed:[],current:[],arrowsPerEnd:DEFAULT_END_SIZE,sessionType:'training',shootingDistance:'',targetSize:'',notes:'',owner:ownerSnapshot()});
  let state = fresh(), activePointer = null, provisional = null, pendingEndTimer = 0;

  const $ = id => document.getElementById(id);
  const svg = $('target'), wrap = $('targetWrap'), highlight = $('highlight'), aimCrosshair = $('aimCrosshair');
  const vibrate = ms => { if ('vibrate' in navigator) navigator.vibrate(ms); };
  const valueOf = a => a.label === 'M' ? 0 : 10 === a.score ? 10 : a.score;
  const subtotal = arrows => arrows.reduce((s,a) => s + valueOf(a), 0);
  const totalBeforeCurrent = () => state.completed.reduce((s,e) => s + subtotal(e.arrows), 0);  const sessionTotal = () => totalBeforeCurrent() + subtotal(state.current);
  const totalArrowCount = () => state.completed.reduce((sum,end)=>sum+(end.arrows||[]).length,0)+state.current.length;

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || localStorage.getItem(legacyStorageKey));
    if (saved && Array.isArray(saved.completed) && Array.isArray(saved.current)) state = saved;
  } catch (_) {}

  // Compatibilidad con sesiones guardadas por versiones anteriores.
  if(![3,6,12].includes(Number(state.arrowsPerEnd))){
    state.arrowsPerEnd = state.twelveArrows === true || state.current.length > DEFAULT_END_SIZE || state.completed.some(e=>(e.arrows||[]).length>DEFAULT_END_SIZE) ? MAX : DEFAULT_END_SIZE;
  }
  state.arrowsPerEnd=Number(state.arrowsPerEnd);
  if(!['training','competition'].includes(state.sessionType))state.sessionType='training';
  if(typeof state.shootingDistance!=='string')state.shootingDistance=state.shootingDistance==null?'':String(state.shootingDistance);
  if(typeof state.targetSize!=='string')state.targetSize=state.targetSize==null?'':String(state.targetSize);
  if(typeof state.notes!=='string')state.notes='';
  if(!state.id)state.id=sessionId();
  if(!state.startedAt)state.startedAt=state.current[0]?.recordedAt||state.completed[0]?.arrows?.[0]?.recordedAt||new Date().toISOString();
  if(!state.owner)state.owner=ownerSnapshot();

  const endLimit = () => state.arrowsPerEnd;
  const sessionStarted = () => state.current.length > 0 || state.completed.length > 0;
  const sessionHasDifferentDay = () => {
    if(state.date!==localDateKey())return true;
    const timestamps=[
      ...state.completed.map(end=>end.endedAt||end.arrows?.[end.arrows.length-1]?.recordedAt),
      ...state.current.map(arrow=>arrow.recordedAt)
    ].filter(Boolean);
    return timestamps.some(timestamp=>dateKeyFrom(timestamp)!==localDateKey());
  };

  function save(){
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch (_) {}
  }

  function pointFromClient(clientX,clientY){
    const p = svg.createSVGPoint(); p.x = clientX; p.y = clientY;
    const q = p.matrixTransform(svg.getScreenCTM().inverse());
    return {x:q.x, y:q.y};
  }
  const pointFromEvent = e => pointFromClient(e.clientX,e.clientY);
  const usesMobileAimOffset = e => e.pointerType==='touch'&&window.matchMedia('(max-width: 859px)').matches;
  const markPointFromEvent = e => pointFromClient(e.clientX,e.clientY-(usesMobileAimOffset(e)?MOBILE_AIM_OFFSET_PX:0));

  function scorePoint(p,arrowRadius=0){
    const d = Math.hypot(p.x-50,p.y-50);
    // En móvil el círculo representa el tubo: si su borde interior toca una
    // línea, World Archery concede el valor superior. En escritorio el radio
    // es cero y se conserva la precisión puntual del cursor.
    const radius = Math.max(0,arrowRadius);
    const scoringD = Math.max(0,d-radius-(radius?LINE_EPSILON:0));
    if (scoringD > OUTER_R) return {label:'M',score:0,d};
    let score = Math.min(10, Math.max(1, 11-Math.ceil((scoringD || .00001)/BAND)));
    return {label:scoringD <= BAND/2 ? 'X' : String(score),score,d};
  }

  function showProvisional(p,showCrosshair=false){
    provisional = {...scorePoint(p,showCrosshair?MOBILE_ARROW_RADIUS:0),x:p.x,y:p.y};
    $('currentScore').textContent = provisional.label;
    aimCrosshair.setAttribute('transform',`translate(${p.x} ${p.y})`);
    aimCrosshair.style.opacity=showCrosshair?'1':'0';
    if (provisional.label === 'M') { highlight.style.opacity='0'; return; }
    const score = provisional.score;
    highlight.setAttribute('r', provisional.label === 'X' ? BAND/4 : score === 10 ? BAND/2 : OUTER_R-(score-.5)*BAND);
    highlight.setAttribute('stroke-width', provisional.label === 'X' ? BAND/2 : score === 10 ? BAND : BAND*.82);
    highlight.style.opacity='.92';
  }

  function resetProvisional(){ provisional=null; $('currentScore').textContent='—'; highlight.style.opacity='0';aimCrosshair.style.opacity='0'; }

  function finishCurrentEnd(automatic=false){
    clearTimeout(pendingEndTimer);pendingEndTimer=0;
    if(!state.current.length)return;
    const lastArrow=state.current[state.current.length-1];
    state.completed.push({
      arrows:state.current.map(a=>({...a})),
      endedAt:lastArrow.recordedAt||new Date().toISOString(),
      arrowLimit:endLimit(),
      sessionType:state.sessionType,
      shootingDistance:state.shootingDistance,
      targetSize:state.targetSize,
      notes:state.notes
    });
    const ended=state.completed[state.completed.length-1];
    state.current=[];save();vibrate(100);render();
    $('status').textContent=automatic
      ? `Andanada ${state.completed.length} terminada automáticamente y guardada.`
      : `Andanada ${state.completed.length} guardada.`;
    sendAndanadaTelemetry(ended,state.completed.length);
  }

  function addArrow(arrow){
    const limit=endLimit();
    if (state.current.length >= limit) return;
    arrow.recordedAt = arrow.recordedAt || new Date().toISOString();
    state.current.push(arrow); save(); vibrate(40); render();
    const count=state.current.length;
    $('status').textContent=`Flecha ${count} registrada: ${arrow.label}.`;
    if(count===limit)$('status').textContent='Andanada completa. Revisa el total, termina la andanada o borra la última flecha para corregirla.';
  }

  function schedulePendingEnd(){
    clearTimeout(pendingEndTimer);pendingEndTimer=0;
    if(state.current.length<endLimit())return;
    const markedAt=new Date(state.current[state.current.length-1]?.recordedAt||Date.now()).getTime();
    const remaining=Math.max(0,60000-(Date.now()-markedAt));
    pendingEndTimer=setTimeout(()=>finishCurrentEnd(true),remaining);
  }

  // Un dedo marca. Dos dedos cancelan cualquier marca provisional y controlan
  // el viewBox del SVG para ampliar, reducir y desplazar sin alterar coordenadas.
  const pointers=new Map();
  let gesture='idle', pinch=null, suppressMarking=false;
  let zoomView={x:0,y:0,w:100,h:100};
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const pointerPair=()=>Array.from(pointers.entries()).slice(0,2);
  function setZoomView(next){
    const w=clamp(next.w,MIN_VIEW_SIZE,100),h=w;
    zoomView={x:clamp(next.x,0,100-w),y:clamp(next.y,0,100-h),w,h};
    svg.setAttribute('viewBox',`${zoomView.x} ${zoomView.y} ${zoomView.w} ${zoomView.h}`);
    wrap.classList.toggle('is-zoomed',zoomView.w<99.99);
  }
  function beginPinch(){
    const pair=pointerPair();
    if(pair.length<2)return;
    activePointer=null;resetProvisional();gesture='pinch';suppressMarking=true;
    const [a,b]=pair.map(([id,p])=>({id,...p}));
    const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    pinch={
      ids:[a.id,b.id],
      distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),
      view:{...zoomView},
      anchor:pointFromClient(mid.x,mid.y)
    };
    $('status').textContent='Zoom activo: separa, junta o mueve los dos dedos.';
  }
  function updatePinch(){
    if(!pinch)return;
    const a=pointers.get(pinch.ids[0]),b=pointers.get(pinch.ids[1]);
    if(!a||!b)return;
    const distance=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y));
    const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    const rect=svg.getBoundingClientRect();
    const w=clamp(pinch.view.w*pinch.distance/distance,MIN_VIEW_SIZE,100);
    const ux=clamp((mid.x-rect.left)/rect.width,0,1);
    const uy=clamp((mid.y-rect.top)/rect.height,0,1);
    setZoomView({x:pinch.anchor.x-ux*w,y:pinch.anchor.y-uy*w,w});
  }
  function clearPointer(id){
    pointers.delete(id);
    if(!pointers.size){
      gesture='idle';pinch=null;suppressMarking=false;activePointer=null;
      const zoom=Math.round(10000/zoomView.w);
      if(zoom>100)$('status').textContent=`Diana ampliada al ${zoom} %. Usa dos dedos para moverla o reducirla.`;
    }else if(gesture==='pinch'){
      gesture='blocked';pinch=null;
    }
  }
  wrap.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    try{wrap.setPointerCapture(e.pointerId);}catch(_){}
    if(pointers.size>=2){beginPinch();e.preventDefault();return;}
    if(suppressMarking||state.current.length>=endLimit()){gesture='blocked';e.preventDefault();return;}
    activePointer=e.pointerId;gesture='mark';showProvisional(markPointFromEvent(e),usesMobileAimOffset(e));e.preventDefault();
  });
  wrap.addEventListener('pointermove', e => {
    if(!pointers.has(e.pointerId))return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(gesture==='pinch'){updatePinch();e.preventDefault();return;}
    if(gesture==='mark'&&e.pointerId===activePointer){showProvisional(markPointFromEvent(e),usesMobileAimOffset(e));e.preventDefault();}
  });
  wrap.addEventListener('pointerup', e => {
    if(gesture!=='mark'||e.pointerId!==activePointer){clearPointer(e.pointerId);e.preventDefault();return;}
    const rawPoint=pointFromEvent(e),p=markPointFromEvent(e);
    // Pointer capture can deliver the release outside the interactive square.
    // Cancel it instead of inventing a position outside the visible target.
    if(rawPoint.x<0||rawPoint.x>100||rawPoint.y<0||rawPoint.y>100){clearPointer(e.pointerId);resetProvisional();$('status').textContent='Gesto cancelado fuera del área de la diana.';return;}
    showProvisional(p,usesMobileAimOffset(e));
    const arrow={label:provisional.label,score:provisional.score,x:provisional.x,y:provisional.y};
    clearPointer(e.pointerId);resetProvisional();
    addArrow(arrow);
    e.preventDefault();
  });
  wrap.addEventListener('pointercancel', e => {clearPointer(e.pointerId);resetProvisional();});

  $('undoBtn').addEventListener('click',()=>{
    if(!state.current.length) return;
    clearTimeout(pendingEndTimer);pendingEndTimer=0;
    const removed=state.current.pop(); save(); vibrate(40); render();
    $('status').textContent=`Última flecha eliminada (${removed.label}).`;
  });
  $('finishBtn').addEventListener('click',()=>finishCurrentEnd(false));
  $('finishSessionBtn').addEventListener('click',()=>{
    if(!sessionStarted())return;
    if(!window.confirm('¿Terminar esta sesión? La próxima sesión comenzará nuevamente en la andanada 1.'))return;
    const ended=archiveCurrentSession('manual');
    if(ended){vibrate(140);$('status').textContent='Sesión terminada y guardada. Ya puedes configurar una nueva sesión.';}
  });

  function localDateTime(iso){
    if(!iso) return '';
    const d=new Date(iso),pad=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function sortedScores(arrows){
    return arrows.map(a=>({label:a.label,rank:a.label==='X'?11:valueOf(a)})).sort((a,b)=>b.rank-a.rank).map(a=>a.label);
  }
  function polarPosition(arrow){
    if(!Number.isFinite(arrow?.x)||!Number.isFinite(arrow?.y))return {clock:'',angle:'',radius:''};
    const dx=arrow.x-50,dy=arrow.y-50;
    const radius=Math.hypot(dx,dy)/OUTER_R;
    if(radius<1e-8)return {clock:'',angle:'',radius:'0.0000'};
    const angle=(Math.atan2(dx,-dy)*180/Math.PI+360)%360;
    const hour=Math.round(angle/30)%12||12;
    const roundedRadius=arrow.label==='M'&&radius>1?Math.max(1.0001,Number(radius.toFixed(4))):radius;
    return {clock:`${hour} h`,angle:angle.toFixed(1),radius:roundedRadius.toFixed(4)};
  }
  const originalHeader=['Andanada','Separador 1',...Array.from({length:MAX},(_,i)=>`Flecha ${i+1}`),'Separador 2','Total andanada','Total sesión','Separador 3','Fecha y hora de última flecha'];
  const positionHeader=Array.from({length:MAX},(_,i)=>[`Lanzamiento ${i+1} puntaje`,`Lanzamiento ${i+1} hora de marcado`,`Lanzamiento ${i+1} reloj`,`Lanzamiento ${i+1} ángulo (°)`,`Lanzamiento ${i+1} radio (borde=1)`]).flat();
  const dataHeader=[...originalHeader,'Separador 4',...positionHeader,'Tipo de sesión','Notas de la sesión','Distancia de disparo (m)','Tamaño de diana (cm)'];
  const csvComments=[
    '# Registro de entrenamiento de arbat. Este bloque explicativo aparece una sola vez al comienzo del archivo.',
    '# Una fila de datos corresponde a una andanada terminada. Andanada es un número consecutivo dentro de la sesión.',
    '# Separador 1 a Separador 4 son columnas de datos vacías para dividir visualmente las secciones.',
    '# Flecha 1 a Flecha 12 de la primera sección son puntajes ordenados de mayor a menor: X antes de 10 y M al final.',
    '# X suma 10 puntos; M suma 0. Total andanada es la suma de esa fila; Total sesión acumula todas las andanadas terminadas.',
    '# Fecha y hora de última flecha indica cuándo se confirmó la última flecha de la andanada en hora local del dispositivo.',
    '# Lanzamiento 1 a Lanzamiento 12 conservan el orden real de marcado: puntaje y hora de marcado de cada flecha.',
    '# Las horas de marcado permiten calcular intervalos dentro de una andanada y entre andanadas; miden el registro de la flecha y no el disparo físico.',
    '# Reloj señala la dirección desde el centro: 12 h arriba; 3 h derecha; 6 h abajo; 9 h izquierda.',
    '# Ángulo en grados permite analizar la dirección con más detalle: 0 arriba; 90 derecha; 180 abajo; 270 izquierda; sentido horario.',
    '# Radio es la distancia al centro dividida por el radio exterior de la diana: 0 en el centro y 1 en el borde.',
    '# Un radio mayor que 1 indica M fuera de la diana. Reloj y ángulo quedan vacíos cuando la flecha está exactamente en el centro.',
    '# Los valores de reloj; ángulo y radio permiten analizar agrupaciones. Posiciones de M antiguas sin ubicación registrada quedan vacías.',
    '# Fecha y hora usan el formato AAAA-MM-DD HH:mm:ss en la zona horaria local del dispositivo.',
    '# Tipo de sesión queda vacío para Entrenamiento y contiene Tournament para Competencia. El valor corresponde a la opción elegida al terminar cada andanada.',
    '# Notas de la sesión contiene el texto libre cuando aparece por primera vez o cuando cambia respecto de la andanada anterior; si no cambia; la celda queda vacía. Puede describir el campo; el clima; el viento o cómo se sentía el arquero.',
    '# Distancia de disparo (m) y Tamaño de diana (cm) guardan las opciones activas al terminar cada andanada. Quedan vacías si el usuario no proporcionó el dato.'
  ];
  function sessionRows(session=state){
    let running=0,previousNotes='';
    return session.completed.map((end,i)=>{
      const values=sortedScores(end.arrows); while(values.length<MAX)values.push('');
      running+=subtotal(end.arrows);
      const endedAt=end.endedAt||end.arrows[end.arrows.length-1]?.recordedAt||'';
      const positions=Array.from({length:MAX},(_,n)=>{
        const arrow=end.arrows[n];
        if(!arrow)return ['','','','',''];
        const p=polarPosition(arrow);
        return [arrow.label,localDateTime(arrow.recordedAt),p.clock,p.angle,p.radius];
      }).flat();
      const currentNotes=end.notes||'';
      const notesForCsv=currentNotes!==previousNotes?currentNotes:'';
      previousNotes=currentNotes;
      return [i+1,'',...values,'',subtotal(end.arrows),running,'',localDateTime(endedAt),'',...positions,end.sessionType==='competition'?'Tournament':'',notesForCsv,end.shootingDistance||'',end.targetSize||''];
    });
  }
  function csvText(session=state){
    const data=[dataHeader,...sessionRows(session)].map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\r\n');
    // El CSV completo se reconstruye internamente. Nunca se duplican los comentarios iniciales.
    return '\uFEFF'+csvComments.join('\r\n')+'\r\n'+data;
  }

  function archiveCurrentSession(reason){
    clearTimeout(pendingEndTimer);pendingEndTimer=0;
    if(state.current.length){
      const lastArrow=state.current[state.current.length-1];
      const end={
        arrows:state.current.map(a=>({...a})),
        endedAt:lastArrow.recordedAt||new Date().toISOString(),
        arrowLimit:endLimit(),
        sessionType:state.sessionType,
        shootingDistance:state.shootingDistance,
        targetSize:state.targetSize,
        notes:state.notes
      };
      state.completed.push(end);state.current=[];
      sendAndanadaTelemetry(end,state.completed.length);
    }
    if(!state.completed.length){state=fresh();save();render();return false;}
    const snapshot=JSON.parse(JSON.stringify(state));
    const archived={
      ...snapshot,
      endedAt:new Date().toISOString(),
      endReason:reason,
      total:snapshot.completed.reduce((sum,end)=>sum+subtotal(end.arrows||[]),0),
      csv:csvText(snapshot)
    };
    let history=[];
    try{const saved=JSON.parse(localStorage.getItem(historyStorageKey));if(Array.isArray(saved))history=saved;}catch(_){}
    history.push(archived);
    try{localStorage.setItem(historyStorageKey,JSON.stringify(history));}catch(_){}
    window.arbatTrainingHistory=history;
    window.arbatLastCompletedSession=archived;
    window.dispatchEvent(new CustomEvent('arbat:session-ended',{detail:archived}));
    state=fresh();save();render();
    return true;
  }

  // Telemetría de andanadas terminadas (mismo patrón que archeryGame del proyecto
  // Statetty). Envía a Buddy Telemetry los datos registrados por cada flecha.
  function andanadaDatos(end,numero){
    const flechas=end.arrows.map((a,i)=>{
      const polar=polarPosition(a);
      return {
        numero:i+1,
        valor:a.score,
        label:a.label,
        timestamp:a.recordedAt||'',
        horaDeMarcado:localDateTime(a.recordedAt),
        reloj:polar.clock,
        angulo:polar.angle,
        radio:polar.radius,
        posicion:{x:a.x,y:a.y}
      };
    });
    return {
      sesionId:state.id,
      usuario:state.owner||ownerSnapshot(),
      fecha:state.date,
      numero:numero,
      iniciada:end.arrows[0]&&end.arrows[0].recordedAt||null,
      completada:end.endedAt||new Date().toISOString(),
      cantidad:end.arrows.length,
      total:subtotal(end.arrows),
      tipoSesion:end.sessionType==='competition'?'Tournament':'',
      distanciaDisparoMetros:end.shootingDistance||'',
      tamanoDianaCentimetros:end.targetSize||'',
      notas:end.notes||'',
      flechas:flechas
    };
  }
  function sendAndanadaTelemetry(end,numero){
    const data={event:'entrenamiento.andanada',module:'entrenamiento',data:{andanada:andanadaDatos(end,numero)}};
    if(!window.Buddy||!window.Buddy.telemetry||typeof window.Buddy.telemetry.send!=='function'){
      if(window.BuddyConfig&&window.BuddyConfig.debugMode===true) console.log('[Buddy] Telemetry no disponible para entrenamiento.andanada');
      return false;
    }
    if(!window.Buddy.telemetry.config||window.Buddy.telemetry.config.enabled===false){
      if(window.BuddyConfig&&window.BuddyConfig.debugMode===true) console.log('[Buddy] Telemetry deshabilitado para entrenamiento.andanada');
      return false;
    }
    return window.Buddy.telemetry.send(data);
  }

  function renderMarkers(){
    $('markers').replaceChildren(...state.current.flatMap((a,i)=>{
      if(!Number.isFinite(a.x) || !Number.isFinite(a.y)) return [];
      const ns='http://www.w3.org/2000/svg',g=document.createElementNS(ns,'g'),c=document.createElementNS(ns,'circle'),t=document.createElementNS(ns,'text');
      g.setAttribute('class','arrow-marker'+(a.label==='M'?' miss':''));
      const vx=Math.max(2.3,Math.min(97.7,a.x)),vy=Math.max(2.3,Math.min(97.7,a.y));
      c.setAttribute('cx',vx);c.setAttribute('cy',vy);c.setAttribute('r','2.15');
      t.setAttribute('x',vx);t.setAttribute('y',vy+.1);t.textContent=String(i+1);g.append(c,t);return [g];
    }));
  }

  function scoreCard(arrows,index,isCurrent,running,endedAt='',arrowLimit=DEFAULT_END_SIZE){
    const article=document.createElement('article'); article.className='end-card';
    const title=document.createElement('div'); title.className='end-title';
    title.innerHTML=`<span>Andanada ${index+1}</span><small>${isCurrent?'En curso':localDateTime(endedAt)||'Terminada'}</small>`;
    const grid=document.createElement('div');
    const displayValues=sortedScores(arrows);
    const cellCount=Math.min(MAX,Math.max(3,arrowLimit,displayValues.length));
    grid.className='arrow-grid'+(cellCount>DEFAULT_END_SIZE?' extended':'');
    grid.style.setProperty('--arrow-columns',String(Math.min(cellCount,DEFAULT_END_SIZE)));
    for(let i=0;i<cellCount;i++){
      const value=displayValues[i]||'';
      const score=value==='X'?10:Number(value);
      const colorClass=!value?'':value==='M'?' score-miss':score>=9?' score-yellow':score>=7?' score-red':score>=5?' score-blue':score>=3?' score-black':' score-white';
      const cell=document.createElement('div'); cell.className='arrow-cell'+(value?' has-score':'')+colorClass;
      const num=document.createElement('span');num.className='num';num.textContent=`F${i+1}`;
      const val=document.createElement('span');val.className='val';val.textContent=value||'·';cell.append(num,val);grid.append(cell);
    }
    const foot=document.createElement('div');foot.className='totals-row';
    foot.innerHTML=`<span>Subtotal: <strong>${subtotal(arrows)}</strong></span><span>Acumulado: <strong>${running}</strong></span>`;
    article.append(title,grid,foot);return article;
  }

  function renderScores(){
    const box=$('scorecards');box.replaceChildren();let running=0;
    state.completed.forEach((e,i)=>{running+=subtotal(e.arrows);box.append(scoreCard(e.arrows,i,false,running,e.endedAt||e.arrows[e.arrows.length-1]?.recordedAt||'',e.arrowLimit||Math.max(DEFAULT_END_SIZE,e.arrows.length)));});
    if(state.current.length){running+=subtotal(state.current);box.append(scoreCard(state.current,state.completed.length,true,running,'',endLimit()));}
    if(!state.completed.length&&!state.current.length){const p=document.createElement('p');p.className='empty';p.textContent='Los puntajes aparecerán aquí al registrar la primera flecha.';box.append(p);}
  }

  function publishSessionData(){
    // API interna para que otra página pueda guardar o procesar los datos sin
    // mostrar una tabla técnica ni pedir una descarga al usuario.
    const csv=csvText();
    window.arbatSessionData={id:state.id,date:state.date,startedAt:state.startedAt,headers:[...dataHeader],rows:sessionRows(),csv};
    try{const history=JSON.parse(localStorage.getItem(historyStorageKey));window.arbatTrainingHistory=Array.isArray(history)?history:[];}catch(_){window.arbatTrainingHistory=[];}
    try{localStorage.setItem(csvStorageKey,csv);}catch(_){}
  }

  const constellationOverlay=$('constellationOverlay'), constellationImage=$('constellationImage');
  let constellationUrl='',constellationDate='';
  function constellationArrows(session=state){
    return Array.isArray(session.arrows) ? session.arrows : [...(session.completed||[]).flatMap(e=>e.arrows||[]),...(session.current||[])];
  }
  function constellationMeasurement(key,session=state){
    const values=(session.completed||[]).map(end=>end[key]).concat(session[key]).map(value=>String(value||'').trim()).filter(Boolean);
    return [...new Set(values)].join(' / ');
  }
  function previousConstellationSession(){
    if(state.completed.some(end=>(end.arrows||[]).length) || state.current.length>=state.arrowsPerEnd)return null;
    let history=[];
    try{const saved=JSON.parse(localStorage.getItem(historyStorageKey));if(Array.isArray(saved))history=saved;}catch(_){}
    // The in-memory copy can survive a storage write failure when ending a session.
    const owner=ownerSnapshot();
    const candidates=[...history,window.arbatLastCompletedSession].filter(session=>{
      if(!session || session.id===state.id || !constellationArrows(session).length)return false;
      return session.owner?.id!=null ? String(session.owner.id)===String(owner.id) : owner.anonymous;
    });
    return candidates.map((session,index)=>({session,index,time:Date.parse(session.endedAt||session.startedAt||session.date)||0}))
      .sort((a,b)=>b.time-a.time||b.index-a.index)[0]?.session||null;
  }
  function updatePreviousConstellation(){
    $('previousConstellationBtn').hidden=!previousConstellationSession();
  }
  function drawConstellation(session=state){
    const arrows=constellationArrows(session);
    if(!arrows.length)return false;
    const shootingDistance=constellationMeasurement('shootingDistance',session),targetSize=constellationMeasurement('targetSize',session);
    const sharedCanvas=window.ArbatConstellation&&window.ArbatConstellation.createCanvas({arrows,date:session.date,sessionType:session.sessionType,shootingDistance,targetSize,rounds:Array.isArray(session.completed)?session.completed.filter(e=>(e.arrows||[]).length).length+(session.current?.length?1:0):undefined,arrowsPerEnd:session.arrowsPerEnd});
    if(sharedCanvas){
      sharedCanvas.toBlob(blob=>{
        if(!blob)return;
        const previous=constellationUrl;
        constellationUrl=URL.createObjectURL(blob);constellationDate=session.date||'';constellationImage.src=constellationUrl;
        if(previous)URL.revokeObjectURL(previous);
        constellationOverlay.hidden=false;
      },'image/png');
      return true;
    }
    return false;
  }
  $('constellationBtn').addEventListener('click',()=>{
    if(!window.ArbatConstellation){$('status').textContent='No se pudo cargar el generador de constelación. Recarga la página.';return;}
    if(!drawConstellation()){$('status').textContent='Registra al menos una flecha para crear la constelación.';return;}
    $('status').textContent='Constelación creada a partir de los datos de la sesión.';
  });
  $('previousConstellationBtn').addEventListener('click',()=>{
    const previous=previousConstellationSession();
    if(!previous){updatePreviousConstellation();$('status').textContent='No hay una sesión anterior disponible o ya registraste una andanada actual.';return;}
    if(!window.ArbatConstellation){$('status').textContent='No se pudo cargar el generador de constelación. Recarga la página.';return;}
    if(drawConstellation(previous))$('status').textContent=`Constelación de la sesión anterior (${previous.date||'sin fecha'}). La sesión actual se conserva.`;
  });
  $('constellationClose').addEventListener('click',()=>{constellationOverlay.hidden=true;});
  $('constellationDownload').addEventListener('click',()=>{
    if(!constellationUrl)return;
    const a=document.createElement('a');a.href=constellationUrl;a.download=`arbat-constelacion-${constellationDate}.png`;document.body.append(a);a.click();a.remove();
  });

  function render(){
    const count=state.current.length,limit=endLimit(),locked=count>=limit;
    $('endNumber').textContent=state.completed.length+1;$('arrowCount').textContent=`${count} / ${limit}`;    $('endTotal').textContent=subtotal(state.current);$('sessionTotal').textContent=sessionTotal();$('totalArrowCount').textContent=totalArrowCount();
    $('undoBtn').disabled=!count;$('finishBtn').disabled=!count;$('finishSessionBtn').disabled=!sessionStarted();
    document.querySelectorAll('input[name="arrowsPerEnd"]').forEach(input=>{
      input.checked=Number(input.value)===state.arrowsPerEnd;
      input.disabled=sessionStarted();
    });
    document.querySelectorAll('input[name="sessionType"]').forEach(input=>{input.checked=input.value===state.sessionType;});
    if(document.activeElement!==$('shootingDistance'))$('shootingDistance').value=state.shootingDistance;
    if(document.activeElement!==$('targetSize'))$('targetSize').value=state.targetSize;
    if(document.activeElement!==$('sessionNotes'))$('sessionNotes').value=state.notes;
    $('endSummaryTotal').textContent=subtotal(state.current);
    $('endSummaryOverlay').hidden=!locked;
    wrap.setAttribute('aria-disabled',String(locked));renderMarkers();renderScores();publishSessionData();updatePreviousConstellation();
    schedulePendingEnd();
  }

  document.querySelectorAll('input[name="arrowsPerEnd"]').forEach(input=>input.addEventListener('change',e=>{
    if(sessionStarted()){render();return;}
    state.arrowsPerEnd=Number(e.target.value);save();render();
    $('status').textContent=`Sesión configurada con ${state.arrowsPerEnd} flechas por andanada.`;
  }));
  document.querySelectorAll('input[name="sessionType"]').forEach(input=>input.addEventListener('change',e=>{
    state.sessionType=e.target.value;save();render();
    $('status').textContent=state.sessionType==='competition'?'Sesión marcada como Competencia.':'Sesión marcada como Entrenamiento.';
  }));
  const bindMeasurement=(id,key,label)=>$(id).addEventListener('input',e=>{
    const raw=e.target.value.trim();
    state[key]=raw&&Number(raw)>=0?raw:'';save();publishSessionData();
    $('status').textContent=state[key]?`${label}: ${state[key]}. Se aplicará a la andanada actual y a las siguientes.`:`${label} eliminado.`;
  });
  bindMeasurement('shootingDistance','shootingDistance','Distancia de disparo');
  bindMeasurement('targetSize','targetSize','Tamaño de diana');
  $('sessionNotes').addEventListener('input',e=>{
    state.notes=e.target.value;save();publishSessionData();
  });

  $('date').textContent=new Intl.DateTimeFormat('es-BO',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());
  if(sessionHasDifferentDay()){
    const archived=archiveCurrentSession('date-change');
    $('status').textContent=archived
      ? 'La sesión anterior fue cerrada porque pertenecía a otro día. Nueva sesión iniciada en la andanada 1.'
      : 'Nueva sesión del día lista para comenzar.';
  }else{
    save();render();
  }

  // Mensaje de bienvenida de Raulito (módulo says de Buddy) al entrar a la página.
  const MENSAJE_BIENVENIDA='Anotá tus flechas tocando y deslizando sobre la diana. Usá dos dedos para ampliar o mover la diana. Los puntajes se guardan localmente en tu dispositivo.';
  function decirBienvenida(){
    if(window.Buddy&&window.Buddy.says&&typeof window.Buddy.says.decirSiLibre==='function'){
      // Cortés: no pisa nada que ya esté mostrando. Si está ocupado, cae al respaldo.
      if(window.Buddy.says.decirSiLibre(MENSAJE_BIENVENIDA,{emocion:'sereno'})) return;
    }
    if(typeof window.buddy_says==='function') window.buddy_says(MENSAJE_BIENVENIDA,{emocion:'sereno'});
  }
  if(window.Buddy&&window.Buddy.ready){
    decirBienvenida();
  }else if(window.Buddy&&window.Buddy.readyPromise){
    window.Buddy.readyPromise.then(decirBienvenida).catch(function(){});
  }else{
    window.addEventListener('buddy:ready',decirBienvenida,{once:true});
  }
  const syncOwner=()=>{
    const owner=ownerSnapshot();
    if(!owner.anonymous&&(state.owner?.anonymous!==false||state.owner?.id!==owner.id)){state.owner=owner;save();publishSessionData();updatePreviousConstellation();}
  };
  ['buddy:auth-ready','buddy:auth-state-changed','buddy:user-loaded','buddy:user-updated'].forEach(eventName=>window.addEventListener(eventName,syncOwner));
})();



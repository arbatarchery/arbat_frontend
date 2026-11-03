(() => {
  'use strict';
  const localStorage=window.ArbatTrainingStorage||globalThis.localStorage;

  const HISTORY_KEY = 'arbat-training-history';
  const CURRENT_KEY = 'arbat-training-current';
  const ANONYMOUS_DEVICE_KEY = 'arbat-anonymous-device-id';
  let historyError=null,historyFailure=null,historyController=null;
  const $ = id => document.getElementById(id);
  const state = {
    ownUserId: null,
    verifiedRole:null,
    loading:false,loadingCounts:null,
    coaching: null,
    directoryLoaded: false,
    privileged: false,
    users: [],
    selectedUser: null,
    renderSequence: 0,
    chartViewport: { zoom: 1, position: 0, controllers: [], syncing: false }
  };

  const valueOf = arrow => arrow && arrow.label === 'M' ? 0 : Number(arrow && arrow.score) || 0;
  const arrowsOf = session => [...(session.completed || []).flatMap(end => end.arrows || []), ...(session.current || [])];
  const readJson = (key, fallback) => {
    try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; }
    catch (_) { return fallback; }
  };

  function dateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function parseLocalDate(key) {
    const parts = String(key || '').split('-').map(Number);
    return parts.length === 3 ? new Date(parts[0], parts[1] - 1, parts[2]) : new Date(NaN);
  }

  function today() { const date = new Date(); date.setHours(0, 0, 0, 0); return date; }
  function addDays(date, days) { const result = new Date(date); result.setDate(result.getDate() + days); return result; }
  function formatDate(date, options) { return new Intl.DateTimeFormat('es-BO', options).format(date); }
  function formatNumber(value, decimals = 2) { return Number(value).toFixed(decimals).replace('.', ','); }

  function rawCurrentUser() {
    if (window.ArbatUser && typeof window.ArbatUser.get === 'function') return window.ArbatUser.get();
    if (window.Buddy && window.Buddy.auth && typeof window.Buddy.auth.getUser === 'function') return window.Buddy.auth.getUser();
    return null;
  }

  function userId(user) {
    return String(user && (user.id ?? user._id ?? user.buddyUserId ?? user.personaId ?? user.anonymousId ?? user.deviceId ?? user.email) || '');
  }

  function userName(user) {
    return String(user && (user.name || user.nombreCompleto || user.fullName || user.firstName || user.email || user.displayName) || '').trim();
  }

  function normalizeUser(user, fallbackIndex = 0) {
    const id = userId(user) || `anonymous:${fallbackIndex}`;
    const name = userName(user);
    const anonymous = Boolean(user && (user.anonymous || user.anonymousId || user.deviceId || user.macAddress)) || !name;
    const identifier = String(user && (user.anonymousId || user.deviceId || user.macAddress || user.email || id) || id);
    return { id, name: name || `Sin nombre · ${identifier.slice(-8)}`, identifier, anonymous, raw: user || {} };
  }

  function currentUser() {
    const user = rawCurrentUser();
    if (user) return normalizeUser(user);
    let anonymousId = '';
    try { anonymousId = localStorage.getItem(ANONYMOUS_DEVICE_KEY) || ''; } catch (_) {}
    return anonymousId
      ? { id: `anon:${anonymousId}`, name: 'Este dispositivo', identifier: anonymousId, anonymous: true, raw: {} }
      : { id: 'device:local', name: 'Este dispositivo', identifier: 'local', anonymous: true, raw: {} };
  }

  function initials(name) {
    return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'A';
  }

  function rolesOf(user) {
    const values = [];
    ['role', 'rol', 'type', 'tipo'].forEach(key => { if (user && user[key]) values.push(user[key]); });
    [user && user.roles, user && user.permissions && user.permissions.roles].forEach(group => {
      if (Array.isArray(group)) values.push(...group); else if (group) values.push(group);
    });
    return values.flatMap(value => String(value).toLowerCase().split(/[\s,;|]+/)).filter(Boolean);
  }

  function isPrivileged() {
    const buddyAdmin = window.Buddy && window.Buddy.admin;
    if (buddyAdmin && typeof buddyAdmin.isAdmin === 'function' && buddyAdmin.isAdmin()) return true;
    return rolesOf(rawCurrentUser()).some(role => ['admin', 'superadmin', 'instructor', 'trainer', 'coach', 'entrenador'].includes(role));
  }

  function normalizeSession(session) {
    const arrows = Array.isArray(session.arrows) ? session.arrows : arrowsOf(session);
    const startedAt = session.startedAt || session.startTime || arrows[0] && arrows[0].recordedAt || '';
    const endedAt = session.endedAt || session.endTime || arrows[arrows.length - 1] && arrows[arrows.length - 1].recordedAt || '';
    return { ...session, date: session.date || dateKey(startedAt || endedAt), startedAt, endedAt, arrows };
  }

  function localSessions() {
    const saved = readJson(HISTORY_KEY, []);
    const sessions = Array.isArray(saved) ? saved.slice() : [];
    const current = readJson(CURRENT_KEY, null);
    if (current && arrowsOf(current).length) sessions.push({ ...current, isCurrent: true });
    return sessions.map(normalizeSession).filter(session => session.date && session.arrows.length);
  }

  function sessionsForLocalUser(user) {
    return localSessions().filter(session => {
      const ownerId = session.owner && session.owner.id != null ? String(session.owner.id) : '';
      if (user.id === 'device:local') return !ownerId;
      return ownerId ? ownerId === user.id : user.id === currentUser().id;
    });
  }

  function selectedRange() {
    const days = Number($('periodSelect').value) || 30;
    const end = today(), start = addDays(end, -days + 1);
    return { days, start, end, startKey: dateKey(start), endKey: dateKey(end) };
  }

  async function localSessionsWithBackup(user) {
    const sessions=sessionsForLocalUser(user),matched=new Set();
    let backups=[];
    try { backups=await window.ArbatTrainingSync?.localSessions?.()||[]; } catch (_) {}
    const signature=session=>{
      const value={...normalizeSession(session)};delete value.isCurrent;
      return window.ArbatSyncStore?.canonical(value)||JSON.stringify(value);
    };
    for(const record of backups){
      const raw=record.snapshot,ownerId=record.accountKey||String(raw.owner?.id||'');
      if(ownerId?ownerId!==user.id:user.id!==currentUser().id)continue;
      const normalized=normalizeSession(raw);if(!normalized.date||!normalized.arrows.length)continue;
      const index=sessions.findIndex((s,i)=>!matched.has(i)&&(raw.id?s.id===raw.id:!s.id&&signature(s)===signature(raw)));
      if(index>=0){matched.add(index);if(record.legacySaved===false)sessions[index]=normalized;}
      else {matched.add(sessions.length);sessions.push(normalized);}
    }
    return sessions;
  }

  function updateHistoryLoading(sequence,stage,counts={}) {
    if(sequence!==state.renderSequence||!state.loading)return;
    state.loadingCounts={...state.loadingCounts,...counts};
    $('historyLoading').hidden=false;$('historyLoadingStage').textContent=stage;
    const c=state.loadingCounts;
    $('historyLoadingCounts').textContent=`Sesiones: ${c.sessions} · Andanadas: ${c.ends} · Flechas: ${c.arrows} · Arqueros: ${c.athletes}`;
  }

  function waitForHistoryAuth(signal) {
    if(window.navigator.onLine===false)return Promise.reject(Object.assign(new Error('history_offline'),{code:'history_offline'}));
    return new Promise((resolve,reject)=>{
      const events=['buddy:auth-ready','buddy:auth-state-changed','buddy:user-loaded','buddy:ready'];
      let timer,timeout,finished=false;
      const finish=error=>{if(finished)return;finished=true;clearInterval(timer);clearTimeout(timeout);for(const event of events)window.removeEventListener(event,check);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
      const abort=()=>finish(signal.reason||new DOMException('Aborted','AbortError'));
      const check=()=>{
        if(signal.aborted){abort();return;}
        const auth=window.Buddy?.auth,user=rawCurrentUser(),authState=auth?.getState?.();
        if(authState?.checking===true)return;
        if(user&&(typeof auth?.getAccessToken!=='function'||auth.getAccessToken())){finish();return;}
        if(!user&&auth&&(authState?.checking===false||window.ArbatTrainingSync?.authObserved))finish();
      };
      for(const event of events)window.addEventListener(event,check);
      signal.addEventListener('abort',abort,{once:true});
      timer=setInterval(check,200);timeout=setTimeout(()=>finish(Object.assign(new Error('history_auth_timeout'),{code:'history_auth_timeout'})),45000);
      check();
    });
  }

  function safeHistoryDiagnostic(error) {
    const codes=['history_unavailable','history_auth_timeout','history_offline','history_timeout','history_network_error','history_invalid_json','history_disabled','auth_required','auth_changed','buddy_auth_required','buddy_bridge_unavailable','captcha_required','rate_limited','history_changed','history_response_limit','history_cache_limit','invalid_history_page','invalid_history_metadata','invalid_history_detail','invalid_history_parent','invalid_history_cursor'];
    const code=codes.includes(error?.code)?error.code:error?.name==='TimeoutError'?'history_timeout':error?.name==='TypeError'?'history_processing_error':'history_unavailable';
    const parts=[code];
    if(['history.list','history.detail'].includes(error?.historyAction))parts.push(error.historyAction);
    if(['ends','arrows'].includes(error?.historyCollection))parts.push(error.historyCollection);
    if(Number.isInteger(error?.httpStatus)&&error.httpStatus>=400&&error.httpStatus<=599)parts.push('HTTP '+error.httpStatus);
    return parts.join(' · ');
  }

  async function loadSessions(range, user, signal,sequence) {
    const sync=window.ArbatTrainingSync;
    if(sync?.historyEnabled&&window.ArbatSyncHistory){
      let local=await localSessionsWithBackup(user);const own=currentUser();historyError=null;historyFailure=null;
      if(!rawCurrentUser()&&user.id!==own.id)return local.filter(s=>s.date>=range.startKey&&s.date<=range.endKey);
      try{
        const remote=await sync.remoteHistory({from:range.startKey,to:range.endKey,targetSubject:user.id===own.id?null:user.id,signal,onProgress:(_count,counts)=>updateHistoryLoading(sequence,'Conexión con la nube confirmada · Cargando sesiones…',counts)});
        local=await localSessionsWithBackup(user);
        const mappings=(await sync.localSessions()).map(r=>({...r,normalized:normalizeSession(r.snapshot)}));
        const merged=window.ArbatSyncHistory.merge(local,remote,mappings).map(normalizeSession).filter(s=>s.date>=range.startKey&&s.date<=range.endKey);
        Object.defineProperty(merged,'historySource',{value:'mixed'});return merged;
      }catch(error){if(signal?.aborted)throw error;historyError=error.code||'history_unavailable';historyFailure=safeHistoryDiagnostic(error);if(historyError==='auth_required'&&!rawCurrentUser()&&!error.httpStatus){historyError=null;historyFailure=null;}local=await localSessionsWithBackup(user);return local.filter(s=>s.date>=range.startKey&&s.date<=range.endKey);}
    }
    const provider = window.Buddy && window.Buddy.trainingHistory;
    if (provider && typeof provider.getSessions === 'function') {
      const response = await provider.getSessions({ userId: user.id, from: range.startKey, to: range.endKey });
      const list = Array.isArray(response) ? response : response && (response.sessions || response.data) || [];
      return list.map(normalizeSession).filter(session => session.date >= range.startKey && session.date <= range.endKey);
    }
    const sessions = await localSessionsWithBackup(user);
    return sessions.filter(session => session.date >= range.startKey && session.date <= range.endKey);
  }

  function dailyData(sessions, range) {
    const map = new Map();
    for (let index = 0; index < range.days; index += 1) {
      const key = dateKey(addDays(range.start, index));
      map.set(key, { date: key, arrows: 0, total: 0, sessions: [] });
    }
    sessions.forEach(session => {
      const day = map.get(session.date); if (!day) return;
      day.sessions.push(session);
      session.arrows.forEach(arrow => { day.arrows += 1; day.total += valueOf(arrow); });
    });
    return Array.from(map.values()).map(day => ({ ...day, average: day.arrows ? day.total / day.arrows : null }));
  }

  function renderIdentity(user, source = 'local') {
    $('athleteName').textContent = user.name;
    $('athleteAvatar').textContent = initials(user.name);
    if($('athleteRole'))$('athleteRole').textContent=user.id===currentUser().id&&rawCurrentUser()&&window.ArbatTrainingSync?.historyEnabled?({superadmin:'SuperAdmin',admin:'Administrador',coach:'Entrenador',user:'Arquero',unknown:'Acceso sin confirmar'}[state.verifiedRole]||'Verificando acceso…'):'Arquero';
    $('dataScope').textContent = source === 'remote'
      ? `Historial de ${user.name} guardado en arbat.`
      : source==='loading'?'Cargando datos de la nube.':source==='mixed'?`Historial en la nube de ${user.name}, incluidos los cambios locales pendientes.`:`Sesiones de ${user.name} guardadas en este dispositivo.`;
  }

  function renderKpis(sessions) {
    const arrows = sessions.flatMap(session => session.arrows);
    const total = arrows.reduce((sum, arrow) => sum + valueOf(arrow), 0);
    $('kpiSessions').textContent = String(sessions.length);
    $('kpiArrows').textContent = String(arrows.length);
    $('kpiAverage').textContent = arrows.length ? formatNumber(total / arrows.length) : '—';
    $('kpiDays').textContent = String(new Set(sessions.map(session => session.date)).size);
  }

  function closePopover() {
    const popover = $('historyPopover'); popover.hidden = true; popover.replaceChildren();
  }

  function showPopover(content, anchor, wide = false) {
    const popover = $('historyPopover'); popover.replaceChildren();
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'popover-close'; close.setAttribute('aria-label', 'Cerrar'); close.textContent = '×';
    close.addEventListener('click', event => { event.stopPropagation(); closePopover(); });
    popover.append(close, content); popover.classList.toggle('history-popover--wide', wide); popover.hidden = false;
    const rect = anchor.getBoundingClientRect(), box = popover.getBoundingClientRect(), margin = 10;
    let left = rect.left + rect.width / 2 - box.width / 2, top = rect.bottom + 10;
    left = Math.max(margin, Math.min(left, window.innerWidth - box.width - margin));
    if (top + box.height > window.innerHeight - margin) top = Math.max(margin, rect.top - box.height - 10);
    popover.style.left = `${left}px`; popover.style.top = `${top}px`;
  }

  function metricContent(title, day, value, unit) {
    const content = document.createElement('div'), heading = document.createElement('h3'), date = document.createElement('p'), metric = document.createElement('strong');
    heading.textContent = title;
    date.textContent = formatDate(parseLocalDate(day.date), { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
    metric.textContent = `${value} ${unit}`; content.append(heading, date, metric);
    if (day.sessions.length > 1) { const note = document.createElement('small'); note.textContent = `${day.sessions.length} sesiones ese día`; content.append(note); }
    return content;
  }

  function interactive(node, label, callback) {
    node.setAttribute('role', 'button'); node.setAttribute('tabindex', '0'); node.setAttribute('aria-label', label);
    node.addEventListener('click', event => { event.stopPropagation(); callback(node); });
    node.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); callback(node); }
    });
  }

  function constellation(arrows) {
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'day-constellation'); svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Constelación de ${arrows.length} flechas`);
    const rings = [[48, '#f5f5ed'], [43.2, '#f5f5ed'], [38.4, '#17191b'], [33.6, '#17191b'], [28.8, '#21a0d8'], [24, '#21a0d8'], [19.2, '#e64b3e'], [14.4, '#e64b3e'], [9.6, '#ffd52f'], [4.8, '#ffd52f']];
    rings.forEach(([radius, fill]) => {
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', '50'); circle.setAttribute('cy', '50'); circle.setAttribute('r', String(radius)); circle.setAttribute('fill', fill);
      circle.setAttribute('stroke', fill === '#17191b' ? '#727980' : '#25282b'); circle.setAttribute('stroke-width', '.32'); svg.append(circle);
    });
    const crossH = document.createElementNS(ns, 'line'), crossV = document.createElementNS(ns, 'line');
    [['x1', '48'], ['x2', '52'], ['y1', '50'], ['y2', '50']].forEach(([key, value]) => crossH.setAttribute(key, value));
    [['x1', '50'], ['x2', '50'], ['y1', '48'], ['y2', '52']].forEach(([key, value]) => crossV.setAttribute(key, value));
    [crossH, crossV].forEach(line => { line.setAttribute('stroke', '#222'); line.setAttribute('stroke-width', '.35'); svg.append(line); });
    arrows.forEach((arrow, index) => {
      if (!Number.isFinite(Number(arrow.x)) || !Number.isFinite(Number(arrow.y))) return;
      const group = document.createElementNS(ns, 'g'), dot = document.createElementNS(ns, 'circle'), text = document.createElementNS(ns, 'text');
      dot.setAttribute('cx', String(Math.max(1.8, Math.min(98.2, Number(arrow.x))))); dot.setAttribute('cy', String(Math.max(1.8, Math.min(98.2, Number(arrow.y)))));
      dot.setAttribute('r', '2.05'); dot.setAttribute('class', arrow.label === 'M' ? 'constellation-hit is-miss' : 'constellation-hit');
      text.setAttribute('x', dot.getAttribute('cx')); text.setAttribute('y', String(Number(dot.getAttribute('cy')) + .8)); text.setAttribute('class', 'constellation-number');
      text.textContent = String(index + 1); group.append(dot, text); svg.append(group);
    });
    return svg;
  }

  function timeValue(value) {
    const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : formatDate(date, { hour: '2-digit', minute: '2-digit' });
  }

  function sessionMeasurement(session, key) {
    const values = (session.completed || []).map(end => end[key]).concat(session[key]).map(value => String(value || '').trim()).filter(Boolean);
    return [...new Set(values)].join(' / ');
  }

  function sessionConstellation(session, index, totalSessions) {
    const section = document.createElement('section'); section.className = 'session-constellation';
    const heading = document.createElement('h4'), meta = document.createElement('p');
    const start = timeValue(session.startedAt), end = timeValue(session.endedAt);
    heading.textContent = totalSessions > 1 ? `Sesión ${index + 1} · ${start}` : 'Constelación de la sesión';
    meta.textContent = `${session.arrows.length} flechas · ${start}${end !== '—' ? `–${end}` : ''}`;
    const canvas = window.ArbatConstellation && window.ArbatConstellation.createCanvas({
      arrows: session.arrows,
      date: session.date,
      sessionType: session.sessionType,
      rounds: Array.isArray(session.completed) ? session.completed.filter(end => (end.arrows || []).length).length + (session.current && session.current.length ? 1 : 0) : undefined,
      arrowsPerEnd: session.arrowsPerEnd,
      shootingDistance: sessionMeasurement(session, 'shootingDistance'),
      targetSize: sessionMeasurement(session, 'targetSize')
    });
    if (canvas) {
      canvas.className = 'session-constellation-canvas';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Constelación de ${session.arrows.length} flechas de la sesión ${index + 1}`);
      section.append(heading, meta, canvas);
    } else {
      section.append(heading, meta, constellation(session.arrows));
    }
    return section;
  }

  function dayDetails(day) {
    const content = document.createElement('div'); content.className = 'day-detail';
    const title = document.createElement('h3'); title.textContent = formatDate(parseLocalDate(day.date), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const starts = day.sessions.map(session => session.startedAt).filter(Boolean).sort(), ends = day.sessions.map(session => session.endedAt).filter(Boolean).sort();
    const summary = document.createElement('dl');
    [['Hora de inicio', timeValue(starts[0])], ['Hora final', timeValue(ends[ends.length - 1])], ['Puntaje total', String(day.total)], ['Flechas lanzadas', String(day.arrows)], ['Promedio', day.average == null ? '—' : formatNumber(day.average)]].forEach(([label, value]) => {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; summary.append(dt, dd);
    });
    const sessions = day.sessions.slice().sort((first, second) => String(first.startedAt || '').localeCompare(String(second.startedAt || '')));
    content.append(title, summary);
    if(day.studentArrows){const note=document.createElement('p');note.textContent=`Alumnos: ${day.studentArrows} flechas registradas este día.`;content.append(note);}
    sessions.forEach((session, index) => content.append(sessionConstellation(session, index, sessions.length)));
    return content;
  }

  function renderCalendar(days) {
    const root = $('activityCalendar'); root.replaceChildren();
    const max = Math.max(0, ...days.map(day => day.arrows)), firstDay = (parseLocalDate(days[0] && days[0].date).getDay() + 6) % 7;
    ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].forEach(name => {
      const heading = document.createElement('span');
      heading.className = 'activity-weekday';
      const long = document.createElement('span'), short = document.createElement('span');
      long.className = 'activity-weekday-long'; short.className = 'activity-weekday-short';
      long.textContent = name; short.textContent = name.slice(0, 3);
      heading.append(long, short); root.append(heading);
    });
    for (let index = 0; index < firstDay; index += 1) { const blank = document.createElement('span'); blank.className = 'activity-day is-empty'; blank.setAttribute('aria-hidden', 'true'); root.append(blank); }
    days.forEach((day, dayIndex) => {
      const calendarDate = parseLocalDate(day.date);
      const active=day.arrows||day.studentArrows;
      const cell = document.createElement(active ? 'button' : 'span');
      const level = !day.arrows ? 0 : Math.max(1, Math.ceil(day.arrows / Math.max(1, max) * 3));
      const names={competition:'Competencia',training:'Entrenamiento propio',students:'Actividad de alumnos'};
      const label = `${formatDate(calendarDate, { day: 'numeric', month: 'short', year: 'numeric' })}: ${day.arrows} flechas del arquero consultado${day.studentArrows?', '+day.studentArrows+' flechas de alumnos':''}. ${(day.kinds||[]).map(kind=>names[kind]).join(', ')}`;
      cell.className = 'activity-day'+(day.primaryKind?' activity-day--'+day.primaryKind:''); cell.dataset.level = String(level); cell.title = label;
      const number = document.createElement('span'); number.className = 'activity-day-number'; number.textContent = String(calendarDate.getDate()); cell.append(number);
      if (dayIndex === 0 || calendarDate.getDate() === 1) {
        const month = document.createElement('span'); month.className = 'activity-day-month'; month.textContent = formatDate(calendarDate, { month: 'short' }).replace('.', ''); cell.append(month);
      }
      if(day.secondaryKinds?.length){const dots=document.createElement('span');dots.className='activity-day-dots';dots.setAttribute('aria-hidden','true');for(const kind of day.secondaryKinds){const dot=document.createElement('i');dot.className='activity-kind '+kind;dots.append(dot);}cell.append(dots);}
      if (active) {
        cell.type = 'button'; cell.setAttribute('aria-label', `${label}. Mostrar resumen y constelación.`);
        cell.addEventListener('click', event => { event.stopPropagation(); showPopover(dayDetails(day), cell, true); });
      }
      root.append(cell);
    });
  }

  function svgElement(name, attributes = {}) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value))); return node;
  }

  function resetChartViewport() {
    state.chartViewport = { zoom: 1, position: 0, controllers: [], syncing: false };
  }

  function chartScrollPosition(root) {
    const maximum = Math.max(0, root.scrollWidth - root.clientWidth);
    return maximum ? root.scrollLeft / maximum : 0;
  }

  function applyChartViewport(zoom, position) {
    const viewport = state.chartViewport;
    viewport.zoom = Math.max(1, Math.min(20, Number(zoom) || 1));
    viewport.position = Math.max(0, Math.min(1, Number(position) || 0));
    viewport.syncing = true;
    viewport.controllers.forEach(({ root, svg }) => {
      root.dataset.zoom = String(viewport.zoom);
      svg.style.width = `${viewport.zoom * 100}%`;
      root.classList.toggle('is-zoomed', viewport.zoom > 1.01);
      const maximum = Math.max(0, root.scrollWidth - root.clientWidth);
      root.scrollLeft = maximum * viewport.position;
    });
    viewport.syncing = false;
    return viewport.zoom;
  }

  function synchronizeChartScroll(source) {
    if (state.chartViewport.syncing) return;
    applyChartViewport(state.chartViewport.zoom, chartScrollPosition(source));
  }

  function zoomChartsAt(source, requestedZoom, pointerX) {
    const oldWidth = Math.max(1, source.scrollWidth);
    const anchor = (source.scrollLeft + pointerX) / oldWidth;
    const zoom = Math.max(1, Math.min(20, requestedZoom));
    applyChartViewport(zoom, state.chartViewport.position);
    const maximum = Math.max(0, source.scrollWidth - source.clientWidth);
    const desired = anchor * source.scrollWidth - pointerX;
    const position = maximum ? desired / maximum : 0;
    applyChartViewport(zoom, position);
    return zoom;
  }

  function enableChartGestures(root, svg) {
    const pointers = new Map();
    let gesture = null, touchPan = null, suppressClick = false;
    const pair = () => Array.from(pointers.entries()).slice(0, 2);
    const localMidpoint = entries => {
      const rect = root.getBoundingClientRect();
      return ((entries[0][1].x + entries[1][1].x) / 2) - rect.left;
    };
    const distance = entries => Math.max(1, Math.hypot(entries[0][1].x - entries[1][1].x, entries[0][1].y - entries[1][1].y));
    const beginGesture = () => {
      const entries = pair();
      if (entries.length < 2) return;
      const zoom = state.chartViewport.zoom;
      const mid = localMidpoint(entries);
      gesture = {
        distance: distance(entries),
        zoom,
        anchor: (root.scrollLeft + mid) / Math.max(1, root.scrollWidth)
      };
      touchPan = null; suppressClick = true;
      entries.forEach(([id]) => { try { svg.setPointerCapture(id); } catch (_) {} });
      root.classList.add('is-gesturing');
    };
    const updateGesture = event => {
      if (!gesture || pointers.size < 2) return;
      const entries = pair(), mid = localMidpoint(entries);
      const zoom = Math.max(1, Math.min(20, gesture.zoom * distance(entries) / gesture.distance));
      applyChartViewport(zoom, state.chartViewport.position);
      const maximum = Math.max(0, root.scrollWidth - root.clientWidth);
      const desired = gesture.anchor * root.scrollWidth - mid;
      applyChartViewport(zoom, maximum ? desired / maximum : 0);
      event.preventDefault();
    };
    const finishPointer = event => {
      const wasDragging = Boolean(gesture || touchPan && touchPan.active);
      pointers.delete(event.pointerId);
      if (touchPan && touchPan.id === event.pointerId) touchPan = null;
      if (pointers.size < 2) gesture = null;
      if (!gesture && !(touchPan && touchPan.active)) root.classList.remove('is-gesturing');
      if (wasDragging) setTimeout(() => { suppressClick = false; }, 0);
    };
    state.chartViewport.controllers.push({ root, svg });
    applyChartViewport(state.chartViewport.zoom, state.chartViewport.position);
    svg.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch') return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) touchPan = { id: event.pointerId, x: event.clientX, y: event.clientY, scrollLeft: root.scrollLeft, active: false };
      if (pointers.size === 2) { beginGesture(); event.preventDefault(); }
    });
    svg.addEventListener('pointermove', event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (gesture && pointers.size >= 2) { updateGesture(event); return; }
      if (!touchPan || touchPan.id !== event.pointerId || pointers.size !== 1) return;
      const deltaX = event.clientX - touchPan.x, deltaY = event.clientY - touchPan.y;
      if (!touchPan.active && Math.abs(deltaX) > 7 && Math.abs(deltaX) > Math.abs(deltaY)) {
        touchPan.active = true; suppressClick = true; root.classList.add('is-gesturing');
        try { svg.setPointerCapture(event.pointerId); } catch (_) {}
      }
      if (touchPan.active) { root.scrollLeft = touchPan.scrollLeft - deltaX; synchronizeChartScroll(root); event.preventDefault(); }
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => svg.addEventListener(name, finishPointer));
    root.addEventListener('click', event => {
      if (!suppressClick) return;
      event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    root.addEventListener('wheel', event => {
      const zoom = state.chartViewport.zoom;
      if (event.ctrlKey) {
        event.preventDefault();
        const rect = root.getBoundingClientRect(), pointerX = event.clientX - rect.left;
        zoomChartsAt(root, zoom * Math.exp(-event.deltaY * .002), pointerX);
        return;
      }
      if (root.scrollWidth > root.clientWidth + 1) {
        event.preventDefault();
        root.scrollLeft += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        synchronizeChartScroll(root);
      }
    }, { passive: false });
    root.addEventListener('scroll', () => synchronizeChartScroll(root), { passive: true });
  }

  function renderChart(rootId, days, type) {
    const root = $(rootId); root.replaceChildren();
    const active = type === 'average' ? days.filter(day => day.average != null) : days;
    if (!active.some(day => type === 'average' ? day.average != null : day.arrows > 0)) {
      const empty = document.createElement('div'); empty.className = 'chart-empty'; empty.textContent = 'Todavía no hay datos en este período.'; root.append(empty); return;
    }
    const width = 1000, height = 220, left = 48, right = 16, top = 14, bottom = 30;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const xForIndex = index => left + (index + .5) / Math.max(1, days.length) * plotWidth;
    const values = active.map(day => type === 'average' ? day.average : day.arrows), max = type === 'average' ? 10 : Math.max(1, ...values);
    const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none' });
    [0, .5, 1].forEach(ratio => {
      const y = top + plotHeight * ratio; svg.append(svgElement('line', { x1: left, y1: y, x2: width - right, y2: y, class: 'grid-line' }));
      const label = svgElement('text', { x: left - 7, y: y + 4, 'text-anchor': 'end' }); label.textContent = String(Math.round(max * (1 - ratio) * 10) / 10).replace('.', ','); svg.append(label);
    });
    if (type === 'volume') {
      const step = plotWidth / days.length, barWidth = Math.max(1.5, step * .72);
      days.forEach((day, index) => {
        const barHeight = day.arrows / max * plotHeight;
        const bar = svgElement('rect', { x: xForIndex(index) - barWidth / 2, y: top + plotHeight - barHeight, width: barWidth, height: Math.max(0, barHeight), class: 'bar', rx: Math.min(2, barWidth / 2) });
        if (day.arrows) interactive(bar, `${day.date}: ${day.arrows} flechas`, target => showPopover(metricContent('Cantidad de Flechas', day, day.arrows, day.arrows === 1 ? 'flecha' : 'flechas'), target));
        svg.append(bar);
      });
    } else {
      const points = active.map(day => {
        const index = days.findIndex(item => item.date === day.date);
        const x = xForIndex(index), y = top + plotHeight - day.average / max * plotHeight;
        return { x, y, day };
      });
      svg.append(svgElement('path', { d: points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' '), class: 'trend' }));
      points.forEach(point => {
        const hit = svgElement('circle', { cx: point.x, cy: point.y, r: 11, class: 'dot-hit' }), dot = svgElement('circle', { cx: point.x, cy: point.y, r: 3.5, class: 'dot' });
        interactive(hit, `${point.day.date}: promedio ${formatNumber(point.day.average)}`, target => showPopover(metricContent('Promedio del día', point.day, formatNumber(point.day.average), 'puntos'), target));
        svg.append(hit, dot);
      });
    }
    const every = Math.max(1, Math.ceil(days.length / 5));
    days.forEach((day, index) => {
      if (index % every && index !== days.length - 1) return;
      const x = xForIndex(index), label = svgElement('text', { x, y: height - 8, 'text-anchor': 'middle' });
      label.textContent = formatDate(parseLocalDate(day.date), { day: 'numeric', month: 'short' }); svg.append(label);
    });
    root.append(svg); enableChartGestures(root, svg);
  }

  function renderSessions(sessions) {
    const root = $('sessionList'); root.replaceChildren();
    if (!sessions.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = 'No hay sesiones registradas en este período.'; root.append(empty); return; }
    sessions.slice().sort((a, b) => String(b.startedAt || b.date).localeCompare(String(a.startedAt || a.date))).slice(0, 12).forEach(session => {
      const total = session.arrows.reduce((sum, arrow) => sum + valueOf(arrow), 0), average = session.arrows.length ? total / session.arrows.length : 0;
      const row = document.createElement('article'); row.className = 'session-row';
      const text = document.createElement('div'), title = document.createElement('h3'), meta = document.createElement('p');
      title.textContent = formatDate(parseLocalDate(session.date), { weekday: 'short', day: 'numeric', month: 'long' });
      const ends = (session.completed || []).length + (session.current && session.current.length ? 1 : 0);
      meta.textContent = `${session.arrows.length} flechas · ${ends} andanada${ends === 1 ? '' : 's'}${session.isCurrent ? ' · En curso' : ''}`; text.append(title, meta);
      const score = document.createElement('div'); score.className = 'session-score';
      const strong = document.createElement('strong'), small = document.createElement('small'); strong.textContent = formatNumber(average); small.textContent = 'promedio'; score.append(strong, small);
      row.append(text, score); root.append(row);
    });
  }

  function localDirectoryUsers() {
    const users = new Map();
    localSessions().forEach(session => { if (session.owner && session.owner.id != null) { const item = normalizeUser(session.owner); users.set(item.id, item); } });
    const current = currentUser(); users.set(current.id, current); return Array.from(users.values());
  }

  async function fetchDirectoryOnce() {
    if (state.directoryLoaded) return state.users;
    state.directoryLoaded = true;
    const local = localDirectoryUsers(); let remote = [];
    const provider = window.Buddy && window.Buddy.trainingHistory, school = window.Buddy && window.Buddy.archerySchool;
    try {
      if (provider && typeof provider.getUsers === 'function') remote = await provider.getUsers();
      else if (school && typeof school.getUsers === 'function') remote = await school.getUsers();
    } catch (_) { remote = []; }
    const remoteUsers = Array.isArray(remote) ? remote : remote && (remote.users || remote.data) || [], combined = new Map();
    [...local, ...remoteUsers.map(normalizeUser)].forEach((user, index) => { const item = user.id ? user : normalizeUser(user, index); combined.set(item.id, item); });
    state.users = Array.from(combined.values()).sort((a, b) => a.name.localeCompare(b.name, 'es')); return state.users;
  }

  function closeUserResults() { $('athleteResults').hidden = true; $('athleteSearch').setAttribute('aria-expanded', 'false'); }

  function renderUserResults(filter = '') {
    const query = String(filter).trim().toLocaleLowerCase('es');
    const matches = state.users.filter(user => `${user.name} ${user.identifier}`.toLocaleLowerCase('es').includes(query));
    const root = $('athleteResults'); root.replaceChildren();
    matches.forEach(user => {
      const option = document.createElement('button'); option.type = 'button'; option.role = 'option'; option.className = 'athlete-option';
      option.setAttribute('aria-selected', String(state.selectedUser && state.selectedUser.id === user.id));
      const name = document.createElement('strong'), detail = document.createElement('small'); name.textContent = user.name; detail.textContent = user.anonymous ? `Anónimo · ${user.identifier.slice(-12)}` : user.identifier;
      option.append(name, detail); option.addEventListener('click', () => { state.selectedUser = user; $('athleteSearch').value = user.name; closeUserResults(); render(); }); root.append(option);
    });
    if (!matches.length) { const empty = document.createElement('p'); empty.className = 'athlete-results-empty'; empty.textContent = 'No se encontraron usuarios.'; root.append(empty); }
    root.hidden = false; $('athleteSearch').setAttribute('aria-expanded', 'true');
  }

  async function initializeDirectory() {
    if(window.ArbatTrainingSync?.historyEnabled){$('athletePicker').hidden=!state.coaching;return;}

    state.privileged = isPrivileged();
    if (!state.privileged) { $('athletePicker').hidden = true;state.selectedUser=currentUser();return; }
    $('athletePicker').hidden = false; $('athleteSearchStatus').textContent = 'Cargando usuarios…';
    await fetchDirectoryOnce();
    $('athleteSearchStatus').textContent = `${state.users.length} usuario${state.users.length === 1 ? '' : 's'} disponible${state.users.length === 1 ? '' : 's'}.`;
    if (!state.selectedUser) state.selectedUser = currentUser(); $('athleteSearch').value = state.selectedUser.name;
  }

  function clearCoaching() {
    state.coaching=null;state.privileged=false;state.users=[];
    $('coachPanel').hidden=true;$('coachData').hidden=true;$('coachRoster').replaceChildren();
    $('studentActivityLegend').hidden=true;$('athletePicker').hidden=true;
  }

  function renderCoaching(overview) {
    $('coachPanel').hidden=false;$('coachData').hidden=false;$('coachMessage').textContent='';
    $('coachScope').textContent=overview.role==='superadmin'?'Todos los arqueros, de todas las academias.':overview.role==='admin'?'Arqueros de tu academia.':'Arqueros que tienes autorizados para supervisar.';
    $('coachArrows').textContent=String(overview.arrows);
    const root=$('coachRoster');root.replaceChildren();
    overview.athletes.forEach(athlete=>{
      const row=document.createElement('tr'),name=document.createElement('td');
      if(athlete.subject){const button=document.createElement('button');button.type='button';button.textContent=athlete.name;button.addEventListener('click',()=>{state.selectedUser=normalizeUser({id:athlete.subject,name:athlete.name});$('athleteSearch').value=athlete.name;render();});name.append(button);}
      else name.textContent=athlete.name;
      row.append(name);
      let timestamp='Sin sesiones';
      if(athlete.last_session_at){const date=new Date(athlete.last_session_at);if(!Number.isNaN(date.getTime()))timestamp=formatDate(date,{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'America/La_Paz'});}
      else if(athlete.last_session_date)timestamp=formatDate(parseLocalDate(athlete.last_session_date),{day:'2-digit',month:'2-digit',year:'numeric'})+' · hora no disponible';
      for(const value of [timestamp,athlete.last_session_date?String(athlete.day_arrows):'—',athlete.day_average==null?'—':formatNumber(athlete.day_average)]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
      root.append(row);
    });
    if(!overview.athletes.length){const row=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=4;cell.textContent='No hay arqueros disponibles para supervisar.';row.append(cell);root.append(row);}
    state.users=[currentUser(),...overview.athletes.filter(a=>a.subject).map(a=>normalizeUser({id:a.subject,name:a.name}))];
    $('athletePicker').hidden=false;$('athleteSearch').value=(state.selectedUser||currentUser()).name;
    $('athleteSearchStatus').textContent=`${overview.athletes.length} arqueros supervisados. También puedes consultar tu propio historial.`;
  }

  async function loadCoaching(range,signal,sequence) {
    const sync=window.ArbatTrainingSync;if(!sync?.historyEnabled)return;
    clearCoaching();state.verifiedRole=null;if(!rawCurrentUser())return;
    try{
      const context=await sync.historyContext({signal});signal.throwIfAborted();if(sequence!==state.renderSequence)return;
      state.verifiedRole=['user','coach','admin','superadmin'].includes(context.role)?context.role:'unknown';
      updateHistoryLoading(sequence,'Conexión con la nube confirmada · Consultando arqueros…');
      if(!context.can_coach){state.selectedUser=currentUser();return;}
      const overview=await sync.coachOverview({from:range.startKey,to:range.endKey,signal,onProgress:counts=>updateHistoryLoading(sequence,'Conexión con la nube confirmada · Cargando arqueros…',counts)});signal.throwIfAborted();if(sequence!==state.renderSequence)return;
      state.coaching=overview;state.privileged=true;
      const selected=state.selectedUser;
      if(selected&&selected.id!==currentUser().id&&!overview.athletes.some(a=>a.subject===selected.id))state.selectedUser=currentUser();
      renderCoaching(overview);
    }catch(error){
      if(signal.aborted||sequence!==state.renderSequence)return;
      state.verifiedRole=state.verifiedRole||'unknown';state.selectedUser=currentUser();clearCoaching();$('coachPanel').hidden=false;
      $('coachMessage').textContent='No se pudo consultar el acceso de entrenador o las estadísticas. Reintenta la consulta de la nube.';
    }
  }

  async function render() {
    const sequence=++state.renderSequence;closePopover();
    historyController?.abort();const controller=new AbortController();historyController=controller;const signal=controller.signal;
    const range=selectedRange(),cloud=window.ArbatTrainingSync?.historyEnabled;
    historyError=null;historyFailure=null;$('historySyncNotice').hidden=true;$('historySyncDiagnostic').hidden=true;
    state.loading=Boolean(cloud);state.loadingCounts={sessions:0,ends:0,arrows:0,athletes:0};
    if(cloud){clearCoaching();$('trainingHistory').setAttribute('aria-busy','true');$('dataScope').textContent='Cargando datos de la nube.';updateHistoryLoading(sequence,'Preparando tu sesión…');}
    let user,sessions,authFailure=null;
    try{
      if(cloud)try{await waitForHistoryAuth(signal);}catch(error){if(signal.aborted)return;authFailure=error;}
      if(sequence!==state.renderSequence)return;
      const signedUser=currentUser();
      if(state.ownUserId!==signedUser.id){state.ownUserId=signedUser.id;state.selectedUser=signedUser;state.directoryLoaded=false;state.users=[];state.verifiedRole=null;clearCoaching();}
      if(!authFailure){
        updateHistoryLoading(sequence,'Comprobando la conexión con la nube…');
        await loadCoaching(range,signal,sequence);if(sequence!==state.renderSequence)return;
      }else{clearCoaching();historyError=authFailure.code;historyFailure=safeHistoryDiagnostic(authFailure);}
      user=state.selectedUser||currentUser();
      $('periodDates').textContent=`${formatDate(range.start,{day:'numeric',month:'short',year:'numeric'})} — ${formatDate(range.end,{day:'numeric',month:'short',year:'numeric'})}`;
      renderIdentity(user,cloud?'loading':'local');
      if(authFailure)sessions=(await localSessionsWithBackup(user)).filter(s=>s.date>=range.startKey&&s.date<=range.endKey);
      else{
        updateHistoryLoading(sequence,'Cargando sesiones de la nube…');
        sessions=await loadSessions(range,user,signal,sequence);
      }
      if(sequence!==state.renderSequence||signal.aborted)return;
    const ownDays = dailyData(sessions, range),days=window.ArbatHistoryActivity?window.ArbatHistoryActivity.decorate(ownDays,user.id===currentUser().id?state.coaching?.days||[]:[]):ownDays, provider = window.Buddy && window.Buddy.trainingHistory;
    $('studentActivityLegend').hidden=!(state.coaching&&user.id===currentUser().id);
    resetChartViewport();
    renderIdentity(user,sessions.historySource||(!window.ArbatTrainingSync?.historyEnabled&&provider?'remote':'local'));renderKpis(sessions);renderCalendar(days);renderChart('volumeChart',days,'volume');renderChart('averageChart',days,'average');renderSessions(sessions);
    if($('historySyncNotice')){
      $('historySyncNotice').hidden=!historyError&&$('coachPanel').hidden;
      $('historySyncDiagnostic').hidden=!historyFailure;
      $('historySyncDiagnostic').textContent=historyFailure?'Diagnóstico: '+historyFailure:'';
      if(!historyError&&state.coaching)$('historySyncNotice').hidden=true;
      $('historySyncMessage').textContent=historyError==='history_offline'?'Sin conexión. Se muestran los datos locales.':historyError==='history_auth_timeout'?'No se pudo terminar de comprobar tu sesión. Reintenta la consulta.':historyError==='captcha_required'?'Confirma la comprobación para consultar la nube. Tus datos locales siguen disponibles.':historyError==='rate_limited'?'La consulta a la nube alcanzó el límite temporal de consultas. Se muestran datos locales; espera un minuto y reintenta.':'No se pudo completar la consulta de la nube. Se muestran los datos locales.';
    }
    }catch(error){
      if(signal.aborted||sequence!==state.renderSequence)return;
      historyError=error.code||'history_unavailable';historyFailure=safeHistoryDiagnostic(error);
      $('historySyncNotice').hidden=false;$('historySyncMessage').textContent='No se pudo completar la consulta de la nube. Puedes reintentar.';
      $('historySyncDiagnostic').hidden=false;$('historySyncDiagnostic').textContent='Diagnóstico: '+historyFailure;
    }finally{
      if(sequence===state.renderSequence){state.loading=false;$('historyLoading').hidden=true;$('trainingHistory').setAttribute('aria-busy','false');}
    }
  }

  $('periodSelect').addEventListener('change', render);
  $('athleteSearch').addEventListener('focus', event => renderUserResults(event.target.value));
  $('athleteSearch').addEventListener('input', event => renderUserResults(event.target.value));
  document.addEventListener('click', event => { if (!$('historyPopover').contains(event.target)) closePopover(); if (!$('athletePicker').contains(event.target)) closeUserResults(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closePopover(); closeUserResults(); } });
  window.addEventListener('resize', closePopover);
  ['buddy:auth-state-changed', 'buddy:auth-ready', 'buddy:user-loaded', 'buddy:user-updated'].forEach(eventName => window.addEventListener(eventName, () => {
    const signedUser = currentUser(),identityChanged=state.ownUserId!==signedUser.id;
    if(state.loading&&!identityChanged)return;
    if(identityChanged){state.ownUserId=signedUser.id;state.selectedUser=signedUser;state.directoryLoaded=false;state.users=[];state.verifiedRole=null;clearCoaching();}
    if (!state.selectedUser || (state.selectedUser.anonymous && rawCurrentUser()) || (!rawCurrentUser() && !state.selectedUser.anonymous)) state.selectedUser = signedUser;
    initializeDirectory(); render();
  }));
  window.addEventListener('buddy:admin-visibility-changed',async()=>{if(state.loading)return;await initializeDirectory();render();});
  window.addEventListener('arbat:sync-state',()=>{if(!window.ArbatTrainingSync?.historyEnabled)render();});
  $('historySyncRetry')?.addEventListener('click',async()=>{try{if(historyError==='captcha_required')await window.ArbatTrainingSync.authorizeHistory();await render();}catch{$('historySyncMessage').textContent='No se pudo completar la comprobación. Tus datos locales se conservan.';}});
  window.addEventListener('buddy:ready', initializeDirectory, { once: true });

  state.selectedUser = currentUser();state.ownUserId=state.selectedUser.id;render();
  if (window.Buddy && window.Buddy.readyPromise) window.Buddy.readyPromise.then(initializeDirectory).catch(() => {}); else initializeDirectory();
  window.ArbatTrainingHistory = { render, allSessions: localSessions, closePopover };
})();


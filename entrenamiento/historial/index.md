---
layout: default
title: "Mi historial de entrenamiento"
description: "Resumen de sesiones, volumen de flechas y evolución del puntaje de tiro con arco."
breadcrumb_hidden: true
estilos:
  - "/entrenamiento/css/recognitions.css?v=1"
  - "/entrenamiento/historial/css/historial.css?v=19"
  - "/entrenamiento/css/sync.css?v=4"
scripts:
  - "/entrenamiento/js/sync-diagnostics.js?v=4"
  - "/entrenamiento/js/constelacion.js?v=2.1"
  - "/entrenamiento/js/sync-config.js?v=3"
  - "/entrenamiento/js/sync-storage.js?v=1"
  - "/entrenamiento/js/sync-store.js?v=5"
  - "/entrenamiento/js/sync-engine.js?v=6"
  - "/entrenamiento/js/sync-identity.js?v=5"
  - "/entrenamiento/js/sync-history.js?v=9"
  - "/entrenamiento/js/sync-captcha.js?v=3"
  - "/entrenamiento/js/sync-usage.js?v=3"
  - "/entrenamiento/js/sync-bootstrap.js?v=9"
  - "/entrenamiento/js/recognitions.js?v=1"
  - "/entrenamiento/js/recognitions-ui.js?v=2"
  - "/entrenamiento/historial/js/history-activity.js?v=1"
  - "/entrenamiento/historial/js/history-arrow-details.js?v=1"
  - "/entrenamiento/historial/js/history-details.js?v=9"
  - "/entrenamiento/historial/js/history-roster.js?v=1"
  - "/entrenamiento/historial/js/capacity-notice.js?v=1"
  - "/entrenamiento/historial/js/system-status.js?v=5"
  - "/entrenamiento/historial/js/history-period-cache.js?v=1"
  - "/entrenamiento/historial/js/historial.js?v=25"
---

<div class="training-history" id="trainingHistory">
  <header class="history-header">
    <div>
      <p class="eyebrow">Entrenamiento</p>
      <h1>Mi historial</h1>
      <p class="history-intro">Revisa tu volumen y la evolución de tus puntajes.</p>
    </div>
    <div class="athlete" id="athleteIdentity" aria-live="polite">
      <span class="athlete-avatar" id="athleteAvatar" aria-hidden="true">—</span>
      <span><small id="athleteRole">Arquero</small><strong id="athleteName">Cargando…</strong></span>
    </div>
  </header>

  <details class="history-login history-expand" id="historyLogin" open hidden>
    <summary>Reúne tu historial en todos tus dispositivos</summary>
    <p>Sin cuenta ves el resumen de los últimos 7 días. Inicia sesión para reunir tus entrenamientos y ampliar el período del resumen. Desde una computadora también puedes consultar andanadas, flechas y notas, y comparar períodos.</p>
    <button type="button" class="history-button history-button--primary" id="historyLoginButton">Iniciar sesión</button>
    <p id="historyLoginMessage" role="status"></p>
  </details>
  <details class="history-privacy history-expand"><summary>Privacidad del historial</summary><p>Registramos aperturas de Historial y la ciudad aproximada al abrirlo y al terminar una andanada, también sin cuenta. No solicitamos GPS ni guardamos tu IP completa. Solo administradores autorizados consultan estos datos de uso.</p></details>

  <section class="athlete-picker" id="athletePicker" aria-labelledby="athletePickerTitle" hidden>
    <div><h2 id="athletePickerTitle">Usuario consultado</h2><p>Disponible para entrenadores y administradores.</p><p class="athlete-search-status" id="athleteSearchStatus" aria-live="polite"></p></div>
    <div class="athlete-search">
      <input aria-label="Usuario consultado" id="athleteSearch" type="search" role="combobox" autocomplete="off" aria-autocomplete="list" aria-controls="athleteResults" aria-expanded="false" placeholder="Escribe para buscar…">
      <div class="athlete-results" id="athleteResults" role="listbox" hidden></div>
    </div>
  </section>

  <section class="period-bar" aria-labelledby="periodTitle">
    <div><h2 id="periodTitle">Período</h2><p id="periodDates">—</p></div>
    <label for="periodSelect">Mostrar
      <select id="periodSelect">
        <option value="1">Hoy día</option>
        <option value="7">Semana</option><option value="30" selected>Mes</option><option value="90">3 meses</option><option value="180">6 meses</option><option value="365">1 año</option>
      </select>
    </label>
  </section>
  <details class="history-card history-expand coach-panel" id="coachPanel" hidden>
    <summary id="coachTitle">Panel de entrenadores</summary>
    <p id="coachScope"></p>
    <p id="coachMessage" role="status"></p>
    <div id="coachData" hidden>
      <article class="coach-total"><span>Flechas registradas por los arqueros en el período</span><strong id="coachArrows">—</strong><small>Según la fecha de cada flecha de los arqueros supervisados.</small></article>
      <h3>Arqueros supervisados</h3>
      <p>Las últimas sesiones y sus totales diarios se muestran aunque estén fuera del período seleccionado.</p>
      <div class="coach-table-scroll"><table class="coach-table"><thead><tr><th scope="col" aria-sort="none"><button type="button" data-coach-sort="name" data-label="Arquero">Arquero ↕</button></th><th scope="col" aria-sort="descending"><button type="button" data-coach-sort="date" data-label="Inicio de la última sesión">Inicio de la última sesión ↓</button></th><th scope="col" aria-sort="none"><button type="button" data-coach-sort="arrows" data-label="Flechas de ese día">Flechas de ese día ↕</button></th><th scope="col" aria-sort="none"><button type="button" data-coach-sort="average" data-label="Promedio del día">Promedio del día ↕</button></th></tr></thead><tbody id="coachRoster"></tbody></table></div>
    </div>
  </details>

  <p class="data-scope" id="dataScope">Datos guardados en este dispositivo.</p>

  <div id="historySyncNotice" role="status" hidden><p id="historySyncMessage"></p><p id="historySyncDiagnostic" hidden></p><button id="historySyncRetry" type="button" class="history-button">Reintentar consulta de la nube</button></div>


  <details class="history-expand history-summary" id="historySummary" open><summary>Resumen del período</summary>
  <section class="kpi-grid" aria-label="Resumen del período">
    <article class="kpi"><span>Sesiones</span><strong id="kpiSessions">0</strong></article>
    <article class="kpi"><span>Flechas</span><strong id="kpiArrows">0</strong></article>
    <article class="kpi"><span>Promedio</span><strong id="kpiAverage">—</strong><small>puntos por flecha</small></article>
    <article class="kpi"><span>Días activos</span><strong id="kpiDays">0</strong></article>
  </section>
  </details>

  <details class="history-card history-expand activity-card" open>
    <summary id="activityTitle">Calendario de actividad</summary><p>Cada fila representa una semana, de lunes a domingo. Competencia en blanco y entrenamiento del arquero seleccionado en naranja. Los puntos indican actividades adicionales del mismo día.</p>
    <ul class="activity-kind-legend" aria-label="Tipos de actividad"><li><i class="activity-kind competition"></i>Competencia</li><li><i class="activity-kind training"></i><span id="trainingActivityLegend">Entrenamiento del arquero</span></li></ul>
    <div class="activity-scroll"><div id="activityCalendar" class="activity-calendar" role="grid" aria-label="Calendario de días con entrenamiento"></div></div>
  </details>

  <details id="historyCharts" class="history-expand"><summary>Gráficas de evolución</summary>
  <div class="chart-grid">
    <details class="history-card history-expand" open><summary id="volumeTitle">Volumen de flechas</summary><p>Cantidad registrada cada día. Zoom y desplazamiento sincronizados con Promedio diario.</p><div id="volumeChart" class="chart" role="img" aria-label="Gráfica de flechas por día. Su zoom y desplazamiento están sincronizados con la gráfica de promedio."></div></details>
    <details class="history-card history-expand" open><summary id="averageTitle">Promedio diario</summary><p>Puntaje promedio por flecha. Zoom y desplazamiento sincronizados con Volumen de flechas.</p><div id="averageChart" class="chart" role="img" aria-label="Gráfica de promedio diario. Su zoom y desplazamiento están sincronizados con la gráfica de volumen."></div></details>
  </div>

  </details>

  <details class="history-card history-expand history-sessions" open><summary id="sessionsTitle">Sesiones del período</summary><p>Las más recientes aparecen primero.</p><div id="sessionList" class="session-list"></div></details>
  <details class="history-card history-expand history-mobile-invite" id="historyDesktopInvite" open><summary>Más detalle en una computadora</summary><p>Para consultar el detalle completo de tus sesiones, andanadas y flechas, abre arbatarchery.com en una computadora e inicia sesión con tu cuenta.</p></details>
  <section id="historyLoading" class="history-loading" role="status" aria-live="polite" hidden>
    <strong>Cargando datos de la nube</strong>
    <p id="historyLoadingStage">Preparando tu sesión…</p>
    <progress aria-label="Cargando datos de la nube"></progress>
    <p id="historyLoadingCounts">Sesiones: 0 · Andanadas: 0 · Flechas: 0 · Arqueros: 0</p>
  </section>
  <details class="history-card history-expand" id="historyDetails" hidden><summary>Detalle completo de sesiones, andanadas y flechas</summary>
    <p>Los filtros siguientes afectan solo a esta tabla y su distribución de puntajes.</p>
    <div class="history-detail-filters"><label>Tipo <select id="detailType"><option value="">Todos</option><option value="training">Entrenamiento</option><option value="competition">Competencia</option></select></label><label>Distancia <select id="detailDistance"><option value="">Todas</option></select></label><label>Diana <select id="detailTarget"><option value="">Todas</option></select></label></div>
    <p id="detailDistribution"></p><div id="historySessionTable" class="coach-table-scroll"></div>
  </details>

  <details class="history-card history-expand" id="usagePanel" open hidden><summary>Uso y ciudades · Administración</summary><p>Fechas según Bolivia (America/La_Paz). Las aperturas son visitas, no personas únicas ni una medida de motivación. Ciudad aproximada por red; VPN o redes móviles pueden variar.</p><p id="usageMessage" role="status"></p><div id="usageData"></div></details>

  <section class="history-card capacity-notice" id="capacityNotice" role="status" aria-live="polite" hidden><strong><span class="system-indicator system-error">Cerca del límite</span></strong><p>La base de datos está por llenarse. Por favor, comunícalo al encargado.</p></section>
  <details class="history-card history-expand system-status" id="systemStatus" hidden>
    <summary>Estado del sistema <span id="systemStatusIndicator"><span class="system-indicator system-unknown">Sin comprobar</span></span></summary>
    <p>Rojo: error · Amarillo: advertencia · Verde: correcto. Cada encabezado refleja el estado más grave de sus componentes. Solo se muestran indicadores con datos confirmados; los datos no disponibles se omiten.</p>
    <p id="systemStatusChecked" role="status"></p>
    <div class="system-status-actions"><button type="button" class="history-button" id="systemStatusCheck">Comprobar ahora</button><button type="button" class="history-button" id="systemStatusCopy">Copiar diagnóstico</button><a class="history-button" href="https://supabase.com/dashboard/project/qbtdwlcpqcsolubhhkfa" target="_blank" rel="noopener noreferrer">Abrir Supabase</a></div>
    <p id="systemStatusMessage" role="status"></p>
    <div id="systemStatusAreas"></div>
  </details>
  <div class="history-actions"><a class="history-button history-button--primary" href="/entrenamiento/">Registrar entrenamiento</a><a class="history-button" href="/">Volver al inicio</a></div>
  <div class="history-popover" id="historyPopover" role="dialog" aria-live="polite" hidden></div>
</div>



{% include training-captcha.html %}

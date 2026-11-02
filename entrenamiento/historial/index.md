---
layout: default
title: "Mi historial de entrenamiento"
description: "Resumen de sesiones, volumen de flechas y evolución del puntaje de tiro con arco."
breadcrumb_hidden: true
estilos:
  - "/entrenamiento/historial/css/historial.css?v=6"
  - "/entrenamiento/css/sync.css?v=4"
scripts:
  - "/entrenamiento/js/constelacion.js?v=1.9"
  - "/entrenamiento/js/sync-config.js?v=3"
  - "/entrenamiento/js/sync-storage.js?v=1"
  - "/entrenamiento/js/sync-store.js?v=5"
  - "/entrenamiento/js/sync-engine.js?v=6"
  - "/entrenamiento/js/sync-identity.js?v=4"
  - "/entrenamiento/js/sync-history.js?v=2"
  - "/entrenamiento/js/sync-captcha.js?v=3"
  - "/entrenamiento/js/sync-bootstrap.js?v=7"
  - "/entrenamiento/historial/js/history-activity.js?v=1"
  - "/entrenamiento/historial/js/historial.js?v=14"
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
      <span><small>Arquero</small><strong id="athleteName">Cargando…</strong></span>
    </div>
  </header>

  <section class="athlete-picker" id="athletePicker" aria-labelledby="athletePickerTitle" hidden>
    <div><h2 id="athletePickerTitle">Usuario consultado</h2><p>Disponible para entrenadores y administradores.</p></div>
    <div class="athlete-search">
      <label for="athleteSearch">Buscar por nombre o identificador</label>
      <input id="athleteSearch" type="search" role="combobox" autocomplete="off" aria-autocomplete="list" aria-controls="athleteResults" aria-expanded="false" placeholder="Escribe para buscar…">
      <div class="athlete-results" id="athleteResults" role="listbox" hidden></div>
      <p class="athlete-search-status" id="athleteSearchStatus" aria-live="polite"></p>
    </div>
  </section>

  <section class="period-bar" aria-labelledby="periodTitle">
    <div><h2 id="periodTitle">Período</h2><p id="periodDates">—</p></div>
    <label for="periodSelect">Mostrar
      <select id="periodSelect">
        <option value="7">Semana</option><option value="30" selected>Mes</option><option value="90">3 meses</option><option value="180">6 meses</option><option value="365">1 año</option>
      </select>
    </label>
  </section>

  <p class="data-scope" id="dataScope">Datos guardados en este dispositivo.</p>
  <div id="historySyncNotice" role="status" hidden><p id="historySyncMessage"></p><button id="historySyncRetry" type="button" class="history-button">Reintentar consulta de la nube</button></div>
  <section class="history-card coach-panel" id="coachPanel" aria-labelledby="coachTitle" hidden>
    <div class="card-heading"><div><h2 id="coachTitle">Panel de entrenadores</h2><p id="coachScope"></p></div></div>
    <p id="coachMessage" role="status"></p>
    <div id="coachData" hidden>
      <article class="coach-total"><span>Flechas registradas por los arqueros en el período</span><strong id="coachArrows">—</strong><small>Según la fecha de cada flecha. Tu entrenamiento aparece en el resumen personal.</small></article>
      <h3>Arqueros supervisados</h3>
      <p>Las últimas sesiones y sus totales diarios se muestran aunque estén fuera del período seleccionado.</p>
      <div class="coach-table-scroll"><table class="coach-table"><thead><tr><th scope="col">Arquero</th><th scope="col">Inicio de la última sesión</th><th scope="col">Flechas de ese día</th><th scope="col">Promedio del día</th></tr></thead><tbody id="coachRoster"></tbody></table></div>
    </div>
  </section>

  <section class="kpi-grid" aria-label="Resumen del período">
    <article class="kpi"><span>Sesiones</span><strong id="kpiSessions">0</strong></article>
    <article class="kpi"><span>Flechas</span><strong id="kpiArrows">0</strong></article>
    <article class="kpi"><span>Promedio</span><strong id="kpiAverage">—</strong><small>puntos por flecha</small></article>
    <article class="kpi"><span>Días activos</span><strong id="kpiDays">0</strong></article>
  </section>

  <section class="history-card activity-card" aria-labelledby="activityTitle">
    <div class="card-heading"><div><h2 id="activityTitle">Calendario de actividad</h2><p>Cada fila representa una semana, de lunes a domingo. Competencia en blanco, entrenamiento propio en naranja y actividad de alumnos en gris. Los puntos indican actividades adicionales del mismo día.</p></div></div>
    <ul class="activity-kind-legend" aria-label="Tipos de actividad"><li><i class="activity-kind competition"></i>Competencia</li><li><i class="activity-kind training"></i>Entrenamiento propio</li><li id="studentActivityLegend" hidden><i class="activity-kind students"></i>Actividad de alumnos</li></ul>
    <div class="activity-scroll"><div id="activityCalendar" class="activity-calendar" role="grid" aria-label="Calendario de días con entrenamiento"></div></div>
  </section>

  <div class="chart-grid">
    <section class="history-card" aria-labelledby="volumeTitle"><div class="card-heading"><div><h2 id="volumeTitle">Volumen de flechas</h2><p>Cantidad registrada cada día. Zoom y desplazamiento sincronizados con Promedio diario.</p></div></div><div id="volumeChart" class="chart" role="img" aria-label="Gráfica de flechas por día. Su zoom y desplazamiento están sincronizados con la gráfica de promedio."></div></section>
    <section class="history-card" aria-labelledby="averageTitle"><div class="card-heading"><div><h2 id="averageTitle">Promedio diario</h2><p>Puntaje promedio por flecha. Zoom y desplazamiento sincronizados con Volumen de flechas.</p></div></div><div id="averageChart" class="chart" role="img" aria-label="Gráfica de promedio diario. Su zoom y desplazamiento están sincronizados con la gráfica de volumen."></div></section>
  </div>

  <section class="history-card" aria-labelledby="sessionsTitle"><div class="card-heading"><div><h2 id="sessionsTitle">Sesiones del período</h2><p>Las más recientes aparecen primero.</p></div></div><div id="sessionList" class="session-list"></div></section>
  <div class="history-actions"><a class="history-button history-button--primary" href="/entrenamiento/">Registrar entrenamiento</a><a class="history-button" href="/">Volver al inicio</a></div>
  <div class="history-popover" id="historyPopover" role="dialog" aria-live="polite" hidden></div>
</div>



{% include training-captcha.html %}

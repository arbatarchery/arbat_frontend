---
title: "Escuela de tiro con arco en Santa Cruz de la Sierra"
description: "Escuela de tiro con arco en Santa Cruz de la Sierra. Entrenamiento olímpico, recreativo, deportivo y competitivo con equipo incluido y agenda previa."
breadcrumb_hidden: true
hero: true
hero_eyebrow: "arbat, escuela de tiro con arco"
hero_lema: "Sentio ergo attingo."
hero_sub: "Aprendé tiro con arco en arbat, sea cual sea tu punto de partida. Te prestamos el equipo (arco, flechas y protecciones) y arrancás en tu primera clase."
hero_cta_texto: "Probar una clase (Bs. 70)"
hero_cta_mensaje: "Hola arbat, quiero probar una primera clase de tiro con arco."
hero_cta_secundario_texto: "Ver las clases"
hero_cta_secundario_url: "#clases"
---

<div class="ring-divider" aria-hidden="true"></div>

<section class="tile" aria-labelledby="mi-primera-flecha">
  <div class="wrap">
    <h2 id="mi-primera-flecha">Mi primera flecha</h2>
    <iframe
      src="https://www.youtube-nocookie.com/embed/T1Y86fV1sPU?autoplay=0"
      title="Mi primera flecha — Entrevistas a entrenadores y arqueros destacados de Bolivia"
      width="1120"
      height="630"
      loading="lazy"
      allow="encrypted-media; picture-in-picture; fullscreen"
      referrerpolicy="strict-origin-when-cross-origin"
      allowfullscreen
      style="display:block;width:100%;height:auto;aspect-ratio:16/9;border:0;">
    </iframe>
    <p>Entrevistas a entrenadores y arqueros destacados de Bolivia</p>
  </div>
</section>

<div class="tile">
  <div class="wrap">
    <p class="section-label">Por qué arbat</p>
    <ul class="list-diana">
      <li><strong>Progresión real de distancia:</strong> 4 campos de tiro, de 5 a 25 metros, para avanzar paso a paso en el mismo lugar.</li>
      <li><strong>Equipo incluido:</strong> arcos clásicos, barebow y recurvos, listos para diestros y zurdos.</li>
      <li><strong>Agenda previa siempre:</strong> cada sesión tiene el espacio y el instructor que necesita, sin apuro de otros grupos.</li>
      <li><strong>Para todos los niveles:</strong> entrenamiento olímpico, recreativo, deportivo y preparación competitiva.</li>
    </ul>
  </div>
</div>

<div class="tile" id="clases">
  <div class="wrap">
    <p class="section-label">Clases</p>
    <div class="grid">
      {% for clase in site.clases %}
      <article class="card">
        {% if clase.url contains "ninos" %}
        <div class="card__media card__media--video">
          <video src="{{ '/assets/images/ninos/nino01.mp4' | relative_url }}" autoplay muted loop playsinline aria-hidden="true" style="width:100%;height:100%;object-fit:cover;object-position:center center;"></video>
        </div>
        {% elsif clase.url contains "entrenamiento-deportivo" %}
        <div class="card__media">
          <img src="{{ '/assets/images/grupales/competencia01.jpg' | relative_url }}" alt="Entrenamiento deportivo de tiro con arco en arbat" loading="lazy" style="width:100%;height:100%;object-fit:cover;object-position:center center;">
        </div>
        {% elsif clase.url contains "principiantes" %}
        <div class="card__media">
          <img src="{{ '/assets/images/grupales/grupo01.png' | relative_url }}" alt="Grupo de principiantes practicando tiro con arco en arbat" loading="lazy" style="width:100%;height:100%;object-fit:cover;object-position:center center;">
        </div>
        {% elsif clase.url contains "individuales" %}
        <div class="card__media">
          <img src="{{ '/assets/images/grupales/dos_arqueros_2.jpg' | relative_url }}" alt="CLases individuales" loading="lazy" style="width:100%;height:100%;object-fit:cover;object-position:center center;">
        </div>
        {% else %}
        <div class="card__media" aria-hidden="true"></div>
        {% endif %}
        <div class="card__body">
          <h3 class="card__title"><a href="{{ clase.url | relative_url }}">{{ clase.title }}</a></h3>
          <p class="card__text">{{ clase.description }}</p>
          <a class="btn-secondary" href="{{ clase.url | relative_url }}">Ver la clase</a>
        </div>
      </article>
      {% endfor %}
    </div>
  </div>
</div>

<div class="tile">
  <div class="wrap">
    <p class="section-label">Instructores</p>
    <div class="grid grid--3">
      {% for instructor in site.instructores %}
      <article class="card">
        {% if instructor.foto %}
        <div class="card__media">
          <img src="{{ instructor.foto | relative_url }}" alt="Foto de {{ instructor.nombre }}" loading="lazy">
        </div>
        {% else %}
        <div class="card__media card__media--placeholder" aria-hidden="true">{{ instructor.nombre | slice: 0, 1 }}</div>
        {% endif %}
        <div class="card__body">
          <h3 class="card__title"><a href="{{ instructor.url | relative_url }}">{{ instructor.nombre }}</a></h3>
          {% if instructor.instagram %}<p class="card__text">Instagram: @{{ instructor.instagram }}</p>{% endif %}
          <a class="btn-secondary" href="{{ instructor.url | relative_url }}">Ver perfil</a>
        </div>
      </article>
      {% endfor %}
    </div>
  </div>
</div>

<div class="tile">
  <div class="wrap">
    <p class="section-label">Horarios</p>
    <ul class="list-diana">
      {% for bloque in site.arbat.horarios %}
      <li><strong>{{ bloque.dias }}:</strong> {{ bloque.turnos | join: ' y ' }}{% if bloque.duracion %} ({{ bloque.duracion }}){% endif %}</li>
      {% endfor %}
    </ul>
    <p>Trabajamos con <strong>agenda previa</strong> siempre. Mirá los <a href="{{ '/horarios/' | relative_url }}">horarios</a> y elegí el tuyo.</p>
  </div>
</div>

<div class="tile">
  <div class="wrap">
    <p class="section-label">Precios</p>
    <ul class="list-diana">
      <li>Primera clase / clase suelta: <strong>Bs. 70</strong></li>
      <li>Mensualidad 3x/semana: <strong>Bs. 500</strong></li>
      <li>Mensualidad 2x/semana: <strong>Bs. 350</strong></li>
      <li>Mensualidad 1x/semana: <strong>Bs. 180</strong></li>
      <li>Solo sábados: <strong>Bs. 200</strong></li>
    </ul>
    <p>Mirá cuánto cuesta cada modalidad en <a href="{{ '/precios/' | relative_url }}">precios</a>.</p>
  </div>
</div>

<div class="tile">
  <div class="wrap">
    <p class="section-label">Preguntas frecuentes</p>
    <ul class="list-diana">
      <li><strong>¿Necesito arco propio?</strong> No, te prestamos el equipo.</li>
      <li><strong>¿Soy zurdo, hay problema?</strong> No, tenemos equipo para diestros y zurdos.</li>
      <li><strong>¿Tengo que agendar?</strong> Sí, siempre con agenda previa.</li>
    </ul>
    <p>Ver todas las <a href="{{ '/preguntas-frecuentes/' | relative_url }}">preguntas frecuentes</a>.</p>
  </div>
</div>

<div class="tile">
  <div class="wrap">
    <p class="section-label">Ubicación</p>
    <p>{{ site.arbat.direccion }}. Ver <a href="{{ '/ubicacion/' | relative_url }}">ubicación</a>.</p>
  </div>
</div>

<div class="tile tile--cta">
  <div class="wrap">
    <p class="section-label">Reservá tu clase</p>
    <p>Coordinamos el día y el horario por WhatsApp, con el equipo listo para vos.</p>
    <div class="ctas">
      {% include whatsapp-cta.html texto="Reservar por WhatsApp" mensaje="Hola arbat, quiero reservar mi primera clase de tiro con arco." %}
      <a class="btn-secondary" href="{{ '/reservar/' | relative_url }}">Llenar el formulario de reserva</a>
    </div>
  </div>
</div>

{% include schema/local-business.html %}

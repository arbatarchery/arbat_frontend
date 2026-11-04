# Historial del arquero: inventario y próxima distribución

## Estado

Este inventario describe la vista anterior a la actualización. La rama actual implementa la distribución ampliada y la medición de aperturas; su activación requiere la configuración descrita en `docs/supabase-history-usage-install.md`. El rol normal de arquero permite únicamente consultar su historial; el buscador de usuarios y panel de entrenadores están reservados a sus roles correspondientes.

Sin cuenta se puede consultar el registro anónimo disponible en ese navegador y su respaldo cuando existe una identidad anónima válida. Con Buddy se consulta el respaldo asociado a la cuenta y se combina con los cambios locales pendientes. Todavía no hay un bloqueo de los detalles gráficos basado en iniciar sesión.

## Datos visibles actualmente

- Identificación: nombre e iniciales del arquero, rol confirmado y procedencia de los datos (locales/nube). Estado de carga con contadores y aviso de reintento ante un error real.
- Selector de período: 7, 30, 90, 180 o 365 días, con fechas de inicio y fin.
- Resumen del período: sesiones, flechas, promedio por flecha y días activos. Los fallos M cuentan como cero en el promedio.
- Calendario: días con actividad propia, entrenamiento en naranja y competencia en blanco; puntos cuando coinciden categorías.
- Al abrir un día: fecha, primera hora de inicio, última hora final disponible, puntaje total, número de flechas, promedio y constelaciones separadas de sus sesiones.
- Gráficas de flechas y promedio por día, con zoom y desplazamiento sincronizados. Al tocar barras/puntos se muestran fecha y valor, y cantidad de sesiones si hubo más de una ese día.
- Lista de hasta 12 sesiones recientes del período: fecha, flechas, andanadas, promedio y señal de sesión en curso cuando se identifica como actual.
- Constelación por sesión: impactos y agrupación cuando hay coordenadas; fecha, entrenamiento/competencia, distancia y tamaño de diana si se registraron; rondas, flechas por ronda, total de flechas, promedio y puntos totales. Se muestra dentro del detalle del día.
- Acciones: registrar entrenamiento, volver al inicio y reintentar la nube ante errores.

El listado de sesiones no es actualmente una tabla completa por andanada/flecha. No presenta por separado notas, distribución de puntajes o comparaciones de períodos. No hay botón de CSV en Historial; la exportación del registro de entrenamiento es otro flujo y se conservará.

## Dirección de diseño solicitada

- Mostrar más datos y detalles en escritorio.
- Ofrecer una vista móvil resumida y fácil de ampliar.
- Invitar a iniciar sesión tanto en móvil como en escritorio, explicando el beneficio de reunir el historial entre dispositivos y consultar más detalles.
- Mantener el entrenamiento anónimo y su guardado; reducir una vista anónima no elimina los datos previos ni cambia la copia CSV/JSON.
- Diseñar diferencias por estado de cuenta además del tamaño de pantalla. La vista móvil con cuenta puede ofrecer detalles mediante secciones desplegables, sin confundir móvil con usuario anónimo.

La actualización preparada incluye: tabla completa de sesiones en escritorio, desglose por andanada y flecha, notas, filtros por distancia/tamaño de diana/tipo y comparación entre períodos. En anónimo, un resumen reciente y una invitación contextual a iniciar sesión; el resumen anónimo se limita a siete días y tres sesiones recientes, sin borrar registros.

## Ciudad del visitante y medición de aperturas

Proveedor público recibido: https://arbat-city.arbat-archery.workers.dev/ . Verificado: HTTP 200, esquema 1 y fuente cloudflare-ip, sin IP completa ni coordenadas en la respuesta. El registro firmado, el panel administrativo y el aviso de variación entre ciudades están implementados en esta rama. Requieren aplicar la migración 007, configurar el mismo secreto privado en Worker y Edge Function y desplegar ambos antes de publicar el sitio. Ver `docs/supabase-history-usage-install.md`.

Se mantienen dos eventos independientes:

1. `end_location`: una observación al terminar cada andanada, desde la primera y sin esperar a cerrar la sesión.
2. `history_open`: una apertura real de Historial, aunque no exista entrenamiento ese día, tanto para cuentas como para visitantes anónimos.

Cada apertura tiene UUID propio e idempotente para sus reintentos. Los eventos de restauración de sesión, nuevos intentos de red, cambios de período o selección de otro arquero dentro de la misma página no crean aperturas adicionales. Al iniciar sesión durante una apertura no se duplica el evento; el servidor valida la asociación de identidad. Los cambios entre cuentas no deben reasignar visitas privadas de una cuenta a otra.

Conservar fecha/hora de apertura, recepción del servidor y observación de ciudad. Si se abrió sin conexión, la detección posterior se identifica como observada al sincronizar; no se inventa una ciudad para la apertura original. La ciudad se consulta en segundo plano y no retrasa el historial.

La identificación de cuenta se deriva de la sesión verificada. Un navegador anónimo usa un identificador aleatorio, sin huella digital ni MAC. La recepción anónima de uso debe ser separada, acotada e idempotente: no se abren escrituras públicas a entrenamientos ni se dispara un CAPTCHA únicamente para contar una visita.

Administración mostrará aperturas por período, días distintos de consulta, última apertura, ciudades/países distintos y su distribución. Para cuentas autenticadas se podrá reunir la actividad de diferentes navegadores de la misma cuenta. En anónimos se cuentan navegadores/visitas, no personas únicas confirmadas. La frecuencia de consulta es una señal de uso, no una prueba de motivación personal.

Ubicaciones, aperturas individuales y cambios geográficos serán accesibles solo a Administrador en su academia y SuperAdmin globalmente. El aviso de datos de uso debe explicar esta recogida aproximada. No afecta a los permisos de entrenadores sin rol administrativo ni se muestra en el historial de otros arqueros.

# Reconocimientos inteligentes v1.2

El motor puro `entrenamiento/js/recognitions.js` consume las mismas sesiones locales y recuperadas desde Supabase. La interfaz escucha los eventos existentes de cierre de sesión y carga de historial. No modifica sesiones, CSV, JSON Statetty ni el protocolo de sincronización.

## Comparaciones

- Misma persona, distancia, diámetro, modalidad y configuración de diana. Sin distancia o diámetro válidos no hay reconocimiento técnico.
- Agrupación: RMS respecto al centroide de **cada andanada**, convertido desde el diámetro SVG de 92 unidades a milímetros con el diámetro de la diana. Nunca se calcula dispersión espacial global.
- Se comparan las últimas seis andanadas completas con las seis anteriores, sin superposición y con idéntico número de impactos. Las andanadas incompletas o con alguna coordenada ausente se excluyen del análisis espacial. Un M con coordenadas válidas puede participar; un M sin coordenadas excluye esa andanada, evitando premiar grupos artificialmente pequeños.
- Compactación: descenso mínimo del 10% en la media de RMS. Consistencia: descenso mínimo del 10% en la desviación estándar de los seis RMS, sin empeorar su media más del 2%. Una referencia de dispersión cero no genera porcentajes infinitos.
- Precisión: dos muestras consecutivas de 36 flechas, incremento mínimo del 3%. Los M cuentan como cero. Tendencia: tres muestras consecutivas de 36 flechas con medias estrictamente crecientes.
- Récord: media de una sesión con al menos 36 flechas bajo la misma configuración, estrictamente superior a todas las sesiones anteriores elegibles. La primera referencia y los empates no son récords.
- Orden ordinario: compactación, consistencia de agrupaciones, precisión, tendencia, regularidad (cuatro semanas), volumen (+15% entre ventanas de 28 días), regreso (14 días), hitos (100, 500, 1.000, 5.000 y 10.000), primera referencia (36 flechas). Sin evidencia, no se fuerza una felicitación.

## Presentación y almacenamiento

Al terminar manualmente se anuncia como máximo un reconocimiento ordinario y, por separado, los récords obtenidos. Abrir Historial o recibir datos sincronizados nunca abre anuncios de sesiones antiguas. Historial presenta los resultados dentro del período autorizado y seleccionado; ampliar el período puede aportar evidencia adicional y cambiar el resultado. Las cargas y cambios de cuenta retiran las tarjetas anteriores.

Los resultados derivados, su firma de datos y los identificadores de anuncios se almacenan por usuario en claves independientes de los datos de entrenamiento. La firma invalida el resultado si cambian los datos, y los resultados guardados se limitan a cien sesiones por usuario. No se escriben campos adicionales en los objetos de sesión. Los indicadores de presentación se guardan en este navegador: no hay garantía de exclusión de anuncios entre distintos dispositivos ni después de borrar sus datos.

Entrenamiento intenta cargar el historial remoto completo, combina los cambios locales pendientes usando la función existente de Supabase y utiliza las claves canónicas de sincronización para evitar duplicar sesiones locales y remotas. Sin conexión usa el historial local y las copias de IndexedDB. La interfaz indica que las sesiones aún no sincronizadas pueden modificar los resultados; no se presentan como una certificación de integridad del historial.

## Resumen mensual

Primera apertura de Entrenamiento durante los últimos siete días calendario del mes (por ejemplo, 24–30 de noviembre). Cuenta los últimos treinta días calendario, incluyendo el actual, usando la fecha de cada flecha o la de la sesión cuando no está disponible. Incluye M, sesiones en curso y sesiones antiguas sin identificador; descarta duplicados y fechas futuras. No muestra automáticamente un total cero ni recupera meses que no se abrieron.

El mes se marca antes de mostrar la tarjeta y se conserva el total de esa presentación. Si no se puede guardar la marca, no se abre automáticamente para evitar repeticiones. Se puede consultar de nuevo desde el propio Historial. Los resúmenes están separados del límite ordinario de sesión.

El usuario elige Historia 9:16 (1080×1920) o Publicación 4:5 (1080×1350). Se ofrece compartir mediante el sistema cuando está disponible, o descargar PNG. Cancelar el diálogo de compartir no dispara una descarga. Ambas tarjetas incluyen período, total, nombre arbat archery y arbatarchery.com, sin puntajes ni datos personales.

## Verificación

- `node --test tests/*.test.cjs`: reglas estadísticas, límites, traslación de centroides, equivalencia, coordenadas ausentes, identidades, duplicados, calendario y conservación de datos.
- `npm test --prefix supabase`: regresiones de almacenamiento, sincronización, autorización y compatibilidad exacta del CSV y JSON Statetty.
- `node supabase/scripts/check-recognitions.mjs`: navegador real con datos ficticios, sin conexiones externas; cierre de sesión, anuncios, persistencia mensual, descarga PNG, historial, cambios de cuenta y anchuras de 320, 390 y 1440 píxeles. Requiere las dependencias de `supabase` y Chrome en la ruta utilizada por las verificaciones existentes del proyecto. Genera imágenes de revisión en `output/recognitions/`.

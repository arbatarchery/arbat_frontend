# Constelación de flechas v1.2

El generador compartido de Canvas exporta una lámina PNG de 1080 × 1350 sobre negro. Mantiene la transformación de coordenadas de la diana interactiva (centro 50/50 y radio 46), y reproduce sus diez anillos y el anillo X con proporciones exactas.

## Capas

- Geometría: transformación afín de cada impacto válido, sin desplazamientos, agrupación ni recorte de coordenadas. Los impactos coincidentes se dibujan individualmente. Se rechazan coordenadas ausentes o no finitas; se aceptan coordenadas numéricas en texto.
- Arte: KDE gaussiano con ancho fijo de 0,055 radios y soporte de 3,5 desviaciones. Una segunda escala de 0,018 radios aporta detalle dentro de la densidad existente. La transferencia cromática exponencial usa la misma escala absoluta en todas las sesiones: los puntos aislados permanecen fríos. El campo se limita al círculo de la diana. Cada estrella tiene halo, cuatro puntas y núcleo blanco de tamaño uniforme.
- Información: fecha y tipo real de sesión, rondas con registros (incluida la ronda actual parcial), configuración de flechas por ronda, total registrado, promedio y puntos. Los registros M aportan cero puntos y cuentan en el denominador, sin aparecer en geometría ni texto.

Los datos históricos remotos que no proporcionan configuración o rondas muestran «—» en esos campos. No se deduce una configuración a partir del número de estrellas. No se cambia la lectura de sesiones, la exportación CSV, el registro, la puntuación ni la diana interactiva. Se elimina la copia antigua del generador de entrenamiento para evitar una exportación alternativa con estética y reglas anteriores.

## Archivos

- `entrenamiento/js/constelacion.js`: geometría, KDE, estrellas y composición.
- `entrenamiento/js/entrenamiento.js`: pasa rondas/configuración y conserva la descarga PNG existente.
- `entrenamiento/historial/js/historial.js`: pasa los metadatos disponibles de cada sesión.
- Ambos `index.md`: versiones de recursos para renovar caché.
- `tests/constelacion.test.cjs`: escenarios A–F y validación de coordenadas.

## Validación

Ejecutar desde la raíz: `node --test tests/constelacion.test.cjs`.

Siete pruebas verifican A–F: 36 estrellas; 34 estrellas de 36 registros; agrupación desplazada; dos grupos sin puente; impactos dispersos de color frío; ningún impacto válido. También verifican transformación exacta, datos intactos, promedio con denominador completo, ausencia de texto sobre M y proporción 4:5.

Se generaron los seis ejemplos con Canvas real mediante una dependencia temporal de QA (`@napi-rs/canvas`, sin agregar dependencias a la web). Se verificaron sus cabeceras PNG (1080 × 1350), fondo negro opaco y composición visual, incluidos textos y estadísticas. Se comprobaron sintaxis de los tres scripts y `git diff --check`.

No hay suite de pruebas ni configuración de build JavaScript en el repositorio original. La revisión PNG no sustituye una prueba manual del botón de descarga en el navegador de producción; se conserva el flujo existente de `toBlob` y enlace de descarga. Integrar y desplegar únicamente después de revisión y aprobación.

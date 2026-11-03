# Entrenamiento e Historial en las rutas normales

La propuesta activa el respaldo y la lectura de Supabase en `/entrenamiento/` y `/entrenamiento/historial/`. Retira la página aislada `/pruebas/supabase/`. No borra datos del navegador ni sesiones de Supabase. El SDK oficial se publica bajo `entrenamiento/js/lib/` para que Jekyll incluya sus archivos.

## Servidor

Antes de publicar, el propietario debe haber ejecutado `supabase/setup/actualizar-historial-entrenadores.sql` y actualizado la función existente `training-sync` con `supabase/setup/training-sync-dashboard.ts`. Conservar los Secrets configurados, los orígenes permitidos y la verificación JWT antigua desactivada. Las peticiones verifican Supabase Auth o Buddy en el servidor; las funciones SQL están restringidas a service_role.

El propietario confirmó ambos pasos. La integración con las cuentas reales se comprobará después de aprobar y publicar la propuesta.

## Primera asignación de permisos

1. Publicar mediante revisión y merge de la propuesta.
2. Cada persona que recibirá permisos inicia sesión en Buddy y visita Historial. Así se registra su identidad, nombre y correo desde una respuesta autenticada del servidor.
3. El propietario ejecuta su archivo privado de configuración en SQL Editor. El archivo no se publica en GitHub. Las cuentas aún no verificadas se muestran como pendientes; repetirlo después de su primer acceso no duplica roles.
4. Recargar Historial para comprobar la aparición del panel.

Para esta academia, las tres cuentas indicadas por el propietario tendrán también rol de entrenador con alcance `academy`. Los entrenadores supervisan a todos los miembros actuales y futuros de esa academia. La estructura mantiene el alcance `assigned` para futuras selecciones de alumnos. Administradores supervisan su academia; SuperAdmin puede supervisar todos los arqueros. El propio entrenador se excluye del resumen de alumnos y conserva sus estadísticas personales.

## Comportamiento

- El contador del período usa la fecha de cada flecha, sin contar una importación antigua como entrenamiento reciente por la fecha de subida.
- La lista incluye el inicio de la última sesión, todas las flechas de ese día y su promedio, aunque esa sesión esté fuera del período seleccionado. La hora se muestra en America/La_Paz.
- Calendario: competencia propia o de alumnos en blanco; entrenamiento propio en naranja; actividad de alumnos en gris. El color principal sigue ese orden y los restantes se muestran como puntos. La actividad de alumnos acompaña el calendario personal del entrenador; al consultar un arquero se muestra su calendario individual.
- Sin acceso confirmado al servidor se retira el panel de alumnos. El historial personal conserva su alternativa local, con mensaje explícito si no se puede completar la consulta remota.
- El almacenamiento local, los CSV y el JSON enviado a Statetty conservan su formato. Los UUID de sincronización viven en el respaldo separado.

## Validación

Desde `supabase/`, instalar dependencias con `npm ci`. Desde la raíz ejecutar `node --test tests/*.test.cjs supabase/tests/*.test.mjs`.

`node supabase/scripts/check-live-release.mjs` verifica las rutas normales preparadas en Chrome con datos simulados, sin contactar Supabase ni Buddy reales. `node supabase/scripts/check-coaching-ui.mjs` comprueba permisos, filtros, calendario mixto, errores y vistas móvil/escritorio. El entorno local requiere Chrome.

La prueba de despliegue resuelve los recursos declarados por las páginas y ejecuta el JavaScript real. No sustituye el build completo de Jekyll ni la comprobación posterior de las cuentas reales.


## Carga inicial del historial

Historial espera a que Buddy termine de comprobar la sesión antes de consultar Supabase. Si una comprobación de sincronización concurrente no necesita crear credenciales, la lectura remota todavía puede preparar la identidad Buddy que necesita; no reutiliza ese resultado vacío como una falta de autenticación.

Al iniciar o reintentar se retiran los avisos anteriores y se muestra «Cargando datos de la nube». La conexión se confirma con una respuesta de contexto o de historial aceptada por las funciones del servidor. Los contadores muestran sesiones, andanadas, flechas y arqueros realmente recibidos, incluidas páginas parciales. La consulta no informa un total previo, por lo que la barra es indeterminada y no muestra porcentajes estimados. Repetir eventos de la misma cuenta durante la carga no reinicia las consultas.

La espera inicial de autenticación tiene un máximo de 45 segundos y se cancela al cambiar de cuenta o de período. Los errores reales y la falta de conexión mantienen el aviso de datos locales y su reintento. Un dispositivo anónimo sin datos en la nube no muestra un falso error de autenticación. No hay nuevas migraciones ni cambios en permisos para esta actualización.

Prueba: `node supabase/scripts/check-history-loading.mjs` simula 25 segundos de preparación, avance de contadores, reintento tras un error, cuenta anónima, espera vencida y falta de conexión, sin contactar los servicios reales.


## Consultas en paralelo

El lector descarga detalles de hasta tres sesiones en paralelo. Cada página del índice se sigue autorizando en el servidor; las versiones ya cargadas solo se reutilizan si aparecen autorizadas y sin cambios en ese índice actualizado. Las consultas concurrentes comparten una sola confirmación de vinculación de cuenta. Si falla una consulta, se cancelan y esperan sus compañeras antes de permitir el reintento, conservando las páginas parciales válidas sin duplicarlas.

La consulta del panel de entrenadores y la del historial seleccionado avanzan en paralelo. Si la nueva comprobación de permisos retira el arquero seleccionado, se descarta su resultado y se consulta el historial personal antes de actualizar las estadísticas. Se conserva el límite de tres peticiones de detalles, los contadores progresivos y la verificación de cuenta, propietario y revisión.

`node supabase/scripts/benchmark-history.mjs` compara la misma muestra de 8 sesiones, 21 andanadas y 119 flechas con 25 ms simulados por petición. Verifica datos idénticos, 18 peticiones de primera lectura y solo dos páginas de índice al volver a consultar las mismas revisiones. La medición es local, no una estimación garantizada del tiempo del servidor real. `node supabase/scripts/check-history-parallel.mjs` comprueba la carga simultánea y el descarte de resultados si cambian los permisos. Esta mejora no requiere migraciones ni actualizar la función Edge.

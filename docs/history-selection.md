# Historial: selección individual y Todos

## Publicación

1. Ejecutar `supabase/setup/actualizar-historial-todos.sql` en SQL Editor, sobre la instalación actual (migraciones 001–011). Crea el RPC `training_history_all`; no modifica sesiones, flechas, usuarios ni permisos de entrenamiento existentes. Solo `service_role` puede invocarlo y cada llamada verifica identidad Buddy, rol y alcance del solicitante.
2. Reemplazar el código completo de la Edge Function `training-sync` por `supabase/setup/training-sync-dashboard.ts` y desplegar conservando secretos, orígenes y configuración JWT existentes.
3. Crear y fusionar el PR desde el fork hacia `asosab/arbat_frontend:main`.

## Comportamiento

Historial inicia con el usuario actual de Buddy. No se agregan días, flechas ni competencias de alumnos a una selección individual. Resumen, calendario, gráficas, sesiones y detalle reciben el mismo conjunto de sesiones. La leyenda de entrenamiento identifica al arquero consultado y se elimina la categoría Actividad de alumnos.

La lista muestra Todos como primera opción después de confirmar acceso de entrenador/administrador. Solo al seleccionarlo se consulta el nuevo endpoint `history.all`, paginado y con el mismo control de acceso de las consultas individuales. Todos incluye sesiones en la nube del propio usuario y de otros arqueros a los que tiene acceso; no añade respaldos locales pendientes ni presenta datos parciales como un conjunto completo. Al elegir otra cuenta vuelve al endpoint individual. Los nombres de los propietarios aparecen en las sesiones de la vista conjunta para distinguirlos. Las cuentas sin identidad Buddy también pueden aportar sesiones autorizadas a Todos, sin ampliar el acceso del entrenador a otras academias.

El Panel de entrenadores aparece únicamente con Todos, debajo de Período; mantiene su estado inicial cerrado. Su contador de flechas corresponde a los arqueros supervisados y el resumen conjunto incluye también al propio usuario. La cuenta seleccionada se revoca si el contexto de servidor deja de permitirla. Cambiar de cuenta Buddy restablece la selección a esa cuenta.

Usuario consultado mantiene su posición inicial y usa sticky al alcanzar la parte superior de la ventana. El contador de arqueros supervisados aparece debajo de la descripción, sin la línea Buscar por nombre o identificador ni la frase sobre el historial propio. El campo conserva su nombre accesible. La lista desplegable queda limitada en altura para no ocupar toda la pantalla.

Hoy día consulta un solo día, calculado con la fecha y zona horaria locales del dispositivo. Los períodos mantienen los mismos criterios de fecha de sesión que el Historial existente. El selector no cambia su período inicial. El acceso anónimo conserva el resumen limitado existente.

También se conserva en esta rama el ajuste ya solicitado: `system.status` advierte por latencia solo después de 10 segundos y dispone de 20 segundos para completar. Las otras consultas mantienen su límite actual.

## Validación

200 pruebas aprobadas. Se verifican selección explícita de endpoints, permisos por rol y academia, revocación de supervisión, fechas y paginación. Las pruebas visuales con datos ficticios comprobaron: usuario Buddy inicial (1 flecha), Todos (6 flechas), Ana (2 flechas sin alumnos mezclados), Hoy día y posición sticky a 0 píxeles al desplazarse. No se insertaron datos de prueba en producción.

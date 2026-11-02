# Guardado local, cola e importación histórica

Implementación local en `feature/supabase-sync`. No se ha publicado ni activado Supabase. La configuración pública se incluye ahora como JS generado desde el JSON, con enabled=false: no solicita sesiones ni crea usuarios. Las páginas de entrenamiento/historial cargan los módulos locales de esta rama, no la página de producción.

## Componentes

- `entrenamiento/js/sync-store.js`: IndexedDB versionada `arbat-training-sync-v1`, stores sessions/operations/meta, mappings UUID, snapshots originales, proyección remota, recibos locales y lease entre pestañas.
- `sync-engine.js`: cola por sesión, confirmación individual, reintentos con backoff/jitter, priorización de sesiones activas y transporte al endpoint preparado. Desactivado por defecto.
- `sync-bootstrap.js`: conecta los guardados a la copia adicional, importa en segundo plano, publica `arbat:sync-state` y conserva temporalmente los fallos pendientes de reintento.
- Hooks pequeños en entrenamiento: snapshot tras guardado habitual, archivo antes de crear la siguiente sesión y recuperación de una copia adicional cuando el guardado habitual falló.
- Historial local: combina registros habituales con backups sin reescribir originales; conserva multiplicidad de registros sin ID y no muestra backups de otra cuenta al consultar una identidad distinta. El proveedor remoto opcional Buddy mantiene su ruta actual; su sustitución/mezcla con un proveedor Supabase queda para la integración de historial remota.

## Compatibilidad

No se agregan UUID de flechas ni metadatos de cola al objeto legado, CSV o JSON de Statetty. Su generación y sus claves originales se mantienen. Los UUID existen solamente en el sidecar y en el protocolo nuevo. Fixtures generados con el código anterior (`d0767d5`) fijan CSV con BOM/CRLF y telemetría en America/La_Paz para comparación de bytes/igualdad profunda.

El guardado habitual sigue siendo síncrono y ocurre primero. La transacción IndexedDB guarda snapshot/proyección y operaciones conjuntamente; la red solo lee operaciones ya confirmadas localmente. No existe transacción atómica entre localStorage e IndexedDB. Si se cierra antes del commit adicional, la importación reconstruye desde el dato habitual; si falló el dato habitual y la copia adicional sí se confirmó, el arranque restaura esa copia. Nunca se considera una promesa de guardado equivalente a un commit.

Si fallan ambos almacenes, el dato solo permanece en memoria: se muestra una advertencia de mantener la página abierta. Si solo falla la copia adicional, se informa que el registro habitual sigue guardado. Los errores no se convierten en confirmaciones remotas. Un conflicto conserva la alternativa recibida y bloquea el envío de esa sesión; no decide cuál versión borrar.

Al cambiar de una cuenta autenticada a otra o salir, se archiva la sesión anterior con su propietario y se crea otra. Un inicio de sesión puede asignar la sesión activa anónima según el comportamiento existente, pero no reemplaza el propietario de otra cuenta. La atribución remota de históricos anónimos sigue requiriendo claim con ambas credenciales verificadas.

## Identidad de registros

Sesiones con ID legado mantienen mapping persistente por ID completo, no por fecha. Si el ID ya es UUID válido puede conservarse; un ID antiguo que no es UUID obtiene uno nuevo. Antes de crear operaciones se confirma el mapping; si el cierre ocurre entre mapping y snapshot, el reintento reutiliza el mapping ya guardado.

Registros históricos sin ID usan fuente + SHA-256 de contenido canónico + número de ocurrencia para localizar un UUID asignado una sola vez. Dos registros idénticos dentro de la misma fuente se conservan como dos sesiones. Reordenar registros sin cambiar contenido/multiplicidad no genera otros UUID. Coincidencias idénticas entre fuentes distintas se conservan y se señalan como ambiguas. Una versión editada sin ID puede ser otro registro: no se inventa una identidad por fecha. Importaciones independientes en distintos dispositivos de archivos sin IDs no pueden deduplicarse con certeza; requieren manifiesto con UUID o revisión.

La fuente current sin ID dispone además de un alias para conservar su UUID cuando el código legado agrega el ID al normalizar. Versiones compatibles current/history de una misma sesión se reúnen; un archivo cerrado no se reabre por una copia actual atrasada. Versiones incompatibles de un mismo ID se conservan como alternativas y requieren revisión. Datos dañados de una fuente no impiden leer las demás; el reporte persiste en meta. Los originales no se borran, renombran ni reescriben al importar.

Andanadas reciben UUID estable por su posición estructural, que en la aplicación actual solo se agrega al final. Flechas reciben UUID y asociaciones con su contenido original y multiplicidad: pasar de current a completed conserva UUID; borrar y volver a agregar tras una captura del borrado genera otro. No se infiere identidad por hora de marcado. Las capturas se serializan por pestaña y el fingerprint esperado evita sobrescribir silenciosamente un snapshot cambiado desde otra pestaña. Una futura edición/reordenación arbitraria de andanadas necesitará ampliar ese modelo antes de habilitarla; actualmente la UI no permite esa operación.

## Envíos y recuperación

Una operación obtiene operation_id al guardarse localmente. Su base_revision se fija y su envelope se congela al primer intento, no al capturar futuras flechas. Ante timeout se reutiliza exactamente ese envelope. El ACK elimina la operación y avanza el checkpoint de sesión en una sola transacción; conflicto/rechazo conservan el payload bloqueado para revisión. No se cambia una operación enviada para hacerla coincidir con otra revisión.

FIFO dentro de cada sesión; sesiones activas antes de lotes históricos. La importación usa transacciones por registro, de manera que una captura nueva no espera a que termine todo el historial. Un vaciado procesa hasta 32 operaciones/15 segundos y continúa después. Se coordina con Web Locks cuando está disponible y con lease IndexedDB renovado antes de cada envío; la idempotencia remota protege también si expira un lease con una petición en curso. No se confía en unload/sendBeacon.

La cola permanece dividida por propietario local y principal Supabase original. Con Buddy, se reclama antes de vaciar y se comprueba identidad entre envíos. Cambiar de cuenta no drena la cola anterior. No se reasigna automáticamente una operación de un principal antiguo a otro recién creado; requiere recuperación de credenciales/reconciliación explícita. Errores locales sin reintentar suspenden la obtención de identidad en el bootstrap.

## Activación pendiente

El motor delega la identidad al nuevo adaptador sync-identity.js, conectado en el bootstrap pero desactivado. Utiliza el SDK oficial para sesiones anónimas y renovación, conserva credenciales en una partición IndexedDB distinta por cuenta/principal y entrega principalId/supabaseToken/accountKey/buddyToken. Solo carga el SDK local cuando se habilita y hace falta identidad. Crear un usuario anónimo exige un token Turnstile; el widget solo se abre al solicitarlo desde el panel. La validación de credenciales permanece en el servidor; accountKey solo separa colas locales. Se debe configurar la protección CAPTCHA también en Supabase, no solo en el navegador.

La barra/panel y el adaptador ya se prepararon y probaron en Chrome local con servicios interceptados. Faltan configuración y verificación reales de Turnstile/Supabase; lectura remota del historial con Buddy verificado y mezcla por UUID; recuperación asistida de conflictos; administración auditada; validación en Safari móvil. No basta cambiar enabled para completar estas piezas. No activar producción sin revisión y aprobación. Ver `supabase-identity-ui.md`.

## Verificación

`node --test tests/*.test.cjs` conserva las pruebas anteriores. Desde `supabase`, `npm ci` y `npm test` ejecutan además:

- importación repetida, dos sesiones el mismo día, UUID legados/no UUID, registros idénticos con multiplicidad y fuentes dañadas;
- movimiento/borrado/reemplazo de flecha, cierre de sesión y recuperación entre escrituras;
- rollback de IndexedDB, cambio concurrente entre pestañas y lease vencido;
- ausencia de red desactivado/offline, respuesta perdida después del commit, conflictos y cambio de cuenta;
- código real de entrenamiento con DOM simulado, archivos CSV/JSON de referencia y backup de historial;
- recorrido integrado IndexedDB -> transporte -> handler de servidor -> RPC/PostgreSQL -> ACK, sin peticiones externas.

IndexedDB se prueba con fake-indexeddb y PostgreSQL con PGlite. Estas pruebas no sustituyen Safari/Chrome móviles, ejecución Deno/PostgREST ni concurrencia real entre conexiones PostgreSQL. No contienen tokens reales ni modifican el proyecto remoto.

# Supabase: plan de integración de entrenamiento

Fecha: 2026-11-01. Repositorio: `asosab/arbat_frontend`.
Base inspeccionada: `587019d202112e364594d05492e3adfa57a280c6` (`main`).
Rama local: `feature/supabase-sync`. Estado: inspección y diseño; todavía no hay sincronización implementada ni migraciones aplicadas.

## 1. Alcance y preservación

Arquitectura local-first: cada flecha se guarda antes de iniciar cualquier envío; la red nunca bloquea el marcado. Sincronización progresiva, también sin cuenta, recuperación tras cierre de pestaña y asignación automática del historial anónimo al iniciar sesión. No cambiar las claves ni los formatos CSV/JSON existentes de Statetty. Los metadatos de sincronización viven en un almacenamiento separado.

No desplegar, fusionar a main ni activar en producción sin aprobación. Trabajar primero con Supabase de desarrollo. La copia local anterior `arbat_frontend` tiene cambios pendientes y otro origen; no se utilizó como base ni se modificó.

## 2. Inspección del código real

| Archivo / función | Comportamiento y consecuencia |
|---|---|
| `entrenamiento/js/entrenamiento.js`, `fresh`, `save`, `addArrow` | Sesión con `id`, `date`, `startedAt`, `completed`, `current`, propietario, tipo, distancia, tamaño de diana y notas. `save()` usa localStorage y silencia errores. Las flechas tienen score/label/x/y/recordedAt, sin UUID propio. |
| `finishCurrentEnd`, `archiveCurrentSession` | Pasan flechas de current a completed; el archivo conserva copia de sesión y CSV, emite `arbat:session-ended` y crea una nueva sesión. Capturar el archivo antes de sustituir el estado. |
| `undoBtn` | Elimina la última flecha actual. La nube debe recibir una baja explícita, incluso si ya confirmó el alta. |
| `csvText`, `sessionRows`, `publishSessionData` | CSV con BOM, comentarios, CRLF, orden y columnas existentes; expone `window.arbatSessionData` y `window.arbatTrainingHistory`. Preservar byte a byte para el mismo estado. |
| `andanadaDatos`, `sendAndanadaTelemetry` | Envía al cerrar andanada mediante `Buddy.telemetry.send`: `{event:'entrenamiento.andanada', module:'entrenamiento', data:{andanada:…}}`. Incluye usuario, sesión, posiciones, hora, puntajes, polar, distancia, tamaño de diana y notas. No envía cada flecha al marcarla: Supabase será una vía adicional independiente. |
| `syncOwner` | Reasigna solo la sesión actual; puede sustituir un propietario autenticado distinto. Corregir en la futura integración para no transferir sesiones de otra cuenta. |
| `entrenamiento/historial/js/historial.js` | Lee almacenamiento local o proveedor opcional `Buddy.trainingHistory.getSessions/getUsers`; con proveedor sustituye la fuente local. Integrar mezcla local/remota por UUID para que las pendientes sigan visibles. |
| `isPrivileged` del historial | Usa roles del navegador para mostrar controles. No constituye autorización para acceder a datos remotos. |
| `assets/js/user.js`, `_layouts/default.html` | Autenticación delegada a Buddy, cargado desde Statetty. No se encontró una integración Supabase existente en los puntos inspeccionados. |

Claves existentes: `arbat-training-current`, `arbat-training-history`, `arbat-training-current-csv`, `arbat-anonymous-device-id` y legado `arbat-training-AAAA-MM-DD`. El fallback de ID de sesión no siempre es UUID. Ni la fecha ni el identificador anónimo de localStorage son pruebas de identidad.

Pruebas de referencia: `node --test tests/*.test.cjs`: 16 aprobadas. Cubren constelaciones y sesión anterior; no prueban aún sincronización, CSV completo ni seguridad remota. No hay `.github/workflows` en esta revisión. La descarga avisó de colisión `CNAME`/`cname` en este sistema de archivos; no alterar esos archivos.

## 3. Diseño local y protocolo

Nuevo módulo `entrenamiento/js/sync-store.js`: IndexedDB versionada con stores `sessions`, `ends`, `arrows`, `operations`, `legacyMappings`, `checkpoints` y `leases`. Conservar originales de localStorage sin reescribirlos para importar. Usar UUID generado criptográficamente para sesión/andanada/flecha/operación; sin aleatoriedad débil como fallback. Mapear el ID anterior a UUID en el sidecar; conservarlo también como `legacy_session_id`.

En las nuevas interacciones, asociar UUID estable en el sidecar a cada flecha y trasladarlo al cerrar andanada, sin regenerarlo según posición o puntaje. Al borrar, conservar tombstone. Después de recargar, reconstruir asociaciones usando el snapshot/versionado guardado. Si hay discrepancia entre el legado y el sidecar, reconciliar antes de enviar y mostrar estado pendiente; no inventar una confirmación.

Secuencia de guardado: mantener `save()` local primero, devolver éxito/error verificable; después transacción IndexedDB con snapshot, nueva revisión y operación. No puede haber transacción atómica entre localStorage e IndexedDB: al arrancar reconciliar el snapshot legado con el último checkpoint, reconstruir operaciones faltantes y registrar errores de persistencia. Nunca mostrar «guardado local correcto» cuando ambas vías fallan. Una cuota agotada debe resultar en rojo y mensaje visible, manteniendo los datos en memoria.

Nuevo `sync-engine.js`: activar solo con configuración pública y bandera explícita; sin configurar, cero peticiones. Procesar cola después del commit local, lotes pequeños, orden por sesión, reintentos exponenciales con jitter, timeout, pausa offline y reanudación en online/visibilitychange/arranque. No depender de unload ni de sendBeacon. Coordinar pestañas mediante Web Locks con lease persistente como respaldo. La idempotencia del servidor es obligatoria aunque falle el bloqueo.

Contrato propuesto: `POST /training-sync` con versión de esquema y operaciones `{operation_id, session_id, entity_id, kind, base_revision, payload}`; tipos session.upsert, end.upsert, arrow.upsert, arrow.delete, session.close. El servidor deriva propietario de credenciales verificadas, nunca de `payload.owner`. Respuesta por operación: accepted + revisión confirmada, conflict o rejected. ACK y checkpoint locales en una transacción. Una caída después del commit remoto se resuelve reenviando el mismo operation_id.

Aplicación remota transaccional por operación; idempotency key única por principal + operation_id, verificar también hash del payload para rechazar reutilización con otro contenido. Si hay conflicto de revisión, conservar ambas versiones y reconciliar; no usar fecha del cliente como last-write-wins. Reintentar fallos transitorios/429 con Retry-After; no repetir indefinidamente errores de validación/autorización. Confirmar cierre solo después de sus flechas y bajas pendientes.

## 4. Importación histórica sin pérdida

1. Leer las claves actuales, el historial y todas las claves legadas de entrenamiento sin alterar su contenido; validar cada registro, aislar corruptos y reportarlos sin descartar el resto.
2. Si hay ID de sesión, usar un mapping persistente entre origen + ID legado y UUID; reunir current/history cuando sean la misma sesión. Nunca unir dos sesiones solo por compartir fecha.
3. Para registros sin ID, persistir UUID por registro de origen antes del primer envío. Registrar huella canónica completa y multiplicidad; dos sesiones idénticas pueden ser legítimas. Coincidencias ambiguas entre fuentes se conservan y señalan, no se colapsan automáticamente.
4. UUID de andanadas y flechas se asignan una vez en la misma transacción que mappings y operaciones; ordinal solo es posición, no identidad. Un checkpoint por fuente permite reanudar tras cierre/interrupción.
5. Repetir importación no produce nuevas operaciones ni filas para mappings ya confirmados. Una versión distinta de una sesión conocida produce revisión, no otra sesión. Conservar los valores originales de fecha, coordenadas, misses y metadatos ausentes; no rellenarlos con datos inventados.
6. Priorizar flechas nuevas sobre lotes históricos, limitar tamaño por petición y contabilizar pendientes por separado. Nunca borrar automáticamente originales ni CSV tras un ACK.

Limitación explícita: UUID asignados a datos legados identifican de forma estable esa migración en ese navegador. Un archivo antiguo sin identificadores importado independientemente en otro dispositivo no puede deduplicarse con certeza; se necesita manifiesto de importación con UUID o resolución de ambigüedad, nunca comparación de fechas.

## 5. Identidad, recepción anónima y reclamación

Mantener Buddy como acceso visible. Antes de implementarlo se debe verificar su contrato real de autenticación: emisor, audiencia, expiración, JWKS o endpoint servidor de validación. No aceptar `ArbatUser.get()`, email, roles enviados por cliente ni un JWT solo decodificado como identidad. No asumir compatibilidad directa Buddy/Supabase.

Propuesta: Edge Function para ingreso y puente de identidad. Sin cuenta, usar Supabase Auth anónimo (usuario autenticado anónimo con JWT propio), sujeto a configuración y protección antiabuso. Sin internet no se exige crear ese usuario para registrar flechas. No conceder INSERT público a `anon` ni SELECT de sesiones sin credenciales. Validar tamaños, esquema, pertenencia, frecuencia y presupuesto por principal; CAPTCHA en creación anónima y cuotas de servidor. CORS no sustituye autenticación.

Al iniciar sesión Buddy: el servidor verifica la identidad Buddy y la prueba del principal anónimo original mediante un flujo de reclamación de un solo uso, con expiración. Vincular en transacción solamente las sesiones anónimas elegibles y sus operaciones; impedir segunda reclamación a otro usuario, registrar auditoría y responder con mappings. En una cuenta Supabase anónima convertida a permanente se puede conservar auth.uid; para entrar a una cuenta existente hace falta transferencia verificada, no basta cambiar owner_id en el navegador.

Para el historial legado todavía no subido, reclamar automáticamente los registros anónimos de esta instalación al primer login verificado. Conservar un mapping de propietario en el sidecar, no reescribir el JSON Statetty. No reasignar registros cuyo propietario ya es otra cuenta. Datos antiguos sin prueba criptográfica solo pueden atribuirse por posesión del almacenamiento local; explicitar esa limitación, sin prometer recuperar dispositivos borrados. En equipo compartido, el criterio es la cuenta que inicia sesión y reclama el conjunto anónimo aún no asignado. Al logout/cambio de cuenta, separar colas y credenciales para impedir que operaciones del usuario A se envíen como B.

El puente Buddy es una dependencia abierta: si no hay mecanismo verificable, mantener sincronización anónima/local y bloquear la reclamación autenticada hasta resolverlo. No migrar el login de producción silenciosamente.

## 6. Modelo remoto y RLS

Tablas propuestas: `profiles`, `external_identities` (issuer + subject únicos), `role_assignments`, `coach_athletes`, `training_sessions`, `training_ends`, `training_arrows`, `sync_operations`, `anonymous_claims`, `audit_events`. Entidades con UUID, owner verificado, revisiones, timestamps de servidor y tombstones. Sesiones conservan legacy_session_id y zona/fecha local además de instante UTC cuando existe. Flechas conservan coordenadas, score/label y recordedAt; no recalcular lo histórico. Índices owner/session/revisión, FKs e idempotencia única; ownership de hijos siempre coherente con sesión.

Matriz mínima propuesta para concretar permisos acumulativos; confirmar alcance organizativo antes de aplicar políticas:

| Rol | Leer | Escribir / administrar |
|---|---|---|
| Usuario | Sus sesiones | Sus sesiones; no cambiar roles ni propietario |
| Entrenador | Lo anterior + alumnos asignados | Sus sesiones; vínculo/alumnos según autorización administrativa, sin editar registros del alumno por defecto |
| Administrador | Lo anterior + ámbito de escuela explícitamente asignado | Gestionar vínculos y roles inferiores en su ámbito; no otorgar Administrador/SuperAdmin |
| SuperAdmin | Todos los ámbitos autorizados por política | Gestionar roles y ámbitos, con auditoría; sin exponer secretos al cliente |

Hasta definir un ámbito de escuela, denegar facultades administrativas globales. Roles guardados en tablas protegidas, no user_metadata editable. Primer SuperAdmin se provisiona mediante migración o acción administrativa segura, nunca por primer registro.

RLS obligatoria en todas las tablas expuestas. Principal anónimo autenticado: solo sus sesiones, sin directorio de usuarios. Usuario: `owner_id` del principal verificado. Entrenador: relación activa consultada en servidor. Administradores: ámbito validado. Denegar por defecto acceso cruzado y modificación de roles/ownership; WITH CHECK además de USING. Funciones privilegiadas con search_path fijo, grants mínimos y autorización interna; no confiar en parámetros de identidad. Si Edge Function usa service_role, verificar explícitamente pertenencia y roles antes de cada operación porque esa clave omite RLS. Probar también acceso directo a Data API, no solo la función.

## 7. Indicador móvil y panel

En breakpoint móvil existente (hasta 859 px): línea horizontal 5 px de alto, ancho 30vw, centrada respecto de pantalla, fuera del recuadro de diana y pegada exactamente a su borde inferior exterior. Anclar al contenedor exterior visible, no al SVG sometido a zoom. Mantener disposición de escritorio. Área táctil accesible de al menos 44 px sin capturar gestos sobre la diana ni tapar controles.

La conversación recuperada confirma los cinco colores pero no conserva todas las definiciones anteriores; esta es la semántica propuesta para implementar y revisar:

| Color | Estado real |
|---|---|
| Verde | Guardado local confirmado y todas las revisiones confirmadas por servidor |
| Amarillo | Hay cambios guardados localmente pendientes, en espera de red o reintento |
| Rojo | Fallo de guardado local o error remoto que requiere atención; explicar cuál |
| Gris | Sincronización desactivada o aún sin configurar; no implica copia remota |
| Celeste | Envío, importación o asignación en curso, sin dar por confirmado el resultado |

Prioridad: error que requiere atención > desactivado > actividad > pendientes > confirmado. Offline con pendientes es amarillo. Cola vacía sin confirmación/checkpoint remoto no es verde. El panel muestra también conexión, cuenta/anónimo, pendientes, guardado local y última confirmación, leyenda completa y botón Reintentar cuando proceda. Abrir tocando o con teclado; cerrar con Escape, foco restaurado, texto además del color y anuncios discretos. No mostrar tokens ni detalles internos de infraestructura.

## 8. Entregas y verificación

1. **Esta entrega:** inspección, rama local y plan. Sin cambios funcionales.
2. **Base local sin nube:** módulos de store/engine, mappings UUID e importador; hooks de save/undo/cierre/configuración con sync desactivado. Pruebas de errores de almacenamiento y recuperación.
3. **Supabase de desarrollo:** migraciones revisables, funciones de ingreso/reclamación y pruebas RLS. Resolver contrato Buddy antes de activar asignación autenticada.
4. **Integración:** progresión por flecha, tombstones, estados/panel móvil, mezcla de historial local/remoto por UUID; habilitación solo en entorno de prueba.
5. **Aceptación:** revisión del diff, CSV/JSON invariantes, pruebas de red y permisos; demostración con cuenta y sin cuenta. Aprobación explícita antes de publicación.

Casos obligatorios: dos sesiones mismo día; IDs legados no UUID; archivo sin ID; importación repetida/interrumpida; current/history duplicados y registros idénticos legítimos; borrar después de ACK y antes de ACK; cierre de andanada sin cambiar ID de flecha; cierre de pestaña en cada frontera de persistencia; timeout tras commit remoto; dos pestañas; conflicto entre dispositivos; desconexión/reconexión; 401/403/429/5xx; cuota agotada; localStorage e IndexedDB bloqueados; login a cuenta nueva/existente y logout/cambio de cuenta; reclamación repetida o ajena; entrenador no asignado; escalación de roles; acceso directo a tablas; lectura anónima cruzada. Comparar fixtures CSV byte a byte y payload JSON de Buddy por igualdad profunda antes/después; no agregar UUID al JSON Statetty. Verificar geometría móvil, zoom, teclado y panel en anchos 320/390/859 px y escritorio.

## 9. Preparación solicitada al usuario

Crear un proyecto Supabase de desarrollo desde https://supabase.com/dashboard. Compartir únicamente URL del proyecto y publishable key pública de cliente. No enviar contraseña de base de datos, access token, secret key ni service_role al chat/GitHub. No se necesitan para esta inspección. Las migraciones y secretos de servidor se aplicarán por el propietario mediante un flujo seguro cuando estén preparados y revisados. Aún no activar producción ni asignar SuperAdmin.

Documentación oficial consultada:
- https://supabase.com/docs/guides/auth/auth-anonymous
- https://supabase.com/docs/guides/auth/auth-identity-linking
- https://supabase.com/docs/guides/auth/third-party/overview
- https://supabase.com/docs/guides/auth/jwts

## 10. Estado de acceso

GitHub permite lectura del repositorio. Crear la rama remota mediante el conector devolvió 403 «Resource not accessible by integration», aunque el inventario mostraba push=true. Se creó correctamente la rama local mediante git en un clon separado del repositorio solicitado. No se intentó publicar por otra vía ni se modificaron permisos de GitHub.

## 11. Configuración pública recibida

Se guardaron la URL y publishable key proporcionadas por el propietario en `entrenamiento/config/supabase.public.json`, con `enabled: false`. Este archivo no está cargado por la aplicación y no crea clientes, usuarios anónimos ni peticiones. No se verificó aún la conexión ni se crearon tablas, políticas o funciones en el proyecto remoto. La clave pública no sustituye las políticas RLS ni autoriza operaciones administrativas.

Antes de conectar cuentas existentes sigue pendiente localizar el contrato verificable de Buddy (issuer, audience y JWKS o endpoint de validación del servidor). No se encontró la documentación de auth referenciada por las exclusiones de `_config.yml` dentro de este clon. La semántica de colores del apartado 7 sigue siendo propuesta, no una decisión recuperada íntegramente de la conversación anterior.

## 12. Base SQL y verificación de identidad preparadas

Se añadió `supabase/migrations/202611010001_training_foundation.sql` con las tablas, restricciones e índices y las políticas de lectura descritas en `supabase/README.md`. La administración queda delimitada por escuelas explícitas; los perfiles solo son visibles para su dueño. No hay aún escrituras de cliente, administración de roles ni servicio de ingreso habilitados. Se excluyó `supabase/` del build Jekyll. Ningún archivo de entrenamiento, CSV ni telemetría fue modificado.

Se localizó el contrato público ausente en el clon en `https://statetty.com/assets/buddy/modules/auth/auth-service-contract.md` y el módulo de auth público. El contrato documenta un endpoint HTTPS de consulta de sesión y el módulo expone `getAccessToken()`. Se preparó el helper de servidor `buddy-identity.mjs` con rechazo ante fallos y pruebas simuladas; esto reduce la dependencia abierta del apartado 5, pero no equivale a una sesión real validada ni a una reclamación implementada. No se enviaron tokens reales, no se crearon usuarios y no se consultó ni modificó el proyecto Supabase remoto.

Verificación: migración ejecutada en PostgreSQL embebido local con usuarios ficticios y roles SQL anon/authenticated/service_role; 9 casos de base más su prueba contenedora y 4 pruebas del verificador (14 pruebas contabilizadas por Node). Debe repetirse en Supabase de desarrollo antes de activar. Las siguientes entregas siguen pendientes: ingreso con límites e idempotencia transaccional, mapping/reclamación, administración auditada, cola/importador local e interfaz de estado.

## 13. Ingreso y asignación implementados localmente

La segunda migración añade dos RPCs exclusivas de service_role: recepción por operación con revisión de sesión, hash canónico y recibo idempotente; y asignación con ambas sesiones verificadas por el handler. La Edge Function training-sync se preparó con límites de body/lote, verificación remota de Supabase Auth/Buddy, orígenes explícitos y bandera desactivada por defecto. No tiene escrituras generales a tablas. Contrato, límites y configuración: `supabase/training-protocol.md`.

Ajuste de identidad: no se necesita otro login ni emitir JWT canónico. La primera identidad Buddy se vincula al principal Supabase actual; otras fuentes anónimas transfieren sus sesiones al mismo principal canónico. Se conservan UUID y receipts originales para permitir reintentos. Tras vincular, el JWT anónimo antiguo no autoriza lecturas ni escrituras sin Buddy. Queda pendiente un endpoint de historial Buddy verificado. El hash de reclamación es recibo de verificación en vivo, no credencial reutilizable.

Se probaron reenvíos tras commit, conflictos, borrado/cierre, asignación entre dispositivos y rechazo a otra cuenta, permisos RPC, cuotas y HTTP simulado. No hubo tráfico al proyecto Supabase, migraciones remotas, cambios al registro de entrenamiento ni publicación. Concurrencia real y Deno/PostgREST requieren validación posterior de desarrollo, antes de habilitar. Cola local, importador, indicador y administración auditada siguen pendientes.

## 14. Guardado local y cola conectados en la rama

Se implementaron sync-store/engine/bootstrap y los hooks de guardado/archivo de entrenamiento, con recuperación desde IndexedDB y consulta de backups en el historial local. Las claves y formatos legados se mantienen. La importación es de solo lectura, usa UUID persistentes y multiplicidad, no compara solo fechas y señala versiones incompatibles sin borrarlas. Se separan las cuentas y se archiva la sesión anterior al salir/cambiar de usuario, en vez de reemplazar su propietario.

El motor envía solo operaciones ya persistidas, congela el envelope antes del primer envío, confirma cada ACK transaccionalmente y conserva conflictos. Web Locks/lease coordinan pestañas. El transporte sigue desactivado y no hay adaptador real de autenticación ni creación anónima conectados. Detalle y límites de esta entrega: `docs/supabase-local-sync.md`. Faltan la integración de identidad/CAPTCHA, lectura remota, administración, resolución de conflictos e indicador móvil.

Se añadieron pruebas de importación, recuperación, cuentas, compatibilidad CSV/JSON y un recorrido completo local entre IndexedDB, transporte, handler y PostgreSQL, incluido timeout después del commit. No se hicieron peticiones al proyecto Supabase ni publicaciones. Las pruebas de navegador usan DOM simulado y deben complementarse con validación visual/real antes de activar.

## 15. Sesiones y panel móvil conectados, aún desactivados

Se conectó el adaptador de identidad al bootstrap con SDK oficial local, almacenamiento separado de credenciales, renovación y separación por cuenta/principal. Se preparó el widget Turnstile de confirmación explícita. El JSON público genera sync-config.js con enabled=false; no se hicieron altas ni peticiones al proyecto real. Faltan SITE KEY pública/configuración real de Turnstile y configuración/aplicación de backend por el propietario antes de pruebas reales.

Se añadió barra móvil 5px/30vw y panel con cinco colores, pendientes, guardado y reintento. Chrome local verificó anchos 320/390/859/1024px, contacto con borde exterior, área táctil sin solapamiento, Escape/foco y layout de escritorio. El SDK real se ejercitó con Auth/API simulados; también se comprobó renovación sin crear otro usuario. Detalles, límites y pasos de desarrollo: `docs/supabase-identity-ui.md`. Lectura remota del historial, administración auditada y recuperación asistida siguen pendientes antes de publicación.

## 16. Instalación de base confirmada por el propietario

El propietario ejecutó el instalador y aportó captura del resultado esperado: 14 tablas de entrenamiento, 14 con RLS y estado estructura_preparada. La comprobación remota de acceso con usuarios reales sigue pendiente. Se preparó un bundle autocontenido training-sync-dashboard.ts para el editor de Edge Functions, sin imports ni secretos y desactivado por defecto. Tres pruebas específicas del bundle verifican desactivación y rechazo de credenciales ausentes/inválidas. No se ha desplegado por herramientas ni activado la web. Siguiente paso manual: instalar la función de desarrollo, después configurar sus variables de servidor sin compartir secretos.

## 17. Receptor habilitado por el propietario y vista previa manual

Tras el despliegue/configuración manual del propietario, el endpoint primero devolvió sync_disabled (503) y, después de que el propietario habilitase usuarios anónimos y la bandera del servidor, devolvió supabase_session_required (401) ante una solicitud sin sesión. No se enviaron operaciones ni se crearon usuarios con esas comprobaciones. No prueban aún una escritura autenticada.

Se preparó y arrancó una vista previa local en localhost:8000 con datos ficticios y almacenamiento separado por prefijo/base IndexedDB. Solo esa página habilita el cliente en memoria; la configuración pública versionada sigue desactivada. Chrome verificó aislamiento y estado captcha_required, sin ninguna petición externa. El propietario debe completar Turnstile y marcar dos flechas para continuar la prueba real. Detalles: `docs/supabase-live-preview.md`. La web publicada y la rama remota no se modificaron.

## 18. Primer ACK real reportado y controles de validación manual

El propietario reportó que la barra volvió a verde tras la segunda flecha en la vista previa conectada al proyecto real. Se registró este resultado sin afirmar todavía pruebas completas de roles, cuenta Buddy ni recuperación real de red. Se añadieron controles locales para simular corte solo de Supabase y comparar UUID/revisión/flechas con el respaldo mediante GET autenticados, sin exponer credenciales. Los controles no escriben ni eliminan datos remotos y no alteran la web publicada. Pruebas unitarias y Chrome comprobaron su comportamiento con tráfico externo bloqueado; la comprobación manual del propietario es el siguiente paso.

### Revisión del 1 de noviembre: historial y acceso sin CAPTCHA adicional

Preparadas lecturas de historial paginadas con revisión fija y permisos de Usuario/Entrenador/Administrador/SuperAdmin en SQL; combinación cliente por UUID y conservación de cambios locales pendientes. historyEnabled sigue false. Preparado puente Buddy verificado en cada petición, sin una sesión anónima adicional, y solicitud automática del CAPTCHA anónimo al terminar la primera andanada con conexión. La solicitud pendiente sobrevive al modo sin conexión/recarga; la cancelación voluntaria conserva el reintento manual. Se corrigieron reintentos de bloqueos dejados por páginas cerradas y despertares de cola durante envíos. Validación: 141 pruebas locales y recorridos Chrome con servicios simulados. No se aplicaron migraciones 0003/0004 ni se reemplazó la función remota. Falta la prueba Buddy real y la administración de roles/asignaciones antes de considerar completa la integración.

### Lotes de recuperación e históricos

Preparado el cliente para enviar de inmediato hasta 32 operaciones acumuladas por sesión, con límite de 120 KiB, prioridad de la sesión activa y sobres/ACK persistentes por UUID. La migración 0005 y el handler reducen cada lote a una sola consulta SQL; el límite de ingreso cuenta peticiones acotadas y las cuotas por operación siguen vigentes. Se verificó importación histórica repetida sin modificar fuentes CSV/JSON. 157 pruebas locales aprobadas; queda aplicar 0005/actualizar Edge y medir recuperación real. enabled/historyEnabled publicados siguen false.

### Prueba en dominio real autorizada y preparada

El propietario prefirió probar en arbatarchery.com ante la demora para habilitar localhost en Buddy. Se preparó y comprobó una página aislada bajo /pruebas/supabase/, sin modificar entrenamiento habitual. Rama subida a arbatarchery/arbat_frontend:feature/supabase-domain-test, commit 5964d9a6a9ddc4d74e895794308678cfcf53ed7b; comparación con asosab/main verificada: solo 22 archivos añadidos. La integración no tiene permiso de escritura/creación de propuestas en asosab (403), por lo que la propuesta/fusión requieren acción manual del propietario. También falta permitir https://arbatarchery.com en TRAINING_ALLOWED_ORIGINS del Supabase de desarrollo. 162 pruebas y recorrido Chrome simulado aprobados; no se ha publicado ni completado login real. Detalles en docs/supabase-domain-test.md.

### CAPTCHA y tema de la página aislada (2 noviembre)

El propietario añadió arbatarchery.com en Cloudflare Turnstile y confirmó funcionamiento de la página. Se preparó una corrección para mantener legibles errores del desafío y diferenciar rechazos de Supabase. También se preparó el exterior blanco con títulos/estado negros, manteniendo tarjetas y diana grises. 166 pruebas y recorridos Chrome simulados aprobados. Rama remota feature/supabase-captcha-theme en arbatarchery, commit 432b17a7dc7eee2b863d92d9100dc1309d9942af: falta fusión manual para publicar esos cambios visuales/de diagnóstico. No confundir la confirmación de funcionamiento actual con la publicación del tema aún pendiente.

### Confirmación visible de asignación a Buddy

Aprobada por el propietario y preparada una notificación basada en la respuesta real de training_claim, sin contar sesiones locales como si ya se hubieran transferido en servidor. Guarda confirmación por cuenta/principal, evita sumar replays, muestra texto genérico cuando el conteo histórico es desconocido y oculta información al cambiar/salir de la cuenta. 171 pruebas y Chrome simulado aprobados. Rama remota feature/supabase-claim-confirmation, commit 29421ecfb05e3ca9d4099b481c197971bc967313; solo ocho archivos de la página de prueba. Pendiente fusión manual; no necesita migraciones ni Secrets nuevos.

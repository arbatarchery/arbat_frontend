# Ingreso y asignación: contrato de desarrollo

Implementación local, no desplegada. La sincronización de la web sigue desactivada. No se modificaron su registro de flechas, CSV ni JSON de Statetty.

## Autenticación

Endpoint preparado: `POST /functions/v1/training-sync`, JSON. Exige Origin permitido y `Authorization: Bearer <JWT de usuario Supabase>`, validado mediante Auth `/auth/v1/user`. Una publishable key no sustituye ese JWT. Sin cuenta Buddy se usará un usuario anónimo Supabase creado con CAPTCHA cuando haya conexión; registrar localmente nunca dependerá de ello.

Con cuenta Buddy, añadir `x-buddy-access-token`, obtenido de `Buddy.auth.getAccessToken()`. El handler lo valida con el servidor Buddy. No enviar refresh tokens ni IDs de usuario, owner_id o roles en el body. Solo el handler de servidor utiliza la clave administrativa para ejecutar las dos RPCs; anon/authenticated no pueden invocarlas directamente. No hay permisos generales de escritura a tablas.

## Enviar operaciones

```json
{
  "schema_version": 1,
  "action": "sync",
  "operations": [{
    "operation_id": "11111111-1111-4111-8111-111111111111",
    "session_id": "22222222-2222-4222-8222-222222222222",
    "entity_id": "22222222-2222-4222-8222-222222222222",
    "kind": "session.upsert",
    "base_revision": 0,
    "payload": { "local_date": "2026-11-01", "notes": "" }
  }]
}
```

UUIDs son identidades persistentes, nunca fechas o posiciones. Una sesión nueva usa base_revision 0 y recibe revisión 1. Cada operación aceptada incrementa la revisión de la sesión, incluidos cambios de sus hijos. Serializar por sesión. Los upserts reemplazan TODOS los campos enumerados de la entidad: no son parches parciales. Enviar el snapshot completo para conservar metadatos. school_id/owner_id no se aceptan; la incorporación a escuela requiere otro flujo administrativo.

| kind | entity_id | payload permitido |
|---|---|---|
| session.upsert | session_id | legacy_session_id, local_date, timezone, started_at, session_type, arrows_per_end, shooting_distance, target_size, notes |
| end.upsert | UUID estable de andanada | ordinal, ended_at, arrow_limit, session_type, shooting_distance, target_size, notes |
| arrow.upsert | UUID estable de flecha | end_id, ordinal, label, score, x, y, recorded_at |
| arrow.delete | UUID de flecha existente | objeto vacío |
| session.close | session_id | ended_at obligatorio |

Las flechas actuales usan end_id NULL. Para cerrar andanada, crearla y mover cada flecha con su MISMO UUID al nuevo end_id. Enviar todos los cambios/bajas antes de session.close: después no se aceptan mutaciones nuevas, pero sí reenvíos exactos de operaciones confirmadas. Las bajas conservan tombstone; reemplazar una flecha borrada requiere otro UUID. Preservar recorded_at/coordenadas ausentes sin inventarlos. SQL valida relaciones, puntajes, campos permitidos y restricciones.

Respuesta: `{results:[{operation_id,status,revision,replayed}]}`. Estados: accepted, conflict (revisión actual), rate_limited, quota_exceeded, rejected, retry_or_auth_required, not_attempted. Se detiene tras el primer resultado distinto de accepted. HTTP 200 no confirma todo el lote: contabilizar ACK por operación. Ante conflicto, recuperar/reconciliar la versión remota, sin sobreescribir por fecha del dispositivo.

Receipt único por principal original + operation_id y SHA-256 del JSONB canónico de TODA la operación. Cambiar el orden de claves no cambia contenido; reutilizar operation_id con otro payload se rechaza. Datos, revisión y receipt se confirman juntos. Si hay timeout después del commit, reenviar el mismo UUID y contenido. El lote no es una transacción global: operaciones anteriores pueden estar confirmadas aunque falle una posterior.

## Asignar sesiones al iniciar sesión

Body: `{"schema_version":1,"action":"claim"}`, con AMBAS credenciales vigentes en encabezados. La autorización es la verificación en vivo de las dos sesiones en esa solicitud. El handler genera un hash aleatorio como recibo; no existe un endpoint que lo acepte como futura credencial. expires_at en el registro es de auditoría, no una autorización para reclamar más tarde.

Primera entrada Buddy: vincular issuer+subject al principal Supabase actual conservando sus sesiones. Si la identidad ya existe de otro dispositivo, transferir las sesiones del principal anónimo actual al canónico. La fuente debe ser realmente anónima, sin identidad Buddy previa ni sesiones adscritas a escuela. Transferencia, vínculo y auditoría son una transacción; se conservan UUID y revisión de contenido. Los receipts permanecen bajo el principal original para reenviar operaciones anteriores sin duplicarlas.

Repetir la misma asignación devuelve accepted/replayed; asignarla a otra cuenta se rechaza. Tras vincular, escribir exige Buddy verificado que coincida con el vínculo. El JWT anónimo antiguo por sí solo tampoco puede leer sesiones vía Data API, incluido el primer dispositivo canónico. La futura lectura del historial Buddy debe usar servidor verificado antes de activar la integración. No se emite un JWT canónico ni se migra silenciosamente el login a Supabase Auth.

El futuro cliente deberá mantener colas separadas por principal/cuenta, ejecutar claim antes de reenviar pendientes bajo Buddy y crear una nueva identidad anónima para trabajo nuevo al salir/cambiar de cuenta. No reatribuir operaciones de A a B ni reutilizar un principal vinculado con otra identidad. En equipo compartido, lo anónimo aún no asignado corresponde a la primera cuenta que lo reclama. La importación local histórica con UUID sigue pendiente; estas funciones reciben lo que el futuro importador envíe.

## Límites iniciales

Body máximo 128 KiB; 32 operaciones por lote; 32 KiB por operación. Lecturas con timeout y respuestas de Auth/Buddy/RPC acotadas. 120 llamadas SQL de ingreso/asignación por minuto y principal; dispositivos vinculados comparten el presupuesto canónico para ingreso. Las asignaciones a una cuenta existente también consumen presupuesto de destino. Contadores antiguos de un principal activo se eliminan después de un día.

Sin Buddy: máximo 100 sesiones y 50.000 flechas por propietario. Con Buddy: 10.000 sesiones y 500.000 flechas. Máximo 10.000 flechas por sesión, incluidos tombstones. Transferencias no pueden superar cuotas del destino. Son límites explícitos de desarrollo, sujetos a revisión antes de producción.

Errores de validación SQL revierten también su contador. Estos límites controlan solicitudes válidas y no sustituyen límites del gateway, CAPTCHA/rate limits de creación anónima ni monitorización de costes. CORS controla navegadores, no es autenticación ni defensa antibot.

## Configuración futura, solo en servidor

Variables: SUPABASE_URL, TRAINING_PUBLIC_KEY, TRAINING_SERVER_KEY, TRAINING_ALLOWED_ORIGINS (orígenes exactos separados por comas), TRAINING_SYNC_ENABLED=true. Sin bandera/configuración el endpoint devuelve sync_disabled. El propietario configurará la clave de servidor como secreto de Edge Functions: nunca chat, archivo público ni GitHub. No hace falta compartirla con el asistente.

config.toml establece verify_jwt=false porque JWTs asimétricos se validan explícitamente con Auth dentro del handler. No omitir esa comprobación. Confirmar en Supabase de desarrollo antes de habilitar. Documentación: https://supabase.com/docs/guides/functions/auth y https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys.

## Verificación y pendientes

Pruebas locales aplican ambas migraciones en PostgreSQL embebido con roles SQL y el contrato Auth simulado. El handler usa HTTP simulado, sin tokens reales. Cubren ACK/replay, hash, conflictos, bajas/cierre, asignación primera/existente, rechazo de otra cuenta, JWT antiguo, permisos RPC y cuotas.

Antes de activar: probar Supabase Auth/Buddy reales sin pegar tokens en chat; Deno/Edge/PostgREST; concurrencia con varias conexiones PostgreSQL (PGlite no la reproduce); CAPTCHA/gateway; lectura de historial Buddy y administración auditada; cola local/importador/indicador. No se aplicaron migraciones ni se crearon usuarios remotos, ramas publicadas o funciones desplegadas.

## Buddy-only bridge and optional history

`buddy.session` accepts schema_version=1 and no identity/role/owner fields. Authorization carries the public project key and x-buddy-access-token carries the live Buddy proof; the public key alone is insufficient. The server verifies Buddy, obtains the canonical principal via a service-only RPC, bootstraps its internal Auth user if necessary and returns only status, principal_id and verified subject. Subsequent sync/claim/history requests with this credential combination resolve ownership again from the live Buddy response. Anonymous source credentials still use Auth /user and preserve their source operation receipts. All downstream SQL ownership, quotas and rate limits remain in force.

`history.list` accepts from/to local dates, optional UUID cursor and optional target_subject; pages have eight sessions. `history.detail` pins session UUID and revision and pages ends (16) or arrows (256). Both are service-only RPCs behind verified Edge identity and database scopes. A changed revision or deletion stops assembly rather than combining versions. Client merge uses persisted UUID mappings and preserves local pending edits. Page progress is cached in memory across retries, including shared rate-limit recovery, scoped to the account; full completed versions are reused only for matching revisions. A 1000-version cache bound fails explicitly. No partial remote list is silently presented as complete. Production historyEnabled remains false.

## Ordered backlog batches (migration 0005)

The client freezes up to 32 consecutive operations from one session with base_revision = confirmedRevision + index, bounded to a 120 KiB UTF-8 request body. It sends immediately without an aggregation delay and advances only a contiguous individually confirmed prefix. Retried tails retain their UUIDs and exact envelopes. The API rejects mixed-session batches and still enforces its 128 KiB request and 32 KiB per-operation limits.

Multi-operation requests use one training_apply_batch SQL RPC after one identity verification. A private shared core preserves original validation/ownership/storage quotas/replay receipts for each operation. The batch wrapper consumes one shared ingress rate-limit unit per bounded request; its private unchecked-rate core is not executable by anon, authenticated or service_role. Per-operation exception blocks retain the successful prefix, roll back a rejected operation and skip its tail. The SQL response has a result for each submitted UUID in order. Existing one-operation calls remain supported. API/SQL publication must follow applying 0005 in the development project.

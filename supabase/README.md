# Base de desarrollo de Supabase para entrenamiento

Estado: preparada y probada localmente; **no aplicada al proyecto remoto**. La aplicación mantiene la sincronización desactivada y no carga estos archivos. Se preparó el endpoint de recepción y reclamación, pero no está desplegado ni conectado al navegador.

## Contenido

- `migrations/202611010001_training_foundation.sql`: una transacción para crear 12 tablas, restricciones, índices y políticas de lectura. Incluye sesiones, andanadas, flechas, perfiles, escuelas, miembros, roles, asignaciones, identidades externas, recibos de operaciones, reclamaciones y auditoría.
- `migrations/202611010002_training_ingestion.sql`: recepción transaccional, revisiones, recibos idempotentes, límites y asignación de sesiones, con dos tablas privadas adicionales. Aplicar después de la primera migración, nunca aislada.
- `functions/training-sync/index.ts` y `functions/_shared/training-handler.mjs`: endpoint preparado con verificación explícita de Supabase Auth y Buddy. Desactivado por defecto; no obtiene credenciales del archivo público del navegador. Ver `training-protocol.md` para el contrato y límites.
- `functions/_shared/buddy-identity.mjs`: verificador de identidad de servidor sin dependencias. Consulta un endpoint HTTPS fijo de Buddy con el access token; rechaza redirecciones, respuestas no autenticadas, errores, respuestas excesivas y ausencia de ID estable. No acepta roles del navegador, no necesita refresh token y no registra credenciales. No es una Edge Function desplegable por sí sola.
- `tests/`: pruebas ejecutables sobre PostgreSQL embebido (PGlite) y respuestas simuladas de Buddy.

## Decisiones de permisos

Todos los datos de roles, identidad, reclamación y auditoría quedan en `arbat_private`. No añadir ese esquema a los esquemas expuestos por Data API. Todas las tablas tienen RLS. El rol `anon` no tiene acceso a tablas. Un usuario anónimo de Supabase tiene rol SQL `authenticated`, pero solo puede leer sus propias sesiones; la condición de usuario permanente para acceso privilegiado se comprueba en `auth.users`, no con información editable del cliente.

Usuario: sus sesiones. Entrenador: además las sesiones de alumnos con relación activa en la misma escuela. Administrador: además las sesiones explícitamente adscritas a su escuela. SuperAdmin: todas las sesiones. Una sesión personal con `school_id = NULL` no es visible por ser entrenador/administrador de otra sesión del mismo arquero. El perfil solo es legible por su dueño; no se publica directorio global ni información personal de alumnos en esta entrega. El rol Usuario no requiere una fila en role_assignments para acceder a sus datos; una asignación de roles escolares no habilita permisos globales.

Ningún cliente, incluido un SuperAdmin de la aplicación, puede escribir tablas ni concederse roles directamente. Tampoco se otorgan escrituras directas a service_role: la segunda migración concede únicamente ejecutar dos funciones específicas al servidor. Esas funciones verifican identidad vinculada, propiedad, revisiones, payload y límites dentro de la transacción. El handler debe verificar las credenciales antes de invocarlas porque service_role es un límite de confianza. Los roles de la aplicación son asignaciones administrativas protegidas. No hay cuenta SuperAdmin inicial ni escuela creada automáticamente. La administración queda pendiente de un flujo seguro.

Las flechas tienen UUID propio. Las FKs compuestas impiden vincular una flecha con una andanada de otra sesión. Las bajas conservan tombstones y permiten reutilizar la posición con otro UUID. Coordenadas ausentes se conservan como NULL, incluidos misses históricos; se rechazan NaN e infinitos, sin limitar a la diana posiciones legítimas de misses. Fechas y posiciones no identifican una sesión. El recibo por principal + operation_id y su hash son la base para una futura función idempotente; la restricción por sí sola no implementa el protocolo de sincronización ni la comparación del hash.

No modificar las tablas existentes de otros módulos. Esta migración se aplica una sola vez a un proyecto de desarrollo vacío y falla ante nombres ya existentes, en vez de modificar estructuras desconocidas. Requiere el esquema Auth de Supabase y PostgreSQL 15 o posterior. El propietario de la migración debe ser un rol administrativo controlado, nunca un usuario de la aplicación. Las funciones SECURITY DEFINER requieren ese propietario de confianza y search_path fijo.

## Pruebas reproducibles

Desde la carpeta `supabase`:

```sh
npm ci
npm test
```

Se usa la dependencia de desarrollo fijada en package-lock.json. No hacen falta credenciales, Docker ni conexión al proyecto Supabase. Las pruebas crean usuarios ficticios, aplican el SQL y ejecutan consultas con SET ROLE para comprobar aislamiento por usuario, escuela y entrenador; denegación anónima; intentos de escalación; escrituras bloqueadas; restricciones e idempotencia de recibos. El esquema Auth se simula solo en las pruebas, nunca en la migración. El verificador Buddy se prueba con fetch simulado: no se enviaron tokens reales.

Límite de validación: PGlite ejecuta PostgreSQL, pero no reproduce PostgREST, Supabase Auth ni Edge Functions completos. Antes de activar hay que repetir pruebas en Supabase de desarrollo y probar un token de Buddy real de forma segura; no pegarlo en el chat. Verificar especialmente grants, políticas, endpoint y configuración efectiva de Buddy en arbatarchery.com.

## Contrato Buddy localizado

Fuentes públicas consultadas el 2026-11-01:

- https://statetty.com/assets/buddy/modules/auth/auth-service-contract.md
- https://statetty.com/assets/buddy/modules/auth/buddy_auth.js

El contrato documenta `GET https://api.statetty.com/api/buddy/auth/session`, encabezado `Authorization: Bearer <accessToken>`, y respuesta `ok: true`, `authenticated: true`, `user.id`. El módulo público expone `Buddy.auth.getAccessToken()`. Eso permite validación servidor a servidor sin compartir el secreto de firma. La documentación no basta para afirmar que ya se probó la sesión autenticada contra el servidor real. No se encontró JWKS en los recursos inspeccionados; no se asume validación local de firma.

La identidad verificada devuelve solo issuer fijo + subject estable. La segunda migración crea/vincula el mapping al principal Supabase verificado por Auth, transfiere las sesiones anónimas y registra la asignación en una transacción. Los recibos permanecen asociados al principal original para que un reenvío siga siendo idempotente tras la asignación. Un email coincidente o un owner_id enviado por el navegador nunca autoriza esa operación. Tras vincular Buddy, el JWT anónimo por sí solo no puede consultar ni modificar las sesiones: la futura lectura del historial Buddy deberá pasar por un endpoint con la misma verificación.

## Próxima entrega

Implementar almacenamiento/cola local e importación con UUID, lectura del historial con Buddy verificado, administración auditada e indicador. No habilitar login anónimo en la web hasta configurar CAPTCHA y verificar los límites y las pruebas en Supabase de desarrollo. No enviar el access token Buddy a tablas, telemetría ni logs. La URL y publishable key públicas existentes no autorizan migraciones ni sustituyen una sesión verificada.

La carpeta `supabase/` está excluida del sitio Jekyll para no publicar pruebas ni recursos del servidor junto a la web. No se ha publicado una rama remota, abierto un PR, modificado main ni desplegado cambios.

## Cola local implementada en la rama

El guardado, importador y motor local ya están conectados en los archivos de entrenamiento de esta rama. Se mantienen desactivados los envíos y no se configura todavía un adaptador real de sesión anónima. Ver `../docs/supabase-local-sync.md` para el contrato local, recuperación, particiones por cuenta y pruebas de compatibilidad. `fake-indexeddb` es una dependencia solo de pruebas; la web usa la API IndexedDB nativa.

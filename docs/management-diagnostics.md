# Diagnóstico con Supabase Management API

## Activación

1. En la cuenta de Supabase, abrir Access Tokens: https://supabase.com/dashboard/account/tokens . Crear un token de lectura limitado a la organización/proyecto de ARBAT, con expiración y estos permisos documentados:
   - `project_admin_read`: estado del proyecto y salud de servicios.
   - `infra_disk_config_read`: disco asignado, utilización y configuración de autoampliación.
   - `database_readonly_config_read`: modo de solo lectura.
   - `organization_admin_read`: nombre del plan de la organización.
   No habilitar permisos de escritura, SQL ni secretos. Si la interfaz no permite limitar estos permisos, no elegir acceso amplio automáticamente: revisar la opción disponible antes de continuar.
2. En Supabase → Edge Functions → Secrets, guardar ese valor como `TRAINING_MANAGEMENT_TOKEN`. No enviarlo por chat, no ponerlo en archivos ni configuración pública. La clave de servicio de la base no sustituye este token.
3. El proyecto se deduce de `SUPABASE_URL`. Solo si se utiliza un dominio personalizado, configurar también `TRAINING_MANAGEMENT_PROJECT_REF` con el identificador público del proyecto (`qbtdwlcpqcsolubhhkfa`). El token y el identificador no se reciben del navegador.
4. Ejecutar `supabase/setup/actualizar-diagnostico-administrativo.sql` en SQL Editor. Requiere las migraciones 001–009. Incluye el reemplazo del aviso anterior (010); no hace falta ejecutar `actualizar-aviso-capacidad.sql` por separado. No modifica ni elimina entrenamientos.
5. Reemplazar el código completo de la Edge Function `training-sync` por `supabase/setup/training-sync-dashboard.ts` y desplegar conservando los secretos, orígenes permitidos y configuración JWT actual.
6. Crear y fusionar el PR de la rama del fork hacia `asosab/arbat_frontend:main`. Este PR incluye también el aviso de capacidad para arqueros del PR anterior, si todavía no se fusionó: usar esta versión actualizada.

## Qué se consulta

Todas las llamadas administrativas son GET a rutas fijas de `https://api.supabase.com/v1`. No se siguen redirecciones ni se aceptan URLs/rutas/tokens del navegador. Se verifica primero la identidad y el rol mediante el RPC privado existente. Solo Administrador/SuperAdmin reciben el diagnóstico completo. El contexto habitual del arquero obtiene únicamente un booleano de capacidad, calculado en el servidor.

- `/projects/{ref}`: ciclo de vida y organización del proyecto.
- `/projects/{ref}/health?services=auth,db,rest,storage,realtime&timeout_ms=1500`: salud de los cinco servicios. Se utiliza `status`, no el campo obsoleto `healthy`.
- `/projects/{ref}/config/disk`: tamaño asignado informado por Supabase.
- `/projects/{ref}/config/disk/util`: tamaño del sistema de archivos, ocupado, disponible y fecha de medición. El porcentaje utiliza los bytes ocupados y totales de la misma respuesta, sin mezclar unidades ni la cuota de facturación.
- `/projects/{ref}/readonly`: restricción de escrituras.
- `/projects/{ref}/config/disk/autoscale`: política de crecimiento y máximo configurado, si existe. No se interpreta como espacio libre actual.
- `/organizations/{slug}`: nombre del plan, cuando se proporciona. La organización solo se toma de la respuesta oficial del proyecto y no se expone al cliente.

La capacidad se vuelve a consultar tras un máximo de cinco minutos de caché por instancia de la función; llamadas simultáneas comparten las consultas. Los fallos se conservan 30 segundos para evitar reintentos intensivos. Cada petición tiene límite de tiempo y tamaño de respuesta. Los campos no reconocidos y las respuestas inválidas quedan sin comprobar. Los errores de un endpoint no anulan los diagnósticos de los otros. El panel sigue cerrado inicialmente y conserva el criterio de una hora para advertencias por antigüedad. No se añade un sondeo periódico.

## Límites y consumo mensual

No se usa un límite fijo de Free ni se calcula una cuota a partir del nombre del plan. Las migraciones retiran la referencia fija de 500 MB del diagnóstico y del aviso para arqueros. El tamaño de Postgres se sigue mostrando como información, con cuota facturada sin confirmar. El nombre del plan, la capacidad del disco y el porcentaje de ocupación se actualizan con la API.

La especificación pública de Management API consultada el 2026-11-05 no publica los consumos facturados por ciclo ni sus cuotas de transferencia/ejecuciones. `entitlements` contiene prestaciones (tamaños de función, límites Realtime, etc.), pero no esas cuotas ni la cuota de tamaño facturado de Postgres. Los endpoints `usage.api-counts` no equivalen al consumo facturado de Edge Functions o transferencia. No se usan endpoints internos del Dashboard ni se fabrican porcentajes: esos campos continúan sin comprobar y enlazan a Supabase Usage.

El aviso a los arqueros solo aparece con una medición de disco válida de hasta una hora de antigüedad y ocupación >=95 %. La API solo devuelve el booleano al arquero; nunca el token, organización, métricas ni diagnósticos. No se envían mensajes al encargado automáticamente.

## Verificación y límites de la entrega

Pruebas con respuestas simuladas de la especificación pública: cambio de capacidad tras ampliación, umbrales 80/95, datos antiguos o malformados, falta de credencial, HTTP 401/403/429/500, caché, concurrencia, control de acceso y ausencia de secretos en respuestas. Sin credencial configurada no se puede verificar todavía la respuesta real de este proyecto; el panel lo indicará expresamente.

Fuentes:
- https://api.supabase.com/api/v1-json
- https://supabase.com/docs/reference/api/v1-get-database-disk
- https://supabase.com/docs/reference/api/v1-get-disk-utilization
- https://supabase.com/docs/reference/api/v1-get-services-health
- https://supabase.com/docs/reference/api/v1-get-readonly-mode-status
- https://supabase.com/docs/reference/api/v1-get-organization

# Preparación inicial en el editor de Supabase

Para el proyecto de DESARROLLO `qbtdwlcpqcsolubhhkfa`, con la configuración pública ya recibida. El propietario confirmó que configuró CAPTCHA/Turnstile directamente en Supabase. Esa configuración no se ha verificado desde el código.

1. Abrir el proyecto de desarrollo en el dashboard de Supabase.
2. Abrir SQL Editor y crear una consulta nueva.
3. Copiar TODO el archivo `preparar-desarrollo.sql`, desde sus comentarios iniciales hasta la consulta final, y pegarlo en el editor.
4. Ejecutar con Run.
5. Comprobar que la última tabla muestra: tablas_entrenamiento = 14, tablas_con_rls = 14 y estado = estructura_preparada. Compartir únicamente ese resultado o el texto de un error, sin credenciales.

El archivo crea la estructura de entrenamiento, sus restricciones y las funciones SQL de ingreso/asignación. No inserta sesiones ni usuarios, no despliega Edge Functions ni activa la web. No cambia los datos locales/CSV/JSON de Statetty. Todo el DDL queda dentro de UNA transacción. Si una verificación falla, se revierte la instalación completa. Un guard inicial impide reemplazar objetos existentes. Si ya se aplicaron las migraciones individuales o hay un error de objetos existentes, detenerse y revisar; no borrar tablas para repetir.

`verificar-desarrollo.sql` es una consulta independiente de solo lectura, útil para comprobar el resultado posteriormente. No sustituye pruebas de RLS con usuarios reales; el SQL Editor actúa con permisos administrativos.

El instalador es generado por `npm run build:database` desde las cinco migraciones existentes y la consulta de verificación. Incluye hashes SHA-256 de las fuentes y no se edita a mano. No ejecutar a la vez este instalador y las mismas migraciones mediante CLI. Para una futura gestión de migraciones con CLI se debe registrar/verificar el estado aplicado por el editor antes de un db push; este archivo no escribe el historial interno de Supabase CLI.

Estado: el propietario ejecutó el instalador en Supabase y compartió una captura con 14 tablas, 14 con RLS y estado estructura_preparada. Esto confirma el resultado de la consulta, no una prueba remota de todas las políticas con usuarios reales. Después de la instalación aún falta desplegar/configurar la función Edge de desarrollo, completar lectura remota/administración/recuperación de conflictos y hacer pruebas reales antes de publicar o activar para arqueros.

## Función de desarrollo desde el Dashboard

`training-sync-dashboard.ts` es un archivo autocontenido generado desde el entrypoint y los módulos de servidor. No tiene imports externos ni secretos. Se puede pegar completo como index.ts en Edge Functions, sin crear carpetas auxiliares. Regenerar con `npm run build:dashboard-function`; no editar el archivo generado. Contiene JavaScript válido con cabecera ts-nocheck para el editor index.ts; las fuentes originales y las pruebas siguen siendo revisables por separado.

1. Dentro de este mismo proyecto de desarrollo, abrir Edge Functions.
2. Seleccionar Deploy a new function y Via Editor.
3. Usar el nombre EXACTO training-sync. Reemplazar todo el código de la plantilla index.ts por el contenido completo de training-sync-dashboard.ts.
4. Pulsar Deploy function. El handler permanece desactivado por defecto: no configurar todavía TRAINING_SYNC_ENABLED=true.
5. En los detalles de esta función, desactivar la comprobación JWT antigua del gateway (Verify JWT / Verify JWT with legacy secret) si está activa. La función valida explícitamente la sesión con Supabase Auth antes de usar SQL; una publishable key sola no es una sesión.

No pegar claves secretas en el código. Sus variables de servidor se configurarán directamente en Secrets del proyecto en el siguiente paso. Sin configuración, una petición que llegue al handler responde 503 con sync_disabled; eso es intencional en esta etapa. No se activa ni despliega la web de entrenamiento al crear esta función.

Las pruebas locales del archivo generado comprueban que permanece desactivado, exige token de usuario si se configura y rechaza un token inválido antes de SQL/Buddy. Su ejecución Deno/Edge real se verificará después del despliegue del propietario. No se ha desplegado automáticamente.

## Actualización del proyecto ya instalado: Buddy sin CAPTCHA

No volver a ejecutar el instalador inicial en este proyecto. Para el acceso Buddy sin desafío adicional aplicar solamente `../migrations/202611010004_buddy_bridge.sql`, que añade una función de resolución restringida al servidor y no crea tablas ni modifica entrenamientos. Después reemplazar el contenido de la función Edge `training-sync` por el archivo generado `training-sync-dashboard.ts`. Conservar Secrets y gateway JWT antiguo desactivado; cada petición sigue verificando una credencial viva (Supabase para anónimos o Buddy para la ruta nueva). No enviar secretos por el chat.

El historial remoto preparado en esta rama requiere además `../migrations/202611010003_training_history.sql`. Su activación es independiente: `historyEnabled` sigue false y la vista previa solo lo habilita con `--enable-history`. La migración 0003 añade lecturas paginadas con autorización del servidor, sin nuevas tablas. En una instalación nueva el instalador generado incluye las migraciones disponibles; en una existente aplicar solo las que faltan, en orden.

Nada de esta actualización se ha aplicado automáticamente al Supabase remoto ni al sitio publicado. Revisar el código y realizar las pruebas de desarrollo antes de habilitar producción.

## Actualización: recuperación e importación por lotes

En el proyecto ya instalado ejecutar solo `../migrations/202611010005_training_batches.sql` en SQL Editor y después reemplazar index.ts de training-sync por el archivo generado `training-sync-dashboard.ts`, conservando los Secrets. No volver a ejecutar el instalador inicial. No se crean tablas ni se borran entrenamientos. Esta actualización agrupa hasta 32 operaciones de una sesión en una sola consulta al servidor, conserva ACK/UUID por operación y cuenta el límite de ingreso por petición acotada. Las validaciones y cuotas por operación siguen vigentes. El instalador para proyectos nuevos incluye ahora cinco migraciones. Detalles y prueba manual en docs/supabase-batches.md.


## Historial y supervisión de academia (0006)

Para el proyecto ya instalado usar `actualizar-historial-entrenadores.sql`, no el instalador inicial. El actualizador instala 0003 si falta y añade 0006 en una transacción. Se puede repetir; conserva entrenamientos y la cantidad de tablas protegidas. Requiere que la sincronización por lotes ya esté instalada.

Después reemplazar íntegramente `index.ts` de la función existente `training-sync` por `training-sync-dashboard.ts` y desplegar. Conservar Secrets y el gateway JWT antiguo desactivado. La función obtiene los nombres y correos directamente de la sesión Buddy verificada; los roles se consultan en Supabase, sin aceptar roles ni correos del navegador. Registrar el perfil después de una asignación es opcional y nunca invalida un recibo ya confirmado.

El panel de Historial usa `history.context` y `history.coach`. Muestra las flechas según su fecha de registro, las últimas sesiones y los totales diarios de arqueros autorizados. El resumen excluye al propio entrenador, cuyo historial sigue siendo personal. La fecha/hora de la tabla usa America/La_Paz. Para entrenador con `coach_scope=academy`, incluye miembros actuales y futuros de su academia; con `assigned`, solo relaciones activas. Administradores ven su academia y SuperAdmin todas. No se habilita un selector general de usuarios de Buddy cuando se usa la autorización de Supabase.

La configuración inicial de cuentas se prepara en `output/supabase-private/configurar-roles.sql`, excluido de Git. No copiar correos personales al repositorio público. Solo se asignan permisos a identidades Buddy verificadas; si falta una cuenta se informa como pendiente y se puede repetir después de su primer acceso. Los tres usuarios solicitados tienen también rol coach con alcance academy. No existe promoción desde el navegador ni asignación automática basada en un correo enviado por el cliente.

La configuración pública sigue desactivada en esta rama hasta preparar y aprobar la publicación en las rutas normales. Las pruebas automatizadas del panel usan datos simulados y no envían entrenamientos al servidor.

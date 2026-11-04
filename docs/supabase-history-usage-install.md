# Historial ampliado y ubicaciones aproximadas

La integración queda preparada en esta rama. La configuración propuesta contiene `usageEnabled: true`; la web pública empezará a recopilar cuando se integre y publique esta rama. No aprobar el sitio antes de completar la preparación del servidor.

## Preparar Supabase y el Worker

1. En la base de datos que ya recibió las migraciones 001–006, ejecutar una vez `supabase/migrations/202611030007_training_usage.sql` (también disponible como `supabase/setup/actualizar-uso-y-ciudad.sql`). Crea el registro privado de aperturas/ciudades y los RPC restringidos al servidor. No modifica sesiones, flechas, CSV ni JSON de Statetty.
2. Crear un secreto aleatorio de al menos 32 caracteres. Guardar exactamente el mismo valor en Cloudflare Workers → Settings → Variables and Secrets como `TRAINING_LOCATION_SIGNING_SECRET` (Secret) y en Supabase → Edge Functions → Secrets con el mismo nombre. No enviarlo por chat ni añadirlo al repositorio.
3. Reemplazar el Worker `arbat-city` con el contenido completo de `supabase/setup/approximate-city-worker.mjs` y guardar/desplegarlo. La URL pública permanece `https://arbat-city.arbat-archery.workers.dev/`.
4. Reemplazar el código de `training-sync` en el panel Supabase con el contenido completo de `supabase/setup/training-sync-dashboard.ts`. El archivo es generado desde las fuentes revisables y ya incluye la validación del secreto firmado. Desplegar la función y conservar desactivada la opción de verificación JWT de gateway usada actualmente.
5. Si ya ejecutaste la primera versión de la migración 007 antes de las pruebas finales, ejecutar también `supabase/setup/ajustar-resumen-uso.sql`. Actualiza solo la función del resumen: retira identificadores internos de las respuestas y enumera las ciudades de los avisos. No repetir la creación de tablas. La configuración pública y su archivo generado ya están preparados; no necesitan edición manual.
6. Revisar el cambio en GitHub e integrar el sitio solo después de completar los pasos anteriores. Las aperturas empiezan a registrarse cuando la página nueva esté publicada; no se rellenan visitas anteriores.

## Comportamiento y límites

El navegador conserva eventos pendientes en IndexedDB separado del registro de entrenamiento. Cada apertura de Historial tiene un identificador estable para reintentos. Al finalizar una andanada se crea como máximo un evento por su UUID. Los eventos pendientes se transmiten en segundo plano y no bloquean la captura de flechas ni cambian el indicador de sincronización del entrenamiento. Una ubicación recuperada tarde se identifica como observada al sincronizar.

El Worker toma ciudad, región y país de Cloudflare para la solicitud que recibe. Firma el resultado con HMAC para que la Edge Function compruebe que no viene de valores inventados por el navegador. No guarda IP completa, GPS, cookies, dispositivo, user agent ni credenciales. El servidor aplica límites propios para aperturas. La tabla solo se lee desde RPC de servicio con identidad Buddy verificada y rol Administrador/SuperAdmin. El resumen y los avisos se limitan a 50 ciudades, 100 cuentas/navegadores y 50 avisos; los totales cuentan todo el período. VPN y redes móviles pueden hacer variar la ciudad.

Los cambios de ciudad entre andanadas se muestran como avisos informativos, sin bloquear registros. Las observaciones tardías no participan en esos avisos. Entrenadores sin rol administrativo no reciben estadísticas de aperturas ni ubicaciones.

La nueva vista invita a iniciar sesión en escritorio y móvil. Sin cuenta presenta siete días de resumen; iniciar sesión da acceso a la tabla con sesiones, notas, andanadas y flechas, además de filtros por tipo, distancia y diana, distribución de puntajes y comparación con el período anterior. En móvil estos detalles se despliegan. El selector de período en la vista anónima queda fijado a siete días. El historial, CSV y copias locales no se borran ni se alteran.

## Validación antes de publicar

196 pruebas automáticas aprobadas: almacenamiento original, sincronización, permisos, SQL, firma y verificación de ubicaciones, idempotencia, promoción de la apertura anónima al iniciar sesión y cola sin conexión. Las pruebas de navegador con datos ficticios verificaron carga progresiva, consultas concurrentes, revocación de permisos, panel de entrenadores, vista móvil/escritorio, filtros y escape de notas. El Worker público respondió con una prueba firmada; no se insertaron eventos ficticios en la base real.

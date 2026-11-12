# Activar las estadísticas de /links

1. Ejecutar una vez la migración [202611120015_links_analytics.sql](../supabase/migrations/202611120015_links_analytics.sql) en el editor SQL del mismo proyecto Supabase que usa la web.
2. Desplegar la Edge Function `training-sync` de esta rama. Si usas el editor web de Supabase, reemplazar su código con [training-sync-dashboard.ts](../supabase/setup/training-sync-dashboard.ts) y conservar la configuración actual de la función.
3. Integrar el pull request en `main` para que GitHub Pages publique la web.
4. Abrir `/links`, tocar un botón y recargar el Historial con una cuenta de Administración. En **Uso y ciudades · Administración**, el apartado **Página de enlaces (/links)** muestra los conteos del período seleccionado, con fechas de Bolivia.

Cada carga, recarga o vuelta a la página cuenta como una apertura. Los clics incluyen el logo que lleva a Inicio. Se cuentan activaciones que llegan al servidor y el registro empieza con la activación. Los eventos guardan el tipo de acción, un ID aleatorio por evento y la hora de recepción. El envío se hace en segundo plano y puede perderse si no hay conexión o si el navegador lo bloquea.

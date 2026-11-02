# Prueba manual local contra Supabase

El propietario confirmó habilitar usuarios anónimos y TRAINING_SYNC_ENABLED=true en el proyecto configurado. Una petición sin sesión al endpoint real devolvió HTTP 401 y supabase_session_required, con el origen http://localhost:8000. No contenía flechas ni creó usuarios. Esto comprueba el rechazo sin sesión, no que una escritura autenticada ya funcione.

## Vista previa

Desde supabase, ejecutar `npm run preview:development -- --enable-cloud`. Abrir http://localhost:8000. El servidor solo escucha en loopback y acepta el host localhost:8000. Un puerto ya ocupado provoca error, sin sustituir procesos existentes. Sin --enable-cloud, la vista previa no envía datos. El código público versionado continúa con enabled=false; únicamente el HTML servido para esta prueba lo sobrescribe en memoria.

La portada incluye la aplicación dentro de un marco móvil de 390px para poder tocar la barra desde escritorio. Las páginas de entrenamiento e historial usan contenido/assets de la rama, sin el layout/nav/Buddy de producción. Esta prueba es solo SIN cuenta Buddy. No prueba todavía asignación de datos al iniciar sesión, directorios de roles ni lectura remota del historial.

Se usa el prefijo localStorage arbat-supabase-preview-v1: y otra base IndexedDB, arbat-training-sync-preview-v1. La adaptación de almacenamiento mantiene los nombres/formatos lógicos para la aplicación y filtra las claves al importar: no se lee ni borra el entrenamiento del origen fuera del prefijo. Sin prefijo configurado, se usa el almacenamiento habitual. Un rechazo del getter localStorage se maneja mediante los mismos errores locales, sin impedir el fallback a IndexedDB.

La primera sesión se crea vacía con notas PRUEBA LOCAL SUPABASE — datos ficticios. Las flechas las marca el propietario. No se introducen entrenamientos reales ni se importan los del sitio publicado, que además tiene otro origen. El servidor de vista previa permite solo las dos páginas y sus assets de cliente necesarios; no expone el repositorio completo, SQL, archivos de configuración administrativa ni fuentes de proyecto. No incluye claves de servidor.

## Pasos manuales

1. Marcar una flecha ficticia en la diana.
2. Tocar la barra amarilla y pulsar Confirmar y continuar. Completar Turnstile en el navegador. No se automatiza ni se elude el desafío.
3. Esperar a que la barra pase a verde y el panel muestre cero pendientes y confirmación local/remota.
4. Marcar otra flecha ficticia y comprobar que vuelve a cero pendientes. No hace falta cerrar la andanada: la prueba es por flecha.
5. Compartir el color, pendientes y cualquier mensaje de error, sin tokens ni claves. Si persiste amarillo/rojo, conservar la página y los registros pendientes para investigar; no borrar su almacenamiento.

Solo después de completar Turnstile se puede crear un usuario Supabase anónimo real. Al obtener credenciales, las operaciones confirmadas se guardan en el proyecto de pruebas. Esta es una prueba manual contra servicios reales, distinta de las pruebas automatizadas interceptadas. No se eliminarán automáticamente usuarios/sesiones creados por la prueba; una limpieza deberá identificar específicamente sus UUID/notas y tener autorización.

## Comprobaciones realizadas antes de abrir la prueba al propietario

- 105 pruebas locales aprobadas tras añadir almacenamiento con prefijo y el generador de vista previa.
- Chrome con perfil aislado abrió la vista previa, conservó un registro sin prefijo, marcó una flecha ficticia en el prefijo y llegó a captcha_required con dos operaciones pendientes.
- Esa comprobación bloqueó y verificó ausencia de peticiones externas: no creó un usuario ni resolvió Turnstile, y no envió la flecha.
- El servidor local respondió HTTP 200. El endpoint de Supabase rechazó la consulta sin sesión con 401.

La configuración pública de producción permanece desactivada y la rama no se ha publicado. Siguen pendientes el resultado real después de CAPTCHA, pruebas con Buddy, lectura remota, administración y recuperación asistida de conflictos.

## Primera confirmación real y prueba de desconexión

El propietario informó que la barra volvió a verde tras marcar la segunda flecha. Esto confirma el resultado del cliente de recepción de ACK para ese recorrido; todavía no se había contrastado la lista remota por Data API ni simulado pérdida de red.

Se añadieron controles exclusivos de la vista previa:

- **Simular sin conexión / Restaurar conexión**: interrumpe únicamente fetch al origen Supabase de esta vista. No cambia Wi-Fi, navegador global ni otros servicios. Al restaurar emite online para despertar la cola. La pausa no persiste tras recargar la página. No inyecta estados verdes ni ACKs.
- **Comprobar respaldo**: cuando no hay pendientes, usa la sesión anónima vigente y la clave pública para hacer dos GET a training_sessions/training_arrows. Compara UUID de sesión, revisión y conjunto exacto de UUID de flechas activas con IndexedDB, incluyendo detección de flechas remotas extra. Solo devuelve cantidad/revisión a la interfaz: no muestra tokens ni consulta Secrets o tablas privadas. Rechaza comprobaciones con pendientes, pausa, cuenta Buddy o cambios locales durante la lectura. No escribe datos remotos.

Para la prueba manual: recargar localhost:8000; pulsar Simular sin conexión; marcar otra flecha ficticia y comprobar amarillo/pendientes; pulsar Restaurar conexión; esperar verde/cero pendientes; pulsar Comprobar respaldo. Compartir el texto del resultado. Los datos y credenciales de prueba anteriores se conservan al actualizar el servidor.

Pruebas locales adicionales: pausa limitada al origen Supabase, verificación por GET de revisión/IDs exactos, rechazo de discrepancias y cambios concurrentes. Chrome verificó los botones de pausa/restauración sin peticiones externas y sin resolver desafíos. El resultado real del nuevo botón y la recuperación manual quedan pendientes del propietario. Los archivos de producción no incorporan estos controles, que residen bajo supabase/ y se sirven mediante una ruta local explícita.

## Resultado reportado y siguiente revisión

El propietario confirmó «funciona bien» tras el recorrido de desconexión/restauración y comprobación de respaldo. Se conserva como resultado manual reportado, separado de las pruebas con servicios simulados.

La rama prepara ahora lectura remota opcional e ingreso Buddy verificado sin CAPTCHA. Para probar el acceso Buddy nuevo hace falta aplicar 0004 y actualizar la función Edge de desarrollo según supabase/setup/README.md; no se ha realizado ese despliegue. La lectura histórica requiere 0003 y el parámetro explícito `--enable-history`, que permanece apagado. Sin cuenta, al terminar la primera andanada se ofrece automáticamente el CAPTCHA pendiente si hay conexión, manteniendo el reintento desde la barra.

## Recuperación por lotes confirmada y acceso Buddy preparado

El propietario informó que la recuperación y comprobación de respaldo por lotes funcionan correctamente. Se añadió Probar con Buddy dentro del recuadro local, con los módulos oficiales cargados bajo demanda y sin envío de eventos ficticios a Statetty. Las pruebas locales suman 161 aprobadas y Chrome comprobó el formulario con servicios simulados. El acceso Buddy real queda pendiente de autorizar http://localhost:8000 en su API: la consulta pública no devuelve permiso de origen para localhost, mientras sí lo hace para la web publicada. Véase docs/supabase-buddy-preview.md. No se solicitaron correos reales automáticamente ni se modificó producción.

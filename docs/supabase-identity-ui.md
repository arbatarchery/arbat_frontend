# Sesiones de usuario y barra móvil

Estado: código conectado en la rama local, sin aplicar cambios a Supabase ni publicar. enabled permanece false tanto en el JSON público como en el JS generado. El navegador no hace peticiones a Supabase o Cloudflare en este estado.

## Sesiones

`sync-identity.js` usa @supabase/auth-js 2.118.0, fijado en package-lock y distribuido como módulo local de 104 KB aproximadamente, con sus licencias. No hay dependencia de un CDN para el SDK. Se importa solo cuando la identidad está habilitada y hace falta. El SDK gestiona la sesión y la renovación; no se implementa un protocolo propio de refresh. detectSessionInUrl=false mantiene el flujo de enlaces de Buddy independiente.

Las credenciales de usuario viven en meta de IndexedDB, bajo claves separadas por proyecto y bucket aleatorio. Nunca entran al JSON legado, CSV, telemetría, estado público del panel ni logs. No se usan claves de servidor en el navegador. Es almacenamiento de cliente, accesible al código del mismo origen, como cualquier sesión web; requiere mantener la seguridad del sitio frente a XSS. No se presenta como una caja fuerte frente al código del propio sitio.

Primera sesión anónima: se exige un token Turnstile antes de signInAnonymously. Al entrar a Buddy se conserva la credencial anónima original y se envía la doble prueba de claim al servidor. Al salir o cambiar de cuenta se elige otra partición para trabajo nuevo; al volver se conservan las credenciales anteriores para la cola de esa cuenta. No se sustituye silenciosamente un principal con credenciales perdidas. El navegador usa el ID de Buddy solo para separar colas; el servidor vuelve a verificarlo.

Se revalida la cuenta después de obtener/renovar la sesión y entre envíos. Los buckets de una misma cuenta con colas antiguas conservan sus principales. La obtención inicial de una sesión se coordina mediante Web Locks o lease adicional de IndexedDB para evitar dos altas simultáneas. Se usa el modo actual de coordinación de refresh del SDK, sin su opción lock deprecada. No se revocan tokens de una cuenta al salir de Buddy porque sus receipts pendientes requieren ese principal; quedan inactivos y la función remota exige Buddy verificado para acceder a las sesiones ya vinculadas.

`sync-captcha.js` carga el script oficial de Turnstile únicamente al solicitar confirmación. El token es temporal, se consume una sola vez y no se persiste. El widget no se abre automáticamente mientras se marcan flechas: el estado pendiente permite abrirlo desde Reintentar/Confirmar en el panel. Sin site key configurada, el panel explica que falta configuración y no intenta un alta sin protección. Supabase debe validar CAPTCHA con la clave secreta configurada por el propietario en su dashboard; el widget de cliente por sí solo no protege el endpoint público de Auth.

## Barra y panel

En anchos hasta 859 px: 5 px de alto visibles, 30vw de ancho, centrada, fuera de la tarjeta de diana y tocando su borde inferior exterior. Área táctil de 44 px dentro del espacio reservado entre tarjeta y controles. No intercepta gestos del SVG ni tapa botones. En escritorio se oculta y la distribución conserva sus medidas.

El panel nativo dialog contiene pendientes, confirmación local, última confirmación, cuenta/anónimo y explicación de los cinco colores. Escape/cierre devuelve el foco al botón; el estado también se expresa en texto. Reintentar conserva los IDs y no elimina conflictos. Los colores siguen la propuesta técnica registrada anteriormente:

- Verde: únicamente con guardado local confirmado, cola vacía y ACK real registrado.
- Amarillo: cambios pendientes, offline o sesión/comprobación por confirmar.
- Rojo: error, conflicto bloqueado o fallo local que requiere revisión.
- Gris: respaldo desactivado o ausencia de confirmaciones.
- Celeste: envío/asignación/importación activa. Con el respaldo desactivado la barra se mantiene gris salvo error local.

Las capturas de output/supabase-sync son demostraciones con un estado verde inyectado; NO prueban una confirmación del proyecto real. Los outputs no se versionan ni se incluyen en Jekyll.

## Construcción y pruebas

Desde supabase: `npm ci`, `npm run build:browser`, `npm test`. El build genera el SDK/licencias y sync-config.js a partir de supabase.public.json. No modificar el bundle a mano ni añadir secretos a ese JSON. Cambiar configuración requiere regenerar el JS y revisar los flags antes de desplegar.

`npm run test:browser` usa Chrome local (CHROME_PATH permite cambiar su ruta) y un servidor solo en 127.0.0.1. Renderiza el contenido y assets reales de entrenamiento en una envoltura mínima, sin cargar marketing/nav de producción. Comprueba 320/390/859/1024 px, geometría de barra, área táctil sin solapamiento, cinco leyendas, cierre Escape/foco y ausencia de peticiones externas desactivado. También ejecuta el SDK real con respuestas Auth/API interceptadas: alta anónima, ACK por flecha y recarga sin crear otra cuenta. No contacta el proyecto Supabase ni resuelve desafíos Turnstile reales.

Las pruebas de Node añaden renovación de una sesión expirada con el SDK real y servidor simulado, cuentas y credenciales separadas, ausencia de signup sin CAPTCHA, desafío cancelado/token de un solo uso y condiciones estrictas para mostrar verde. No sustituyen pruebas de extremo a extremo contra Supabase/Buddy reales ni Safari/iOS.

## Preparación del entorno real de desarrollo

Estas acciones no se realizaron automáticamente:

1. Crear un widget Cloudflare Turnstile para los dominios del entorno de pruebas. Solo se comparte su SITE KEY pública. Su secret key se configura directamente en Supabase, nunca en chat ni GitHub.
2. En Supabase de desarrollo, configurar la protección CAPTCHA de Auth con Turnstile, y permitir Anonymous Sign-Ins. Revisar límites de creación anónima. Activar ambos de forma conjunta antes de probar altas.
3. Revisar/aplicar las dos migraciones ya preparadas y desplegar training-sync en desarrollo. Las variables TRAINING_SERVER_KEY y la bandera del servidor se configuran de forma segura por el propietario, sin enviarlas al asistente.
4. Configurar el origen exacto de pruebas y la SITE KEY pública en la configuración del cliente. Mantener producción desactivada. Primero hacer pruebas de ingreso con pocos datos ficticios; la lectura de historial Buddy y la administración todavía están pendientes.

No habilitar para los arqueros ni fusionar/publicar esta rama hasta completar lectura remota, administración/recuperación de conflictos, pruebas reales y aprobación del propietario.

La SITE KEY pública proporcionada por el propietario ya se incorporó a supabase.public.json y al JS generado, con enabled=false. El propietario confirmó haber configurado la clave secreta directamente en Supabase y activado CAPTCHA. No se verificaron aún validez, dominios permitidos ni comportamiento real del servicio. No se enviaron desafíos ni se crearon usuarios remotos para comprobarlo.

## Cambio: Buddy verificado y solicitud automática (1 noviembre 2026)

Una cuenta Buddy nueva en el navegador usa `buddy.session` con su token de acceso. El servidor verifica la sesión en el endpoint fijo de Statetty en cada petición, resuelve el perfil canónico mediante `training_buddy_lookup` y no entrega tokens de Supabase al navegador. La clave pública por sí sola nunca autoriza el acceso. Si no existe perfil, el servidor crea mediante Auth Admin un usuario interno con UUID derivado de issuer/subject, correo aleatorio bajo buddy.arbat.invalid, contraseña aleatoria y marcador en app_metadata; no envía correo ni usa datos de contacto de Buddy. Concurrencia usa el mismo UUID y valida el marcador antes de vincular. Una asignación anónima simultánea conserva el propietario canónico ya establecido.

Las colas anónimas ya enviadas mantienen su JWT y principal de origen para preservar recibos idempotentes. Al iniciar Buddy se asignan con ambas pruebas verificadas. Los siguientes dispositivos Buddy usan el perfil canónico sin crear otra sesión anónima ni invocar Turnstile. Un fallo de Buddy conserva la cola; no deriva a CAPTCHA ni confía en roles recibidos del cliente.

Sin cuenta, tras guardar la primera andanada terminada se consulta si realmente falta CAPTCHA. Si hay una sesión válida no se muestra. Sin conexión se conserva la solicitud en IndexedDB y se reevalúa al recibir online. El diálogo automático aparece una sola vez por almacenamiento del navegador; cerrarlo conserva las flechas y deja disponible el reintento manual en la barra. No se repite por flecha/andanada ni se resuelven desafíos automáticamente. Turnstile decide si necesita interacción. La finalización parcial mediante Terminar andanada también cuenta. La disponibilidad de red del navegador es orientativa: un error real de conexión mantiene los datos pendientes.

La prueba automatizada sustituye Turnstile y servicios de red por simulaciones. No comprueba una sesión Buddy real ni resuelve un desafío real. Los flags públicos de producción siguen desactivados.

Verificación final de esta revisión: 141 pruebas locales aprobadas, incluidas permisos SQL del nuevo resolver, separación de cuentas, asignación anónima, paginación histórica, carreras de envío/recarga, solicitud pendiente sin conexión y reintento tras fallo de Turnstile. Chrome validó 320/390/859/1024 px y flujos con servicios simulados: aviso automático al terminar andanada sin tocar la barra, acceso Buddy con cero CAPTCHA/signup/SDK anónimo y reutilización al recargar. Los fixtures de CSV/telemetría Statetty siguen iguales. El acceso nuevo con Buddy real queda pendiente de actualizar la función de desarrollo; no se publicó ni aplicó SQL remoto.

## Indicador desktop bajo los controles

Se añadió una fila fuera del borde inferior del panel de controles, en la columna derecha, visible desde 860 px: línea horizontal de 52 × 5 px con el color de estado, resumen explícito y Ver detalles. El texto diferencia guardado local, confirmación remota, desconexión con número de cambios pendientes, verificación requerida y error local/remoto. Comparte el diálogo de cinco colores con la barra móvil y devuelve el foco al botón que lo abrió. El panel reconoce también Buddy.auth.getUser cuando no existe el adaptador ArbatUser, como en la prueba aislada. La barra móvil conserva 5 px × 30vw y su ubicación exterior bajo la diana.

Verificación: 162 pruebas aprobadas, más Chrome a 320/390/859/1024/1440 px. Se comprobaron posición/alineación bajo el panel, altura de línea, cinco colores/textos, diálogo y foco, barra móvil sin cambios y recorridos de sincronización con servicios simulados. Captura visual de prueba en output/supabase-sync/desktop-status.png; el estado verde de esa captura es simulado para revisar el diseño.

Actualización pública preparada sobre main 3719fc68ba2dc71abc0b0bfad3c32af2e2a2c03d: rama arbatarchery/arbat_frontend:feature/supabase-desktop-status, commit f63ab69a464bfc52c758246610608a6e8b9c161a, árbol ac00b712b3ab438662a270200303ded87ed3a436. La comparación remota muestra solo tres archivos modificados bajo pruebas/supabase (HTML, sync.css y sync-ui.js). Falta crear/fusionar la propuesta manualmente por la limitación de escritura de la integración en asosab. No se necesita cambiar Supabase. La página de prueba anterior ya está publicada y el propietario lo confirmó; ambos orígenes de la función Supabase se verificaron permitidos.

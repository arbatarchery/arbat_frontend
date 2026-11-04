# Revisión administrativa y ciudad de uso

## Estado y alcance

Requisitos confirmados por el propietario: continuar las pruebas reales durante la semana de entrenamientos; el arquero no debe resolver conflictos entre dispositivos; la ubicación será solo una ciudad aproximada automática, registrada por cada andanada terminada y con avisos administrativos ante cambios de ciudad. No se solicitarán GPS, coordenadas precisas ni permisos de ubicación al dispositivo.

Esta entrega prepara el proveedor de ciudad y la especificación. No activa el registro de ubicaciones, no cambia la sincronización publicada y no implementa todavía la bandeja de conflictos. La publicación de la aplicación mantiene la aprobación del propietario.

## Conflictos: recepción primero, revisión por administradores

La integración actual bloquea las operaciones con conflicto y muestra que requieren revisión. Se sustituirá por un flujo de copia recibida en una bandeja privada del servidor:

1. Conservar la sesión local completa, sus UUID estables, las operaciones pendientes y cualquier versión alternativa. No elegir una versión por fecha, no sobrescribir datos canónicos automáticamente y no modificar CSV ni JSON de Statetty.
2. Enviar la copia y las alternativas como una recepción idempotente. Admitir partes para sesiones grandes, reanudación y confirmación final de integridad. Un simple aviso de conflicto no equivale a haber recibido la copia completa.
3. Solo después del recibo completo y confirmado, marcar la copia como guardada en la nube y liberar la cola para continuar registrando flechas. Las modificaciones posteriores de esa sesión se reciben como nuevas versiones vinculadas al mismo caso. Un fallo de red mantiene la copia local pendiente y se reintenta sin intervención del arquero.
4. El usuario no elige qué versión conservar ni recibe una tarea de resolución. Los fallos reales de guardado local o conexión conservan mensajes veraces; el color verde requiere un recibo del servidor, aunque la revisión administrativa esté pendiente.
5. Administrador ve los casos de su academia; SuperAdmin, todos. Un entrenador sin rol administrativo no recibe la bandeja. Las autorizaciones se obtienen de las tablas privadas, no del navegador.
6. La revisión compara versiones sin destruir originales. Las acciones de conservar, reemplazar o combinar deben registrar actor, fecha y decisión. Antes de aplicar una decisión, volver a comprobar las revisiones del caso y de la sesión: nuevos datos obligan al administrador a revisar de nuevo, sin afectar al arquero.
7. Mantener los datos canónicos confirmados separados de las copias pendientes de decisión. Definir una lectura coherente de las versiones pendientes para el propietario; no presentar revisiones administrativas como si ya se hubieran aplicado al historial canónico.

Se necesitan tablas privadas con RLS, RPC restringidas al servidor, límites de carga, auditoría y pruebas de idempotencia, interrupción, versiones nuevas y cambios de permisos antes de activar este flujo. No basta con ocultar el aviso rojo ni con ignorar las comprobaciones de revisión.

## Ciudad aproximada

El archivo `supabase/setup/approximate-city-worker.mjs` es un Worker autónomo de Cloudflare. Devuelve únicamente ciudad, región y país del visitante de esa petición, con origen `cloudflare-ip` y marca de estimación. No devuelve ni guarda IP completa, coordenadas, cookies o credenciales. No necesita secretos ni acceso a Supabase.

La consulta debe salir directamente del navegador hacia el Worker. Consultarlo desde Supabase detectaría la ubicación del servidor en lugar de la del visitante. El navegador no debe enviar tokens de Buddy/Supabase, cookies ni el enlace de la página a ese endpoint. No hay consultas a otro proveedor de geolocalización desde el Worker.

La aplicación añadirá luego un registro separado en Supabase, vinculado en el servidor a la identidad verificada, y un panel exclusivo para Administradores y SuperAdmin. La ciudad es información estimada de uso, nunca una autorización, una prueba de identidad ni un criterio para aceptar o rechazar entrenamientos. Un cliente puede alterar los datos que reporta; se mantendrá esa distinción explícita.

Registrar una observación de ciudad por cada andanada terminada, desde la primera y sin esperar el cierre de la sesión. Asociarla mediante el UUID estable de la andanada en el respaldo separado y conservar la fecha de observación. La primera detección válida se mantiene en los reintentos: reenviar no crea otra observación ni vuelve a atribuir una ciudad distinta al mismo evento. No se consulta por flecha ni se reutiliza ciegamente una detección de una andanada anterior.

Mostrar ciudad/región/país y «Ubicación aproximada» solo en la administración y mantener la última ciudad conocida del usuario. El cierre de la sesión no es requisito para recibir ni consultar esta información.

### Avisos de cambio de ciudad

- Comparar las observaciones válidas entre andanadas de la misma sesión. Si difieren, mostrar un aviso en la sesión administrativa con las ciudades, andanadas y fechas de detección correspondientes.
- Comparar también la primera observación válida de una sesión nueva con la última observación válida de la sesión anterior del mismo usuario. Si cambia, mostrar «Cambio de ciudad aproximada entre sesiones».
- Agrupar avisos repetidos por usuario, sesión y cambio de ciudad para no multiplicar una advertencia en cada andanada. Normalizar diferencias de escritura antes de comparar; no considerar la falta de ciudad como si fuese una ciudad diferente.
- El cambio es informativo: no bloquea al arquero, no cambia los colores del guardado y no se interpreta automáticamente como fraude ni como un conflicto de sincronización. La ubicación por IP es una estimación.
- Administrador ve los avisos de su academia; SuperAdmin, todos. Un entrenador sin rol administrativo no ve ubicaciones ni avisos.

### Andanadas sin conexión e importaciones antiguas

Si no se pudo detectar ciudad al terminar la andanada, mantener ese dato como no disponible. Si la consulta se realiza recién al recuperar conexión, identificarla como «Observada al sincronizar» y conservar por separado la fecha de la andanada y la fecha de detección. Esa ciudad no se presenta como la ubicación confirmada del entrenamiento.

La ciudad detectada al importar datos antiguos describe el lugar de la subida actual, no el lugar donde se realizó aquel entrenamiento. Las observaciones tardías y de importaciones no generan avisos que afirmen un cambio de ciudad durante el entrenamiento. La comparación automática de sesiones debe tener en cuenta esta diferencia antes de avisar.

La detección se hará en segundo plano, sin retrasar el guardado de flechas, pedir CAPTCHA adicional ni bloquear la aplicación. Si no hay ciudad disponible se indicará «Sin ubicación disponible», sin inventar una ciudad. Un aviso informará del uso de ciudad aproximada para las estadísticas y de su acceso restringido.

## Preparar el proveedor de ciudad

1. En Cloudflare abrir Workers & Pages y crear un Worker desde la plantilla de ejemplo, con nombre sugerido `arbat-city`.
2. Reemplazar todo el código del editor por `supabase/setup/approximate-city-worker.mjs` y desplegar.
3. No añadir claves de Supabase, secretos ni conexiones al repositorio. El Worker funciona de forma independiente.
4. Abrir su URL pública HTTPS, terminada en `workers.dev`, desde el navegador del usuario. La respuesta debe tener `source: cloudflare-ip`; `available` depende de que la red disponga de ciudad. La vista previa puede carecer de los metadatos geográficos: comprobar la URL desplegada.
5. Proporcionar solo esa URL pública para preparar la integración con la aplicación. Crear el Worker no empieza a registrar ubicaciones en Supabase: faltan la integración, el aviso y el panel.

Referencia de plataforma: https://developers.cloudflare.com/workers/runtime-apis/request/ (IncomingRequestCfProperties). Limitaciones: https://developers.cloudflare.com/network/ip-geolocation/ . La ubicación por IP puede diferir de la ubicación física, por ejemplo con redes móviles o VPN.

Prueba local: `node --test supabase/tests/approximate-city-worker.test.mjs`. Usa metadatos simulados; no consulta IP de visitantes reales ni despliega recursos.


## Apertura de Historial sin entrenamiento

El propietario añadió el evento independiente de apertura de Historial con fecha, hora y ciudad aproximada, también sin cuenta y sin entrenamiento ese día. La URL pública del proveedor ya fue recibida: https://arbat-city.arbat-archery.workers.dev/ . Su respuesta se verificó; la recepción de eventos, almacenamiento y panel siguen pendientes. Mantener esta medición separada de las observaciones por andanada y evitar duplicaciones por reintentos o restauración de sesión. El inventario y los requisitos de distribución móvil/escritorio se detallan en `docs/supabase-history-content.md`; aún no se modifica Historial.

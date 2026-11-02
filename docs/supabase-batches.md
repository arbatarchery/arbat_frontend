# Envíos acumulados por lotes

Las operaciones disponibles se agrupan de inmediato por sesión: hasta 32 por petición y 120 KiB de cuerpo UTF-8, con el mismo límite de 32 operaciones por turno del motor. No hay un temporizador para esperar más flechas. Una flecha nueva independiente sale sola; la primera creación de sesión y su flecha pueden compartir petición. Una sesión activa tiene prioridad sobre archivos cerrados y registros importados. Entre turnos se vuelven a consultar las colas para que la recuperación histórica ceda paso a cambios recientes.

IndexedDB prepara cada lote en una transacción, conservando UUID, orden y sobres inmutables con revisiones consecutivas. Solo los ACK aceptados de un prefijo continuo avanzan el punto de confirmación y eliminan operaciones. Un corte de red, una respuesta incompleta, una recarga o un límite temporal conserva el resto. Si el servidor ya guardó el lote pero se perdió su respuesta, se reenvían exactamente los mismos UUID/sobres y PostgreSQL devuelve los recibos previos.

El handler verifica la identidad una vez por petición. Con más de una operación invoca training_apply_batch en una sola consulta a PostgreSQL; las peticiones individuales mantienen training_apply_operation. La migración 0005 mueve la lógica original a una función privada compartida por ambos recorridos. Los permisos, campos permitidos, propietario, revisiones, tombstones, cuotas de sesiones/flechas y recibos siguen verificándose por operación. Cada operación tiene un subbloque transaccional: un error revierte esa operación, conserva el prefijo exitoso y marca el resto como no intentado. El lote completo se confirma al terminar la consulta; una respuesta perdida no necesita crear nuevas identidades de operación.

El límite compartido de ingreso ahora cuenta una unidad por petición acotada, hasta 120 por minuto. Un lote no consume 32 unidades. Las cuotas de almacenamiento siguen siendo las mismas. El cliente público no puede ejecutar las funciones de ingreso ni el núcleo privado que evita contar cada operación otra vez. Un lote contiene una sola sesión y los límites de cantidad/tamaño se comprueban también en servidor/SQL.

## Históricos locales

Al iniciar, importLegacy sigue examinando arbat-training-history, arbat-training-current y las claves arbat-training-AAAA-MM-DD del almacenamiento de ese origen. Las sesiones válidas conservan sus UUID persistentes; no se deduplican solo por fecha. La importación no escribe en las fuentes originales ni modifica CSV o JSON de Statetty. Las sesiones con conflictos de versión o datos inválidos se conservan para revisión. Las pertenecientes a otra cuenta no se envían desde una cuenta diferente. Los límites de almacenamiento pueden requerir cuenta Buddy para históricos mayores.

La vista localhost tiene almacenamiento separado de arbatarchery.com: sus pruebas no importan datos reales de la web publicada. La importación de esos datos ocurrirá desde ese mismo origen/navegador cuando se apruebe y active la integración allí. No se ha publicado ese cambio.

## Actualización del desarrollo existente

1. En SQL Editor del proyecto qbtdwlcpqcsolubhhkfa ejecutar únicamente supabase/migrations/202611010005_training_batches.sql. Requiere las migraciones base 0001/0002; no necesita activar lectura histórica 0003. No volver a ejecutar el instalador inicial.
2. En Edge Functions > training-sync > Code > index.ts reemplazar todo por supabase/setup/training-sync-dashboard.ts y desplegar la actualización. Conservar los Secrets y la comprobación JWT antigua desactivada.
3. Recargar localhost:8000. Pausar la conexión de prueba, registrar varias flechas ficticias, restaurar y esperar verde/cero pendientes. Comprobar respaldo contrasta UUID y revisión remotos.

El frontend nuevo mantiene el formato operations[] que ya aceptaba el handler anterior, pero la reducción a una sola consulta SQL por lote requiere aplicar 0005 y desplegar el handler nuevo. La migración no crea tablas ni elimina entrenamientos. El instalador inicial generado contiene cinco migraciones y solo sirve para proyectos vacíos.

## Verificación

157 pruebas locales aprobadas. Se probaron límites UTF-8, lotes de 32, avance de revisión, reintento tras respuesta perdida y reapertura, confirmaciones parciales, cambio de prioridades, importación histórica repetida, cuotas/permisos SQL y el recorrido IndexedDB → transporte HTTP → handler → PostgreSQL. Las pruebas previas de CSV/telemetría siguen pasando. En el caso de 71 operaciones acumuladas se usaron tres peticiones (32, 32 y 7); esto mide cantidad de solicitudes con servicios simulados, no latencia de Supabase real. La actualización remota y su prueba de tiempos quedan pendientes del propietario.

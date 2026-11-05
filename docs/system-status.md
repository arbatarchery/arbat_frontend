# Panel administrativo de estado

## Instalación

1. Ejecutar `supabase/setup/actualizar-estado-sistema.sql` en SQL Editor. Requiere migraciones 001–008. Crea/reemplaza solamente la función de diagnóstico agregado; no borra ni modifica entrenamientos. La migración equivalente es 009.
2. Reemplazar `training-sync` en Supabase por el contenido completo de `supabase/setup/training-sync-dashboard.ts` y desplegar, conservando sus secretos y configuración actual. No cambiar la verificación JWT del gateway.
3. Crear y fusionar el PR de la web desde el fork hacia `asosab/arbat_frontend:main`.

## Alcance

El panel carga cerrado, al final de Historial. Solo se muestra tras confirmar un rol Admin/SuperAdmin. Una función SQL restringida a `service_role` vuelve a verificar identidad y rol en cada comprobación de servidor. Entrenadores y arqueros no reciben los datos. Cerrar sesión, cambiar de cuenta o revocar el rol borra los datos del panel.

Se utiliza el mismo indicador y etiqueta en cada servicio, área y encabezado: error (rojo) > advertencia (amarillo) > sin comprobar (gris) > correcto (verde). El padre hereda el peor estado de todos sus hijos, también estando cerrado. Una lectura lenta (>3 segundos) es advertencia. Las mediciones correctas de hace más de cinco minutos pasan a advertencia. Se conservan en memoria los últimos 20 errores de esta pestaña; no se transmite el diagnóstico ni se guarda en el navegador. Un error histórico permanece en el listado tras recuperarse el servicio, pero el estado actual del servicio se actualiza.

Las comprobaciones se ejecutan una vez al verificar el acceso y manualmente con Comprobar ahora (mínimo 30 segundos). No hay sondeo de red periódico. El reloj de antigüedad se actualiza cada minuto. La comprobación de ciudad solicita una prueba firmada pero no inserta eventos ficticios en la base. La cola es únicamente la de este navegador; una cola vacía no demuestra que todos los arqueros estén sincronizados. La comprobación de base confirma lectura y modo de solo lectura, no hace escrituras de prueba. Estado general de otros dispositivos y alertas persistentes requieren una integración posterior de observabilidad.

Los códigos, áreas y acciones se filtran por listas permitidas. No se recopilan tokens, cuerpos de respuestas, URLs, nombres ni coordenadas. Copiar diagnóstico copia solo estos campos seguros, fechas, tiempos y métricas agregadas. Los errores de función se identifican por acción, HTTP y código seguro. No se reemplazan por mensajes arbitrarios del servidor.

## Plan Free y límites de las métricas

Plan Free confirmado por el propietario el 5 de noviembre de 2026. El tamaño actual se consulta en Postgres (`pg_database_size(current_database())`) y se compara con una referencia de 500 MB. Se informa claramente que no es el consumo facturado: la cuota de tamaño se evalúa sobre el promedio diario y puede abarcar otros proyectos de la organización. Tampoco representa el disco completo, que incluye WAL y otros archivos. El panel no declara que todo el plan tenga un porcentaje único ni confirma capacidad libre de disco.

El consumo oficial del ciclo de transferencia y ejecuciones no está conectado: se presenta gris, nunca como cero ni como verde. Referencias Free: 5 GB de transferencia sin caché, 5 GB con caché (cuotas independientes), 500.000 ejecuciones por ciclo. Para mostrar porcentajes mensuales y fechas de reinicio exactas se necesita una fuente oficial del consumo de la organización. No se solicitan ni se exponen credenciales de administración en el frontend. Umbrales informativos de tamaño: 80 % advertencia y 95 % error; no son una predicción del bloqueo de Supabase.

Fuentes consultadas el 2026-11-05:
- https://supabase.com/docs/guides/platform/database-size
- https://supabase.com/docs/guides/platform/manage-your-usage/egress
- https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations

## Fallas de la propia nube

En una pestaña que ya confirmó el rol, una consulta fallida conserva el panel y permite ver los errores del navegador; las respuestas y mediciones anteriores incluyen sus fechas y dejan de aparecer como actuales. Tras recargar sin poder autenticar/verificar el rol, el panel permanece oculto: no se infieren permisos administrativos del almacenamiento local.

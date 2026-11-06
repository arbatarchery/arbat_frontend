# Panel administrativo de estado

La integración actual utiliza Supabase Management API. Seguir `docs/management-diagnostics.md` para instalar el SQL, configurar el secreto de lectura y desplegar la función actualizada. Ese documento sustituye los pasos anteriores del panel.

El panel carga cerrado, solo para Administrador y SuperAdmin. Cada encabezado hereda el peor estado de sus servicios: error > advertencia > sin comprobar > correcto. Una medición correcta pasa a advertencia por antigüedad solo después de una hora. No se muestran colas locales ni listados de errores de esta pestaña.

Las respuestas confirmadas de servicios conservan HTTP, código seguro y fecha. Copiar diagnóstico incluye únicamente datos sanitizados de servicios y servidores. El panel se borra al cerrar sesión, cambiar de cuenta o perder permisos. Las comprobaciones se ejecutan al verificar acceso y con Comprobar ahora, con un mínimo de 30 segundos; no se añade sondeo periódico.

El porcentaje de disco usa su capacidad real, no una referencia fija Free. Los consumos mensuales facturados que no proporciona la API pública permanecen sin comprobar. El estado parcial no se convierte en correcto por falta de datos.

El panel oculta indicadores sin datos confirmados, así como campos de cuotas mensuales que no proporciona la API. No aparecen en los totales de gravedad ni en Copiar diagnóstico. Los encabezados sin indicadores visibles también se omiten. El estado global describe únicamente los indicadores mostrados. La conexión de API administrativa se considera correcta si hay lecturas confirmadas, aunque otro endpoint no proporcione datos. No se penaliza el uso de consultas de solo lectura. La integración no puede inspeccionar todos los permisos de un PAT con los endpoints documentados: no declara que el token carezca de escritura ni ejecuta operaciones de escritura para probarlo. Los permisos se verifican al configurar el token en Supabase.

Para `system.status`, la advertencia por lentitud aparece solamente al superar 10.000 ms. La petición de diagnóstico dispone de 20 segundos para completar y permitir distinguir una respuesta lenta de un timeout; las demás consultas conservan sus límites actuales.

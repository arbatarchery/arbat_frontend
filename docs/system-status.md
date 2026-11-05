# Panel administrativo de estado

La integración actual utiliza Supabase Management API. Seguir `docs/management-diagnostics.md` para instalar el SQL, configurar el secreto de lectura y desplegar la función actualizada. Ese documento sustituye los pasos anteriores del panel.

El panel carga cerrado, solo para Administrador y SuperAdmin. Cada encabezado hereda el peor estado de sus servicios: error > advertencia > sin comprobar > correcto. Una medición correcta pasa a advertencia por antigüedad solo después de una hora. No se muestran colas locales ni listados de errores de esta pestaña.

Las respuestas confirmadas de servicios conservan HTTP, código seguro y fecha. Copiar diagnóstico incluye únicamente datos sanitizados de servicios y servidores. El panel se borra al cerrar sesión, cambiar de cuenta o perder permisos. Las comprobaciones se ejecutan al verificar acceso y con Comprobar ahora, con un mínimo de 30 segundos; no se añade sondeo periódico.

El porcentaje de disco usa su capacidad real, no una referencia fija Free. Los consumos mensuales facturados que no proporciona la API pública permanecen sin comprobar. El estado parcial no se convierte en correcto por falta de datos.

# Aviso de capacidad para arqueros

Ejecutar `supabase/setup/actualizar-aviso-capacidad.sql` en SQL Editor antes de fusionar la web. Requiere las migraciones 001–009. No requiere reemplazar la Edge Function: reutiliza `history.context`. La migración equivalente para instalaciones nuevas es 010.

La comprobación se realiza en el servidor durante la consulta existente de permisos. Devuelve únicamente `database_near_limit`, sin exponer tamaño, métricas ni diagnósticos administrativos a los arqueros. El umbral coincide con el estado rojo del tamaño actual de la base: 95 % de la referencia Free de 500 MB (475 MB). No predice el agotamiento del disco total ni representa el promedio de facturación.

En Historial, las cuentas de arquero y entrenador ven un aviso rojo solo cuando esta señal es explícitamente verdadera. Administrador y SuperAdmin conservan su panel técnico y no reciben un aviso duplicado. No hay aviso para estados amarillo, verde o sin comprobar ni para errores de otros servicios. El aviso se oculta al iniciar una nueva consulta, cerrar sesión o cambiar el estado de autenticación; vuelve a evaluarse con la respuesta del servidor.

Texto: «Cerca del límite. La base de datos está por llenarse. Por favor, comunícalo al encargado.» No se envían mensajes automáticamente a terceros.

Verificación: pruebas del límite 474.999.999 / 475.000.000 bytes, booleano en el contexto existente, permisos de la función auxiliar y visibilidad según rol/estado/autenticación.

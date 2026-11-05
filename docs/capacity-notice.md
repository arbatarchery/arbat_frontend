# Aviso de capacidad para arqueros

Esta entrega sustituye la referencia fija de Free por una comprobación del disco real con Management API. Ver `docs/management-diagnostics.md` para la activación. El SQL actualizado es `supabase/setup/actualizar-diagnostico-administrativo.sql`; no ejecutar el instalador antiguo de capacidad después del nuevo.

El aviso en Historial permanece oculto salvo que el servidor confirme ocupación >=95 % con una medición válida de hasta una hora de antigüedad. Las cuentas de arquero/entrenador reciben únicamente un booleano; Administrador y SuperAdmin conservan el panel completo. Al cambiar de cuenta o iniciar una nueva consulta se oculta el aviso anterior hasta confirmar el nuevo resultado.

Texto: «Cerca del límite. La base de datos está por llenarse. Por favor, comunícalo al encargado.» No se envían mensajes automáticamente a terceros.

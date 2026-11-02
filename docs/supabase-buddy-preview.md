# Prueba local con una cuenta Buddy real

Se añadió Probar con Buddy a las dos páginas de la vista localhost. El acceso se carga solo al pulsarlo, al regresar por el enlace de correo con el parámetro auth, o al recargar una vista donde ya se eligió Buddy. Usa el identificador público arbat, confirmado en runtime/config para https://arbatarchery.com, y los módulos oficiales de configuración/transporte/autenticación de Statetty. No se incluye un cliente JWT propio ni se copian tokens al chat. La preferencia local guarda solo que se habilitó Buddy; las credenciales quedan bajo el manejo del módulo oficial. Los scripts remotos se solicitan sin referrer y debug está desactivado.

El formulario llama a Buddy.auth.requestLogin únicamente tras enviar explícitamente el correo. El enlace vuelve a http://localhost:8000/entrenamiento/ (o historial si se inicia allí), que puede abrirse como página completa en otra pestaña del mismo navegador. Buddy consume el parámetro de verificación y gestiona la sesión/renovación. El respaldo obtiene la prueba mediante Buddy.auth.getAccessToken y la función Edge la verifica contra el endpoint fijo. La telemetría de eventos ficticios se suprime exclusivamente en la vista de prueba; el transporte oficial request sigue habilitado para Auth. No se cargan chat/personaje/administración ni se publican cambios en el sitio.

## Configuración externa pendiente

En la comprobación pública del 1 de noviembre de 2026, GET https://api.statetty.com/api/buddy/auth/session respondió sin autenticación para ambos orígenes, pero solo incluyó Access-Control-Allow-Origin para https://arbatarchery.com. Para Origin: http://localhost:8000 no incluyó ese permiso. Por ello no se considera probado el login real local: se debe autorizar ese origen en Buddy/Statetty, conservando el permiso de producción. Esto no se configura en los Secrets ni en la lista de orígenes de la función de Supabase, que ya admite localhost. No se ha cambiado la configuración de Buddy automáticamente.

No se solicitó ningún correo real ni se usaron credenciales durante las comprobaciones del agente. El propietario debe realizar el login desde el formulario después de habilitar el origen. No compartir el enlace recibido ni sus códigos.

## Recorridos manuales después de habilitar el origen

1. Recargar localhost:8000 manteniendo las flechas ficticias ya respaldadas. Pulsar Probar con Buddy dentro del recuadro de entrenamiento y enviar el correo de una cuenta existente.
2. Abrir el enlace en el mismo navegador. Esperar la cuenta conectada y la barra verde. Esto prueba asignación de la cola/sesiones anónimas previas mediante su credencial original y la prueba Buddy.
3. En una ventana privada nueva, iniciar Buddy antes de terminar la primera andanada y registrar otra flecha ficticia. Debe respaldarse sin crear sesión Supabase anónima ni mostrar Turnstile adicional. El servidor puede resolver el mismo perfil canónico de la cuenta.
4. La comprobación de respaldo por Data API de la vista anterior es solo para anónimos: no usarla como prueba de lectura con Buddy. La lectura de cuenta requiere habilitar la migración 0003 y el historial remoto en una fase posterior. Una barra verde confirma ACK, no sustituye la comparación de historial remoto.

## Verificación local

161 pruebas aprobadas. Se comprobaron carga diferida, cuatro scripts oficiales fijos, ausencia de solicitudes de correo sin enviar el formulario, conservación del transporte Auth y supresión de eventos ficticios, retorno/recarga sin solicitar otro correo, texto de cuenta seguro y error útil de origen. Chrome verificó el botón/formulario con módulos simulados: cuatro cargas al pulsar y una sola solicitud simulada tras enviar. No hubo peticiones inesperadas ni correos reales. El servidor local se actualizó conservando el almacenamiento previo; producción sigue desactivada.

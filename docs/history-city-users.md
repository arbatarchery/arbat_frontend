# Historial: usuarios por ciudad y orden de arqueros

Antes de fusionar la rama de la web, ejecutar en Supabase SQL Editor el contenido completo de `supabase/setup/actualizar-usuarios-por-ciudad.sql`. Requiere las migraciones 001–007. Reemplaza solamente `training_usage_summary`, conserva sus permisos y no modifica eventos ni entrenamientos. Puede repetirse. No requiere desplegar la Edge Function ni cambiar secretos.

La migración equivalente para instalaciones nuevas es `202611050008_city_users.sql`. No volver a ejecutar versiones anteriores de `ajustar-resumen-uso.sql` después de esta actualización, pues retirarían el detalle por usuario.

En cada ciudad se conserva el total y se añade un desplegable con nombre, aperturas de Historial, andanadas y última observación por usuario o navegador anónimo del período seleccionado. La identidad se agrupa en el servidor sin enviar identificadores internos al navegador. Se mantienen los permisos administrativos y el alcance por academia. Se muestran hasta 100 usuarios/navegadores por ciudad; si hay más, se informa del límite y se conservan los totales completos. Sin la actualización del servidor, la web conserva los totales y avisa que el detalle todavía no está disponible.

Arqueros supervisados inicia por fecha descendente. Los cuatro encabezados permiten alternar el orden y anuncian la dirección con flechas y `aria-sort`. Arquero comienza A–Z; fecha, flechas y promedio comienzan de mayor a menor. Los valores ausentes permanecen al final.

Validación: 183 pruebas automáticas aprobadas, incluyendo ordenación, agrupación por ciudad/usuario, aperturas y andanadas, navegadores anónimos y aislamiento entre academias. La base de producción no fue modificada durante la preparación.

# Prueba aislada en arbatarchery.com

El propietario autorizó usar el dominio real para probar Buddy sin depender del permiso de localhost. Se preparó una página autónoma en /pruebas/supabase/ y un historial local bajo esa ruta. Añade solo 22 archivos bajo pruebas/supabase; no modifica /entrenamiento/, la configuración global, datos previos, CSV ni JSON. Almacenamiento: prefijo arbat-supabase-domain-test-v1: e IndexedDB arbat-training-sync-domain-test-v1. Los recursos son copias bajo la misma ruta, con lib en lugar de vendor y test-controls en lugar de nombres con guion bajo, para que Jekyll no los excluya. Incluye las licencias del SDK.

La página es pública, no enlazada y tiene noindex,nofollow; esto no representa un control de acceso. Solo usar registros ficticios. La cuenta Buddy se maneja por sus módulos oficiales y puede reutilizar la sesión del dominio; no se copian ni muestran credenciales. No se envían eventos de entrenamiento ficticios a Statetty. La integración Supabase general permanece desactivada.

## Código listo y acceso de publicación

Se generó desde supabase/scripts/build-domain-test.mjs. Rama local de exportación feature/supabase-domain-test en ../arbat_domain_test, separada de feature/supabase-sync. El árbol probado es 8db7d6474c400dce734e3a690e7a2470ae954a82.

La integración GitHub rechazó crear rama y propuesta en asosab/arbat_frontend con 403 Resource not accessible by integration. El Git local no tiene credenciales de escritura configuradas. Sí se creó la rama en la copia arbatarchery/arbat_frontend:

- Rama remota feature/supabase-domain-test, commit 5964d9a6a9ddc4d74e895794308678cfcf53ed7b.
- Su padre es main actual de asosab, 587019d202112e364594d05492e3adfa57a280c6; no incluye cambios antiguos de la copia del usuario.
- Comparación remota verificada: un commit adelante y exactamente 22 archivos añadidos, todos bajo pruebas/supabase. El árbol remoto coincide con el local probado.
- Propuesta aún NO creada y cambio NO publicado. El propietario debe abrir https://github.com/asosab/arbat_frontend/compare/main...arbatarchery:feature/supabase-domain-test?expand=1, crear la propuesta y fusionarla desde su cuenta si dispone de ese permiso.
- Alternativa preparada: output/arbat-prueba-supabase.zip, verificado con solo esos 22 archivos dentro de pruebas/supabase.

## Configuración necesaria en Supabase

El OPTIONS público a training-sync con Origin https://arbatarchery.com respondió 403 sin Access-Control-Allow-Origin. Actualizar Edge Functions > Secrets > TRAINING_ALLOWED_ORIGINS con este valor completo (sin borrar localhost):

http://localhost:8000,https://arbatarchery.com

No se solicitan secretos adicionales. Se conserva el proyecto de desarrollo y no se cambia la base de datos de otra aplicación. Después de guardar y publicar, comprobar que OPTIONS permite el origen y que GitHub Pages sirve la página/SDK/controles. La prueba Buddy real y su enlace por correo siguen pendientes del propietario.

## Validación realizada

162 pruebas locales aprobadas. Chrome sirvió el artefacto autónomo por su ruta real con servicios simulados: importó el SDK desde lib, preservó un entrenamiento habitual ajeno a la prueba, mantuvo la sesión anónima al asignarla a Buddy, confirmó una flecha posterior y una andanada, y verificó cero CAPTCHA, cero alta Supabase anónima y cero telemetría ficticia hacia Statetty en ese recorrido. No se envió correo real ni se usaron credenciales reales. No se ejecutó el build completo de Jekyll porque falta Bundler 4.0.18 en el entorno; los archivos de la prueba son estáticos sin frontmatter y se evitaron las carpetas excluidas.

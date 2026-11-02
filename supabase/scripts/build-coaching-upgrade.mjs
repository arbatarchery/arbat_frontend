import {readFile,writeFile} from 'node:fs/promises';
const read=name=>readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');
const strip=sql=>sql.replace(/^begin;\n/m,'').replace(/\ncommit;\s*$/,'\n');
const history=strip(await read('202611010003_training_history.sql'));
const coaching=strip(await read('202611020006_training_coaching.sql'));
const sql=`-- Actualización de Historial y entrenadores. Proyecto: qbtdwlcpqcsolubhhkfa.
-- Conserva sesiones, flechas y exportaciones. No activa ni publica páginas.
begin;
do $preconditions$ begin
 if to_regprocedure('public.training_apply_batch(uuid,text,jsonb)') is null then
  raise exception 'Falta la actualización previa de sincronización por lotes. No se realizaron cambios.';
 end if;
end;$preconditions$;
do $install_history$ begin
 if to_regprocedure('public.training_history_list(uuid,text,date,date,uuid,text)') is null then
  execute $history_source$${history}$history_source$;
 end if;
end;$install_history$;
${coaching}
commit;
select 'historial_y_entrenadores_preparados' as estado;
`;
await writeFile(new URL('../setup/actualizar-historial-entrenadores.sql',import.meta.url),sql);

import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const files=['202611010001_training_foundation.sql','202611010002_training_ingestion.sql','202611010003_training_history.sql','202611010004_buddy_bridge.sql','202611010005_training_batches.sql','202611020006_training_coaching.sql'];
const blocks=[];
for(const file of files){
 const sql=await readFile(new URL(`../migrations/${file}`,import.meta.url),'utf8');
 if((sql.match(/^begin;$/gm)||[]).length!==1||(sql.match(/^commit;$/gm)||[]).length!==1)throw new Error(`Unexpected transaction structure: ${file}`);
 blocks.push(`-- Source: ${file}\n-- SHA-256: ${createHash('sha256').update(sql).digest('hex')}\n${sql.replace(/^begin;\n/m,'').replace(/\ncommit;\s*$/,'\n')}`);
}
const guard=`do $arbat_setup$
begin
 if to_regclass('auth.users') is null then
  raise exception 'Se requiere un proyecto Supabase con Auth disponible.';
 end if;
 if to_regnamespace('arbat_private') is not null
    or to_regclass('public.training_profiles') is not null
    or to_regclass('public.training_sessions') is not null
    or to_regclass('public.training_ends') is not null
    or to_regclass('public.training_arrows') is not null then
  raise exception 'Ya existen objetos de entrenamiento. No se modificaron. Revisar antes de continuar.';
 end if;
end;
$arbat_setup$;`;
const verification=await readFile(new URL('../setup/verificar-desarrollo.sql',import.meta.url),'utf8');
const assertion=`do $arbat_verify$
declare n integer;
begin
 select count(*) into n from pg_catalog.pg_class c join pg_catalog.pg_namespace s on s.oid=c.relnamespace
 where c.relkind='r' and c.relrowsecurity and (s.nspname='arbat_private' or (s.nspname='public' and c.relname in ('training_profiles','training_sessions','training_ends','training_arrows')));
 if n<>14 then raise exception 'La verificacion RLS no coincide con las 14 tablas previstas.'; end if;
 if has_function_privilege('anon','public.training_apply_operation(uuid,text,jsonb)','execute')
    or has_function_privilege('authenticated','public.training_apply_operation(uuid,text,jsonb)','execute')
    or has_function_privilege('anon','public.training_claim(uuid,text,text)','execute')
    or has_function_privilege('authenticated','public.training_claim(uuid,text,text)','execute')
    or has_function_privilege('anon','public.training_apply_batch(uuid,text,jsonb)','execute')
    or has_function_privilege('authenticated','public.training_apply_batch(uuid,text,jsonb)','execute')
    or has_function_privilege('service_role','arbat_private.apply_training_operation(uuid,text,jsonb,boolean)','execute') then
  raise exception 'Las funciones de ingreso no deben estar disponibles para clientes.';
 end if;
 if has_table_privilege('anon','public.training_sessions','select')
    or has_table_privilege('authenticated','public.training_sessions','insert')
    or has_table_privilege('authenticated','public.training_sessions','update') then
  raise exception 'Los privilegios directos de sesiones no coinciden con el modelo previsto.';
 end if;
end;
$arbat_verify$;`;
await writeFile(new URL('../setup/preparar-desarrollo.sql',import.meta.url),`-- ARBAT: instalacion inicial, SOLO desarrollo. Generado; no editar a mano.\n-- Proyecto previsto: qbtdwlcpqcsolubhhkfa. Confirmarlo en el Dashboard antes de ejecutar.\n-- Crea tablas y funciones; no despliega funciones Edge ni activa la web.\n-- Una transaccion: falla sin reemplazar objetos si ya estan instalados.\nbegin;\n${guard}\n\n${blocks.join('\n\n')}\n${assertion}\ncommit;\n\n${verification}`);

-- Consulta de solo lectura: no crea usuarios, no escribe datos ni envia solicitudes.
select
 count(*)::integer as tablas_entrenamiento,
 count(*) filter (where c.relrowsecurity)::integer as tablas_con_rls,
 case when count(*)=14 and bool_and(c.relrowsecurity)
   then 'estructura_preparada' else 'revisar_estructura' end as estado
from pg_catalog.pg_class c
join pg_catalog.pg_namespace s on s.oid=c.relnamespace
where c.relkind='r'
 and (s.nspname='arbat_private'
 or (s.nspname='public' and c.relname in ('training_profiles','training_sessions','training_ends','training_arrows')));

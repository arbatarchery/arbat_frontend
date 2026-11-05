-- Estado agregado del proyecto. Solo Administrador/SuperAdmin via Edge Function.
begin;
create or replace function public.training_system_status(p_principal uuid,p_buddy_subject text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_role text;v_bytes bigint;
begin
 if p_buddy_subject is null then raise exception 'buddy_required' using errcode='28000';end if;
 v_actor:=arbat_private.ingress_actor(p_principal,p_buddy_subject);
 v_role:=arbat_private.training_role(v_actor,p_buddy_subject);
 if v_role not in ('admin','superadmin') then raise exception 'admin_required' using errcode='42501';end if;
 if not arbat_private.ingress_allow(v_actor) then return jsonb_build_object('status','rate_limited');end if;
 select pg_catalog.pg_database_size(pg_catalog.current_database()) into v_bytes;
 return jsonb_build_object('status','accepted','role',v_role,'checked_at',pg_catalog.now(),
 'database_bytes',v_bytes,'database_read_only',pg_catalog.current_setting('default_transaction_read_only')='on',
 'plan','Free','reference_database_bytes',500000000,
 'monthly_metrics_available',false);
end;$$;
revoke all on function public.training_system_status(uuid,text) from public,anon,authenticated;
grant execute on function public.training_system_status(uuid,text) to service_role;
commit;

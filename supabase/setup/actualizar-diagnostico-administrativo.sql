-- Limites dinamicos desde Management API: ningun valor Free fijo. Requiere 001-009; sustituye tambien el aviso de la migracion 010.
begin;
create or replace function arbat_private.training_database_near_limit(p_bytes bigint)
returns boolean language sql immutable set search_path='' as $$
 select null::boolean; -- Sin limite confirmado: no asumir Free.
$$;
revoke all on function arbat_private.training_database_near_limit(bigint) from public,anon,authenticated,service_role;
create or replace function public.training_history_context(p_principal uuid,p_buddy_subject text,p_display_name text default null,p_verified_email text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_role text;v_name text;
begin
 v_actor:=arbat_private.ingress_actor(p_principal,p_buddy_subject);
 if not arbat_private.ingress_allow(v_actor) then return jsonb_build_object('status','rate_limited');end if;
 if p_buddy_subject is not null then
  if p_display_name is not null and length(trim(p_display_name)) between 1 and 200 then
   update public.training_profiles set display_name=trim(p_display_name) where id=v_actor;
  end if;
  if p_verified_email is not null and length(p_verified_email)<=254 and p_verified_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
   update arbat_private.external_identities set verified_email=lower(trim(p_verified_email)),verified_at=now()
    where issuer='https://api.statetty.com' and subject=p_buddy_subject and user_id=v_actor;
  end if;
  insert into arbat_private.school_members(school_id,user_id) values('a8ba7000-0000-4000-8000-000000000001',v_actor) on conflict do nothing;
 end if;
 v_role:=arbat_private.training_role(v_actor,p_buddy_subject);
 select display_name into v_name from public.training_profiles where id=v_actor;
 return jsonb_build_object('status','accepted','role',v_role,'can_coach',v_role in ('coach','admin','superadmin'),'can_manage',v_role in ('admin','superadmin'),
  'database_near_limit',null,
  'actor',jsonb_build_object('id',v_actor,'subject',p_buddy_subject,'name',v_name));
end;$$;

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
 'plan',null,'reference_database_bytes',null,
 'monthly_metrics_available',false);
end;$$;
revoke all on function public.training_system_status(uuid,text) from public,anon,authenticated;
grant execute on function public.training_system_status(uuid,text) to service_role;

commit;

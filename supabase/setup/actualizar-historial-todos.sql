-- Consulta explicita Todos. Identidad y alcance se verifican en servidor.
begin;
create or replace function public.training_history_all(p_principal uuid,p_buddy_subject text,p_from date,p_to date,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_role text;v_items jsonb;v_count integer;v_cursor uuid;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>3660 then raise exception 'invalid_range' using errcode='22023';end if;
 if p_buddy_subject is null then raise exception 'buddy_required' using errcode='28000';end if;
 v_actor:=arbat_private.ingress_actor(p_principal,p_buddy_subject);v_role:=arbat_private.training_role(v_actor,p_buddy_subject);
 if v_role not in ('coach','admin','superadmin') then raise exception 'coach_required' using errcode='42501';end if;
 if not arbat_private.ingress_allow(v_actor) then return jsonb_build_object('status','rate_limited');end if;
 select coalesce(jsonb_agg(arbat_private.history_metadata(rows)||jsonb_build_object('owner',jsonb_build_object('id',rows.owner_id,'name',coalesce(nullif(p.display_name,''),'Arquero '||right(rows.owner_id::text,8)),'anonymous',false)) order by rows.id),'[]'::jsonb),count(*),max(rows.id::text)::uuid
 into v_items,v_count,v_cursor from (
  select s.* from public.training_sessions s where s.local_date between p_from and p_to and (p_after is null or s.id>p_after)
   and arbat_private.can_read_history(v_actor,s.owner_id,s.school_id,p_buddy_subject)
  order by s.id limit 8
 ) rows left join public.training_profiles p on p.id=rows.owner_id;
 return jsonb_build_object('status','accepted','sessions',v_items,'next_cursor',case when v_count=8 then v_cursor else null end);
end;$$;
revoke all on function public.training_history_all(uuid,text,date,date,uuid) from public,anon,authenticated;
grant execute on function public.training_history_all(uuid,text,date,date,uuid) to service_role;
commit;

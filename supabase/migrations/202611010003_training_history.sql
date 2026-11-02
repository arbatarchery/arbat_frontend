-- Paginated history, service RPCs only; the Edge handler verifies both identities.
begin;
create index training_arrows_history_idx on public.training_arrows(session_id,id);
create index training_ends_history_idx on public.training_ends(session_id,id);

create function arbat_private.can_read_history(p_actor uuid,p_owner uuid,p_school uuid,p_buddy_subject text)
returns boolean language sql stable security definer set search_path='' as $$
 select p_actor=p_owner or (p_buddy_subject is not null and (
  exists(select 1 from arbat_private.role_assignments r where r.user_id=p_actor and r.role='superadmin')
  or exists(select 1 from arbat_private.role_assignments r where r.user_id=p_actor and r.role='admin' and r.school_id=p_school)
  or exists(select 1 from arbat_private.role_assignments r join arbat_private.coach_athletes c on c.school_id=r.school_id and c.coach_id=r.user_id
    where r.user_id=p_actor and r.role='coach' and r.school_id=p_school and c.athlete_id=p_owner and c.active)
 ));
$$;

create function arbat_private.history_metadata(s public.training_sessions)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',s.id,'legacy_session_id',s.legacy_session_id,'owner_id',s.owner_id,
  'date',s.local_date,'startedAt',s.started_at,'endedAt',s.ended_at,'sessionType',s.session_type,
  'arrowsPerEnd',s.arrows_per_end,'shootingDistance',s.shooting_distance,'targetSize',s.target_size,
  'notes',s.notes,'revision',s.revision,'deletedAt',s.deleted_at);
$$;

create function public.training_history_list(p_principal uuid,p_buddy_subject text,p_from date,p_to date,p_after uuid default null,p_target_subject text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_target uuid;v_items jsonb;v_count integer;v_cursor uuid;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>3660 then raise exception 'invalid_range' using errcode='22023';end if;
 v_actor:=arbat_private.ingress_actor(p_principal,p_buddy_subject);
 if not arbat_private.ingress_allow(v_actor) then return jsonb_build_object('status','rate_limited');end if;
 if p_target_subject is null or p_target_subject=p_buddy_subject then v_target:=v_actor;
 elsif p_buddy_subject is not null then
  select user_id into v_target from arbat_private.external_identities where issuer='https://api.statetty.com' and subject=p_target_subject;
 else raise exception 'buddy_required' using errcode='28000';end if;
 select coalesce(jsonb_agg(arbat_private.history_metadata(rows) order by rows.id),'[]'::jsonb),count(*),max(rows.id::text)::uuid
 into v_items,v_count,v_cursor from (
  select s.* from public.training_sessions s where s.owner_id=v_target and s.local_date between p_from and p_to
   and (p_after is null or s.id>p_after) and arbat_private.can_read_history(v_actor,s.owner_id,s.school_id,p_buddy_subject)
  order by s.id limit 8
 ) rows;
 return jsonb_build_object('status','accepted','sessions',v_items,'next_cursor',case when v_count=8 then v_cursor else null end);
end;$$;

create function public.training_history_detail(p_principal uuid,p_buddy_subject text,p_session uuid,p_revision bigint,p_collection text,p_after uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_session public.training_sessions%rowtype;v_items jsonb;v_cursor uuid;v_count integer;v_limit integer;
begin
 if p_session is null or p_revision is null or p_revision<1 or p_collection not in ('ends','arrows') or p_collection is null then
  raise exception 'invalid_detail_request' using errcode='22023';end if;
 v_actor:=arbat_private.ingress_actor(p_principal,p_buddy_subject);
 if not arbat_private.ingress_allow(v_actor) then return jsonb_build_object('status','rate_limited');end if;
 -- All ingestion/claim writes lock this parent. Hold it while reading a page.
 select * into v_session from public.training_sessions where id=p_session for share;
 if v_session.id is null or not arbat_private.can_read_history(v_actor,v_session.owner_id,v_session.school_id,p_buddy_subject) then
  raise exception 'not_authorized' using errcode='42501';end if;
 if v_session.revision<>p_revision then return jsonb_build_object('status','changed','revision',v_session.revision);end if;
 if v_session.deleted_at is not null then return jsonb_build_object('status','gone');end if;
 if p_collection='ends' then
  v_limit:=16;
  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id),'[]'::jsonb),count(*),max(rows.id::text)::uuid into v_items,v_count,v_cursor from (
   select e.id,e.ordinal,e.ended_at,e.arrow_limit,e.session_type,e.shooting_distance,e.target_size,e.notes
   from public.training_ends e where e.session_id=p_session and e.deleted_at is null and (p_after is null or e.id>p_after)
   order by e.id limit 16
  )rows;
 else
  v_limit:=256;
  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.id),'[]'::jsonb),count(*),max(rows.id::text)::uuid into v_items,v_count,v_cursor from (
   select a.id,a.end_id,a.ordinal,a.label,a.score,a.x,a.y,a.recorded_at from public.training_arrows a
   where a.session_id=p_session and a.deleted_at is null and (p_after is null or a.id>p_after) order by a.id limit 256
  )rows;
 end if;
 return jsonb_build_object('status','accepted','items',v_items,'revision',v_session.revision,'next_cursor',case when v_count=v_limit then v_cursor else null end);
end;$$;
revoke all on function arbat_private.can_read_history(uuid,uuid,uuid,text),arbat_private.history_metadata(public.training_sessions),
 public.training_history_list(uuid,text,date,date,uuid,text),public.training_history_detail(uuid,text,uuid,bigint,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.training_history_list(uuid,text,date,date,uuid,text),public.training_history_detail(uuid,text,uuid,bigint,text,uuid) to service_role;
commit;

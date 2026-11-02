-- Actualización de Historial y entrenadores. Proyecto: qbtdwlcpqcsolubhhkfa.
-- Conserva sesiones, flechas y exportaciones. No activa ni publica páginas.
begin;
do $preconditions$ begin
 if to_regprocedure('public.training_apply_batch(uuid,text,jsonb)') is null then
  raise exception 'Falta la actualización previa de sincronización por lotes. No se realizaron cambios.';
 end if;
end;$preconditions$;
do $install_history$ begin
 if to_regprocedure('public.training_history_list(uuid,text,date,date,uuid,text)') is null then
  execute $history_source$-- Paginated history, service RPCs only; the Edge handler verifies both identities.
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
$history_source$;
 end if;
end;$install_history$;
-- Verified server context, scoped coaching aggregates and managed assignments.
alter table arbat_private.external_identities add column if not exists verified_email text;
alter table arbat_private.role_assignments add column if not exists coach_scope text not null default 'assigned' check (coach_scope in ('assigned','academy'));
insert into arbat_private.schools(id,name) values('a8ba7000-0000-4000-8000-000000000001','arbat') on conflict(id) do nothing;
create index if not exists training_arrows_recorded_idx on public.training_arrows(recorded_at,session_id) where deleted_at is null;

create or replace function arbat_private.can_read_history(p_actor uuid,p_owner uuid,p_school uuid,p_buddy_subject text)
returns boolean language sql stable security definer set search_path='' as $$
 select p_actor=p_owner or (p_buddy_subject is not null and (
  exists(select 1 from arbat_private.role_assignments r where r.user_id=p_actor and r.role='superadmin')
  or exists(select 1 from arbat_private.role_assignments r where r.user_id=p_actor and r.role='admin'
   and (r.school_id=p_school or p_school is null and exists(select 1 from arbat_private.school_members m where m.school_id=r.school_id and m.user_id=p_owner)))
  or exists(select 1 from arbat_private.role_assignments r join arbat_private.school_members m on m.school_id=r.school_id
    where r.user_id=p_actor and r.role='coach' and r.coach_scope='academy' and m.user_id=p_owner and (p_school is null or r.school_id=p_school))
  or exists(select 1 from arbat_private.role_assignments r join arbat_private.coach_athletes c on c.school_id=r.school_id and c.coach_id=r.user_id
    where r.user_id=p_actor and r.role='coach' and c.athlete_id=p_owner and c.active and (p_school is null or r.school_id=p_school))
 ));
$$;
create or replace function arbat_private.training_role(p_actor uuid,p_subject text)
returns text language sql stable security definer set search_path='' as $$
 select case when p_subject is null then 'user'
 when exists(select 1 from arbat_private.role_assignments where user_id=p_actor and role='superadmin') then 'superadmin'
 when exists(select 1 from arbat_private.role_assignments where user_id=p_actor and role='admin') then 'admin'
 when exists(select 1 from arbat_private.role_assignments where user_id=p_actor and role='coach') then 'coach' else 'user' end;
$$;
create or replace function arbat_private.training_coach_ids(p_actor uuid)
returns table(id uuid) language sql stable security definer set search_path='' as $$
 select p.id from public.training_profiles p where p.id<>p_actor
 and not exists(select 1 from arbat_private.principal_links l where l.source_id=p.id and l.target_id<>p.id)
 and (
  exists(select 1 from arbat_private.role_assignments r where r.user_id=p_actor and r.role='superadmin')
   and (exists(select 1 from arbat_private.external_identities e where e.user_id=p.id) or exists(select 1 from public.training_sessions s where s.owner_id=p.id and s.deleted_at is null))
  or exists(select 1 from arbat_private.role_assignments r join arbat_private.school_members m on m.school_id=r.school_id
   where r.user_id=p_actor and r.role='admin' and m.user_id=p.id)
  or exists(select 1 from arbat_private.role_assignments r join arbat_private.school_members m on m.school_id=r.school_id
   where r.user_id=p_actor and r.role='coach' and r.coach_scope='academy' and m.user_id=p.id)
  or exists(select 1 from arbat_private.role_assignments r join arbat_private.coach_athletes c on c.school_id=r.school_id and c.coach_id=r.user_id
   where r.user_id=p_actor and r.role='coach' and c.athlete_id=p.id and c.active)
 );
$$;
create or replace function arbat_private.training_day(p_recorded timestamptz,p_date date,p_timezone text)
returns date language sql stable set search_path='' as $$
 select coalesce((p_recorded at time zone case when p_timezone in ('UTC','America/La_Paz') then p_timezone
  when p_timezone is not null and exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then p_timezone else 'America/La_Paz' end)::date,p_date);
$$;

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
  'actor',jsonb_build_object('id',v_actor,'subject',p_buddy_subject,'name',v_name));
end;$$;

create or replace function public.training_coach_overview(p_principal uuid,p_buddy_subject text,p_from date,p_to date,p_after uuid default null,p_scope_hash text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_role text;v_ids uuid[];v_hash text;v_days jsonb:='[]'::jsonb;v_total bigint:=0;v_roster jsonb;v_count integer;v_cursor uuid;
begin
 if p_buddy_subject is null then raise exception 'buddy_required' using errcode='28000';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>3660 then raise exception 'invalid_range' using errcode='22023';end if;
 v_actor:=arbat_private.ingress_actor(p_principal,p_buddy_subject);v_role:=arbat_private.training_role(v_actor,p_buddy_subject);
 if v_role='user' then raise exception 'coach_required' using errcode='42501';end if;
 if not arbat_private.ingress_allow(v_actor) then return jsonb_build_object('status','rate_limited');end if;
 select coalesce(array_agg(c.id order by c.id),'{}'::uuid[]) into v_ids from arbat_private.training_coach_ids(v_actor) c;
 v_hash:=md5(v_role||v_ids::text);
 if p_scope_hash is not null and p_scope_hash<>v_hash then return jsonb_build_object('status','changed');end if;
 if p_after is null then
  with activity as (
   select arbat_private.training_day(a.recorded_at,s.local_date,s.timezone) as activity_date,
    coalesce(e.session_type,s.session_type)='competition' competition
   from public.training_arrows a join public.training_sessions s on s.id=a.session_id
    left join public.training_ends e on e.id=a.end_id and e.session_id=s.id
   where s.owner_id=any(v_ids) and s.deleted_at is null and a.deleted_at is null and (a.end_id is null or e.deleted_at is null)
    and arbat_private.can_read_history(v_actor,s.owner_id,s.school_id,p_buddy_subject)
    and ((a.recorded_at>=((p_from::timestamp at time zone 'UTC')-interval '1 day') and a.recorded_at<(p_to+2)::timestamp at time zone 'UTC')
      or a.recorded_at is null and s.local_date between p_from and p_to)
  ), daily as (select activity_date,count(*) arrows,bool_or(competition) competition from activity where activity_date between p_from and p_to group by activity_date)
  select coalesce(jsonb_agg(jsonb_build_object('date',activity_date,'arrows',arrows,'has_competition',competition) order by activity_date),'[]'::jsonb),coalesce(sum(arrows),0)
   into v_days,v_total from daily;
 end if;
 with roster as (
  select p.id,coalesce(nullif(p.display_name,''),'Arquero '||right(p.id::text,8)) name,identity.subject,
   case when v_role in ('superadmin','admin') then identity.verified_email else null end email,
   latest.started last_session_at,latest.activity_date last_session_date,coalesce(totals.arrows,0) day_arrows,totals.average day_average
  from public.training_profiles p
   left join lateral(select e.subject,e.verified_email from arbat_private.external_identities e where e.user_id=p.id and e.issuer='https://api.statetty.com' order by e.subject limit 1) identity on true
   left join lateral(
    select coalesce(s.started_at,times.first_arrow) started,coalesce(s.local_date,arbat_private.training_day(times.first_arrow,null,s.timezone)) as activity_date
    from public.training_sessions s
    join lateral(select min(a.recorded_at) first_arrow,max(a.recorded_at) last_arrow,count(*) arrows from public.training_arrows a
     where a.session_id=s.id and a.deleted_at is null)times on times.arrows>0
    where s.owner_id=p.id and s.deleted_at is null and arbat_private.can_read_history(v_actor,s.owner_id,s.school_id,p_buddy_subject)
    order by greatest(s.started_at,s.ended_at,times.last_arrow) desc nulls last,s.local_date desc nulls last,s.id desc limit 1
   ) latest on true
   left join lateral(
    select count(*) arrows,round(avg(a.score)::numeric,2) average
    from public.training_sessions s join public.training_arrows a on a.session_id=s.id
    left join public.training_ends e on e.id=a.end_id and e.session_id=s.id
    where s.owner_id=p.id and s.deleted_at is null and a.deleted_at is null and (a.end_id is null or e.deleted_at is null)
     and arbat_private.can_read_history(v_actor,s.owner_id,s.school_id,p_buddy_subject)
     and arbat_private.training_day(a.recorded_at,s.local_date,s.timezone)=latest.activity_date
   )totals on true
  where p.id=any(v_ids) and (p_after is null or p.id>p_after) order by p.id limit 32
 )
 select coalesce(jsonb_agg(to_jsonb(roster) order by id),'[]'::jsonb),count(*),max(id::text)::uuid into v_roster,v_count,v_cursor from roster;
 return jsonb_build_object('status','accepted','role',v_role,'scope_hash',v_hash,'arrows',case when p_after is null then v_total else null end,
  'days',v_days,'athletes',v_roster,'next_cursor',case when v_count=32 then v_cursor else null end);
end;$$;

create or replace function public.training_coach_manage(p_principal uuid,p_buddy_subject text,p_action text,p_target_email text,p_coach_email text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_role text;v_target uuid;v_coach uuid;v_n integer;v_school uuid:='a8ba7000-0000-4000-8000-000000000001';
begin
 if p_buddy_subject is null then raise exception 'buddy_required' using errcode='28000';end if;
 v_actor:=arbat_private.ingress_actor(p_principal,p_buddy_subject);v_role:=arbat_private.training_role(v_actor,p_buddy_subject);
 if v_role<>'superadmin' and not exists(select 1 from arbat_private.role_assignments where user_id=v_actor and role='admin' and school_id=v_school) then
  raise exception 'admin_required' using errcode='42501';end if;
 if p_action not in ('grant_coach','revoke_coach','assign','unassign') or p_action is null or p_target_email is null or length(p_target_email)>254 then
  raise exception 'invalid_management_request' using errcode='22023';end if;
 if not arbat_private.ingress_allow(v_actor) then return jsonb_build_object('status','rate_limited');end if;
 select min(user_id::text)::uuid,count(distinct user_id) into v_target,v_n from arbat_private.external_identities where issuer='https://api.statetty.com' and verified_email=lower(trim(p_target_email));
 if v_n<>1 then raise exception 'verified_account_required' using errcode='22023';end if;
 if v_role<>'superadmin' and not exists(select 1 from arbat_private.school_members where school_id=v_school and user_id=v_target) then
  raise exception 'outside_school' using errcode='42501';end if;
 insert into arbat_private.school_members(school_id,user_id) values(v_school,v_target) on conflict do nothing;
 if p_action='grant_coach' then
  insert into arbat_private.role_assignments(user_id,role,school_id) values(v_target,'coach',v_school) on conflict do nothing;
 elsif p_action='revoke_coach' then
  delete from arbat_private.role_assignments where user_id=v_target and role='coach' and school_id=v_school;
  update arbat_private.coach_athletes set active=false where coach_id=v_target and school_id=v_school;
 else
  select min(user_id::text)::uuid,count(distinct user_id) into v_coach,v_n from arbat_private.external_identities where issuer='https://api.statetty.com' and verified_email=lower(trim(p_coach_email));
  if v_n<>1 or not exists(select 1 from arbat_private.role_assignments where user_id=v_coach and role='coach' and school_id=v_school) then
   raise exception 'verified_coach_required' using errcode='22023';end if;
  if v_coach=v_target then raise exception 'self_assignment' using errcode='22023';end if;
  insert into arbat_private.coach_athletes(school_id,coach_id,athlete_id,active) values(v_school,v_coach,v_target,p_action='assign')
   on conflict(school_id,coach_id,athlete_id) do update set active=excluded.active;
 end if;
 insert into arbat_private.audit_events(actor_id,action,subject_id,details) values(v_actor,'coach.'||p_action,v_target,jsonb_build_object('coach_id',v_coach,'school_id',v_school));
 return jsonb_build_object('status','accepted');
end;$$;
revoke all on function arbat_private.training_role(uuid,text),arbat_private.training_coach_ids(uuid),arbat_private.training_day(timestamptz,date,text),
 public.training_history_context(uuid,text,text,text),public.training_coach_overview(uuid,text,date,date,uuid,text),public.training_coach_manage(uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.training_history_context(uuid,text,text,text),public.training_coach_overview(uuid,text,date,date,uuid,text),public.training_coach_manage(uuid,text,text,text,text) to service_role;

commit;
select 'historial_y_entrenadores_preparados' as estado;

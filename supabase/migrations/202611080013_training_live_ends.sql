-- Completed ends and the selected dates drive coaching. Expiry is computed on read
-- so devices can still replay offline arrows before sending their session.close.
begin;

create or replace function arbat_private.training_effective_end(s public.training_sessions)
returns timestamptz language plpgsql stable set search_path='' as $$
declare zone text; midnight timestamptz;
begin
 if s.ended_at is not null then return s.ended_at; end if;
 if s.local_date is null then return null; end if;
 if s.timezone in ('UTC','America/La_Paz') then zone:=s.timezone;
 elsif s.timezone is not null then select name into zone from pg_catalog.pg_timezone_names where name=s.timezone; end if;
 zone:=coalesce(zone,'America/La_Paz');
 midnight:=(s.local_date+1)::timestamp at time zone zone;
 if now()<midnight then return null; end if;
 if exists(select 1 from public.training_arrows a where a.session_id=s.id and a.deleted_at is null
  and a.recorded_at>=midnight-interval '30 minutes' and a.recorded_at<midnight) then
  midnight:=(s.local_date+2)::timestamp at time zone zone;
 end if;
 return case when now()>=midnight then greatest(midnight,s.started_at) end;
end;$$;
revoke all on function arbat_private.training_effective_end(public.training_sessions) from public,anon,authenticated;

create or replace function arbat_private.history_metadata(s public.training_sessions)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',s.id,'legacy_session_id',s.legacy_session_id,'owner_id',s.owner_id,
  'date',s.local_date,'timezone',s.timezone,'startedAt',s.started_at,'endedAt',arbat_private.training_effective_end(s),'sessionType',s.session_type,
  'arrowsPerEnd',s.arrows_per_end,'shootingDistance',s.shooting_distance,'targetSize',s.target_size,
  'notes',s.notes,'revision',s.revision,'deletedAt',s.deleted_at);
$$;
create or replace function arbat_private.training_session_in_period(s public.training_sessions,p_from date,p_to date)
returns boolean language sql stable set search_path='' as $$
 select coalesce(s.local_date between p_from and p_to,false) or exists(
  select 1 from public.training_arrows a where a.session_id=s.id and a.deleted_at is null
   and a.recorded_at>=((p_from::timestamp at time zone 'UTC')-interval '1 day')
   and a.recorded_at<(p_to+2)::timestamp at time zone 'UTC'
   and arbat_private.training_day(a.recorded_at,s.local_date,s.timezone) between p_from and p_to
 );
$$;
revoke all on function arbat_private.training_session_in_period(public.training_sessions,date,date) from public,anon,authenticated;

create or replace function public.training_history_list(p_principal uuid,p_buddy_subject text,p_from date,p_to date,p_after uuid default null,p_target_subject text default null)
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
  select s.* from public.training_sessions s where s.owner_id=v_target and arbat_private.training_session_in_period(s,p_from,p_to)
   and (p_after is null or s.id>p_after) and arbat_private.can_read_history(v_actor,s.owner_id,s.school_id,p_buddy_subject)
  order by s.id limit 8
 ) rows;
 return jsonb_build_object('status','accepted','sessions',v_items,'next_cursor',case when v_count=8 then v_cursor else null end);
end;$$;

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
  select s.* from public.training_sessions s where arbat_private.training_session_in_period(s,p_from,p_to) and (p_after is null or s.id>p_after)
   and arbat_private.can_read_history(v_actor,s.owner_id,s.school_id,p_buddy_subject)
  order by s.id limit 8
 ) rows left join public.training_profiles p on p.id=rows.owner_id;
 return jsonb_build_object('status','accepted','sessions',v_items,'next_cursor',case when v_count=8 then v_cursor else null end);
end;$$;

create or replace function public.training_coach_overview(p_principal uuid,p_buddy_subject text,p_from date,p_to date,p_after uuid default null,p_scope_hash text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid;v_role text;v_ids uuid[];v_hash text;
 v_days jsonb;v_total bigint;v_roster jsonb;v_count integer;v_cursor uuid;v_version text;
begin
 if p_buddy_subject is null then raise exception 'buddy_required' using errcode='28000';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>3660 then raise exception 'invalid_range' using errcode='22023';end if;
 v_actor:=arbat_private.ingress_actor(p_principal,p_buddy_subject);v_role:=arbat_private.training_role(v_actor,p_buddy_subject);
 if v_role='user' then raise exception 'coach_required' using errcode='42501';end if;
 if not arbat_private.ingress_allow(v_actor) then return jsonb_build_object('status','rate_limited');end if;
 select coalesce(array_agg(c.id order by c.id),'{}'::uuid[]) into v_ids from arbat_private.training_coach_ids(v_actor) c;
 v_hash:=md5(v_role||v_ids::text);
 if p_scope_hash is not null and p_scope_hash<>v_hash then return jsonb_build_object('status','changed');end if;

 with roster_ids as (
  select p.id,p.display_name from public.training_profiles p
  where p.id=any(v_ids) and (p_after is null or p.id>p_after) order by p.id limit 32
 ), candidate_arrows as materialized (
  select s.id as session_id,s.owner_id,coalesce(s.started_at,a.recorded_at) as started,
   arbat_private.training_day(a.recorded_at,s.local_date,s.timezone) as activity_date,
   coalesce(e.session_type,s.session_type)='competition' as competition,
   a.id,a.revision,a.score,a.end_id
  from public.training_arrows a join public.training_sessions s on s.id=a.session_id
  left join public.training_ends e on e.id=a.end_id and e.session_id=s.id
  where (p_after is null and (s.owner_id=any(v_ids) or s.owner_id=v_actor)
    or p_after is not null and s.owner_id in (select id from roster_ids))
   and s.deleted_at is null and a.deleted_at is null and (a.end_id is null or e.deleted_at is null)
   and arbat_private.can_read_history(v_actor,s.owner_id,s.school_id,p_buddy_subject)
   and ((a.recorded_at>=((p_from::timestamp at time zone 'UTC')-interval '1 day') and a.recorded_at<(p_to+2)::timestamp at time zone 'UTC')
     or a.recorded_at is null and s.local_date between p_from and p_to)
 ), session_ends as materialized (
  select s.id as session_id,arbat_private.training_effective_end(s) as ended
  from public.training_sessions s join (select distinct session_id from candidate_arrows
   where activity_date between p_from and p_to) relevant on relevant.session_id=s.id
 ), activity as materialized (
  select a.*,e.ended from candidate_arrows a join session_ends e using(session_id)
  where a.activity_date between p_from and p_to and (a.end_id is not null or e.ended is not null)
 ), daily as (
  select activity_date,count(*) arrows,bool_or(competition) has_competition
  from activity where owner_id<>v_actor group by activity_date
 ), latest as (
  select distinct on (owner_id) owner_id,started,activity_date
  from activity where owner_id in (select id from roster_ids)
  order by owner_id,activity_date desc,started desc nulls last,session_id desc
 ), totals as (
  select a.owner_id,count(*) arrows,sum(a.score) points,round(avg(a.score)::numeric,2) average
  from activity a join latest l on l.owner_id=a.owner_id and l.activity_date=a.activity_date group by a.owner_id
 ), roster as (
  select p.id,coalesce(nullif(p.display_name,''),'Arquero '||right(p.id::text,8)) name,identity.subject,
   case when v_role in ('superadmin','admin') then identity.verified_email end email,
   l.started last_session_at,l.activity_date last_session_date,coalesce(t.arrows,0) day_arrows,t.points day_points,t.average day_average
  from roster_ids p
  left join lateral(select e.subject,e.verified_email from arbat_private.external_identities e where e.user_id=p.id and e.issuer='https://api.statetty.com' order by e.subject limit 1) identity on true
  left join latest l on l.owner_id=p.id left join totals t on t.owner_id=p.id
 )
 select
  (select coalesce(jsonb_agg(to_jsonb(d) order by activity_date),'[]'::jsonb) from daily d),
  (select coalesce(sum(arrows),0) from daily),
  (select count(*)::text||':'||coalesce(bit_xor(hashtextextended(concat_ws('|',id,revision,end_id,extract(epoch from ended)),0)),0)::text from activity),
  coalesce(jsonb_agg(to_jsonb(roster) order by id),'[]'::jsonb),count(*),max(id::text)::uuid
 into v_days,v_total,v_version,v_roster,v_count,v_cursor from roster;

 return jsonb_build_object('status','accepted','role',v_role,'scope_hash',v_hash,
  'activity_version',case when p_after is null then v_version end,
  'arrows',case when p_after is null then v_total end,
  'days',case when p_after is null then v_days else '[]'::jsonb end,'athletes',v_roster,
  'next_cursor',case when v_count=32 then v_cursor end);
end;$$;
revoke all on function public.training_history_list(uuid,text,date,date,uuid,text),
 public.training_history_all(uuid,text,date,date,uuid),public.training_coach_overview(uuid,text,date,date,uuid,text)
 from public,anon,authenticated;
grant execute on function public.training_history_list(uuid,text,date,date,uuid,text),
 public.training_history_all(uuid,text,date,date,uuid),public.training_coach_overview(uuid,text,date,date,uuid,text)
 to service_role;
commit;

-- Buddy contact data is private. Cross-account contact visibility follows the
-- administrative scope and the coach's active assignments.
begin;
alter table arbat_private.external_identities add column if not exists profile_phone text
 check (profile_phone is null or (char_length(profile_phone)<=32 and profile_phone ~ '^[+0-9(). -]+$'));

-- Keep the original four-argument RPC for callers without a Buddy profile.
create or replace function public.training_history_context(
 p_principal uuid,p_buddy_subject text,p_display_name text,p_verified_email text,p_profile_phone text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.training_history_context(p_principal,p_buddy_subject,p_display_name,p_verified_email);
 if result->>'status'='accepted' and p_buddy_subject is not null then
  update arbat_private.external_identities
   set profile_phone=p_profile_phone
   where issuer='https://api.statetty.com' and subject=p_buddy_subject
     and user_id=(result->'actor'->>'id')::uuid
     and profile_phone is distinct from p_profile_phone;
 end if;
 return result;
end;$$;
revoke all on function public.training_history_context(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.training_history_context(uuid,text,text,text,text) to service_role;

create or replace function public.training_coach_overview(p_principal uuid,p_buddy_subject text,p_from date,p_to date,p_after uuid default null,p_scope_hash text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid;v_role text;v_ids uuid[];v_contact_ids uuid[]:='{}';v_hash text;
 v_days jsonb;v_total bigint;v_roster jsonb;v_count integer;v_cursor uuid;v_version text;
begin
 if p_buddy_subject is null then raise exception 'buddy_required' using errcode='28000';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>3660 then raise exception 'invalid_range' using errcode='22023';end if;
 v_actor:=arbat_private.ingress_actor(p_principal,p_buddy_subject);v_role:=arbat_private.training_role(v_actor,p_buddy_subject);
 if v_role='user' then raise exception 'coach_required' using errcode='42501';end if;
 if not arbat_private.ingress_allow(v_actor) then return jsonb_build_object('status','rate_limited');end if;
 select coalesce(array_agg(c.id order by c.id),'{}'::uuid[]) into v_ids from arbat_private.training_coach_ids(v_actor) c;
 if v_role='coach' then
  select coalesce(array_agg(distinct c.athlete_id order by c.athlete_id),'{}'::uuid[])
   into v_contact_ids
   from arbat_private.coach_athletes c
   join arbat_private.role_assignments r on r.user_id=c.coach_id and r.school_id=c.school_id and r.role='coach'
   where c.coach_id=v_actor and c.active and c.athlete_id=any(v_ids);
 end if;
 -- Contact revocation must invalidate the cached roster even for academy-wide coaches.
 v_hash:=md5(v_role||v_ids::text||v_contact_ids::text);
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
   access.can_view_contact,
   case when access.can_view_contact then identity.verified_email end email,
   case when access.can_view_contact then identity.profile_phone end phone,
   l.started last_session_at,l.activity_date last_session_date,coalesce(t.arrows,0) day_arrows,t.points day_points,t.average day_average
  from roster_ids p
  cross join lateral (
   select v_role in ('superadmin','admin') or p.id=any(v_contact_ids) as can_view_contact
  ) access
  left join lateral(select e.subject,e.verified_email,e.profile_phone from arbat_private.external_identities e where e.user_id=p.id and e.issuer='https://api.statetty.com' order by e.subject limit 1) identity on true
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
commit;

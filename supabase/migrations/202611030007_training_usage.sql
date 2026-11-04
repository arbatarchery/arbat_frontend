-- City-only usage. Apply AFTER migrations 001–006. No public table access.
begin;
create table arbat_private.usage_events (
 id uuid primary key, kind text not null check(kind in ('history_open','end_location')),
 browser_id uuid not null, actor_id uuid references public.training_profiles(id),
 school_id uuid not null references arbat_private.schools(id),
 session_id uuid references public.training_sessions(id),end_id uuid references public.training_ends(id),
 occurred_at timestamptz not null, observed_at timestamptz not null, received_at timestamptz not null default now(),
 city text check(length(city)<=120),region text check(length(region)<=120),country text check(country ~ '^[A-Z]{2}$'),
 observation_context text not null check(observation_context in ('completion','at_sync')),
 check ((kind='history_open' and session_id is null and end_id is null) or (kind='end_location' and session_id is not null and end_id is not null))
);
create unique index usage_one_end on arbat_private.usage_events(end_id) where kind='end_location';
create index usage_period on arbat_private.usage_events(school_id,occurred_at);
create index usage_actor on arbat_private.usage_events(actor_id,occurred_at);
create table arbat_private.usage_limits(rate_key text not null,bucket timestamptz not null,n integer not null,primary key(rate_key,bucket));
alter table arbat_private.usage_events enable row level security;
alter table arbat_private.usage_limits enable row level security;
revoke all on arbat_private.usage_events,arbat_private.usage_limits from public,anon,authenticated,service_role;

create function public.training_record_usage(p_principal uuid,p_buddy_subject text,p_event jsonb,p_rate_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_school uuid:='a8ba7000-0000-4000-8000-000000000001';v_old arbat_private.usage_events%rowtype;
 v_id uuid;v_browser uuid;v_session uuid;v_end uuid;v_kind text;v_time timestamptz;v_observed timestamptz;v_count integer;
begin
 if p_event is null or jsonb_typeof(p_event)<>'object' or p_rate_key is null or p_rate_key !~ '^[-_A-Za-z0-9]{43}$'
 or exists(select 1 from jsonb_object_keys(p_event) k where k not in ('event_id','browser_id','kind','occurred_at','observed_at','session_id','end_id','city','region','country')) then raise exception 'invalid_event' using errcode='22023';end if;
 v_id:=(p_event->>'event_id')::uuid;v_browser:=(p_event->>'browser_id')::uuid;v_kind:=p_event->>'kind';
 v_time:=(p_event->>'occurred_at')::timestamptz;v_observed:=(p_event->>'observed_at')::timestamptz;
 v_session:=(p_event->>'session_id')::uuid;v_end:=(p_event->>'end_id')::uuid;
 if v_id is null or v_browser is null or v_kind is null or v_kind not in ('history_open','end_location') or v_time is null or v_observed is null
 or v_time>now()+interval '1 minute' or v_time<now()-interval '1 year' or v_observed>now()+interval '1 minute' or v_observed<now()-interval '7 days' then raise exception 'invalid_event' using errcode='22023';end if;
 if p_principal is not null then v_actor:=arbat_private.ingress_actor(p_principal,p_buddy_subject);elsif p_buddy_subject is not null then raise exception 'identity_required' using errcode='28000';end if;
 if v_kind='end_location' then
  if v_actor is null then raise exception 'identity_required' using errcode='28000';end if;
  select coalesce(s.school_id,v_school) into v_school from public.training_sessions s join public.training_ends e on e.session_id=s.id
   where s.id=v_session and e.id=v_end and s.owner_id=v_actor and s.deleted_at is null and e.deleted_at is null;
  if not found then return jsonb_build_object('status','session_pending');end if;
 elsif v_session is not null or v_end is not null then raise exception 'invalid_event' using errcode='22023';end if;
 -- Serialize duplicates and actor promotion for this event before checking identity.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id::text,7));
 select * into v_old from arbat_private.usage_events where id=v_id;
 if found then
  if v_old.browser_id<>v_browser or v_old.kind<>v_kind or v_old.occurred_at<>v_time or v_old.session_id is distinct from v_session or v_old.end_id is distinct from v_end then raise exception 'event_conflict' using errcode='22023';end if;
  if v_old.actor_id is null and v_actor is not null then update arbat_private.usage_events set actor_id=v_actor where id=v_id;
  elsif v_old.actor_id is not null and v_actor is not null and v_old.actor_id<>v_actor
   and not exists(select 1 from arbat_private.principal_links where source_id=v_old.actor_id and target_id=v_actor) then raise exception 'event_owner' using errcode='42501';end if;
  return jsonb_build_object('status','accepted','event_id',v_id);
 end if;
 -- Independent quotas, so usage cannot consume the arrow-ingestion allowance.
 insert into arbat_private.usage_limits values(p_rate_key,date_trunc('minute',now()),1) on conflict(rate_key,bucket) do update set n=arbat_private.usage_limits.n+1 returning n into v_count;
 if v_count>60 then return jsonb_build_object('status','rate_limited');end if;
 if (select coalesce(sum(n),0) from arbat_private.usage_limits where rate_key=p_rate_key and bucket>=date_trunc('day',now()))>5000 then return jsonb_build_object('status','rate_limited');end if;
 delete from arbat_private.usage_limits where bucket<now()-interval '2 days';
 insert into arbat_private.usage_events(id,kind,browser_id,actor_id,school_id,session_id,end_id,occurred_at,observed_at,city,region,country,observation_context)
 values(v_id,v_kind,v_browser,v_actor,v_school,v_session,v_end,v_time,v_observed,nullif(trim(p_event->>'city'),''),nullif(trim(p_event->>'region'),''),p_event->>'country',
 case when abs(extract(epoch from(v_time-v_observed)))<=120 then 'completion' else 'at_sync' end)
 on conflict do nothing;
 return jsonb_build_object('status','accepted','event_id',v_id);
end;$$;

create function public.training_usage_summary(p_principal uuid,p_buddy_subject text,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid;v_role text;v_result jsonb;
begin
 if p_buddy_subject is null then raise exception 'buddy_required' using errcode='28000';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 then raise exception 'invalid_range' using errcode='22023';end if;
 v_actor:=arbat_private.ingress_actor(p_principal,p_buddy_subject);v_role:=arbat_private.training_role(v_actor,p_buddy_subject);
 if v_role not in ('admin','superadmin') then raise exception 'admin_required' using errcode='42501';end if;
 if not arbat_private.ingress_allow(v_actor) then return jsonb_build_object('status','rate_limited');end if;
 with scoped as materialized (
  select u.*,coalesce(l.target_id,u.actor_id) owner,lower(trim(coalesce(u.country,'')||'|'||coalesce(u.region,'')||'|'||u.city)) city_key,
  (u.occurred_at at time zone 'America/La_Paz')::date as activity_date from arbat_private.usage_events u
  left join arbat_private.principal_links l on l.source_id=u.actor_id
  where v_role='superadmin' or exists(select 1 from arbat_private.role_assignments r where r.user_id=v_actor and r.role='admin' and r.school_id=u.school_id)
 ), period as materialized(select * from scoped where activity_date between p_from and p_to),
 cities as (select city,region,country,count(*) filter(where kind='history_open') opens,count(*) filter(where kind='end_location') ends,max(observed_at) last_seen
  from period where city is not null group by city,region,country order by count(*) desc,city,region,country limit 50),
 visitors as (select case when owner is not null then 'account:'||owner::text else 'browser:'||browser_id::text end visitor,
  max(owner::text)::uuid owner,count(*) opens,count(distinct activity_date) days,count(distinct browser_id) browsers,
  count(distinct city_key) filter(where city is not null) cities,count(distinct country) countries,max(occurred_at) last_open,
  (array_agg(city order by occurred_at desc,id desc) filter(where city is not null))[1] last_city
  from period where kind='history_open' group by 1 order by max(occurred_at) desc limit 100),
 located as materialized(select * from scoped where kind='end_location' and city is not null and observation_context='completion'),
 session_city as (select session_id,owner,min(occurred_at) first_at,max(occurred_at) last_at,count(distinct city_key) cities,array_agg(distinct city order by city) cities_observed,
  (array_agg(city_key order by occurred_at,id))[1] first_key,(array_agg(city_key order by occurred_at desc,id desc))[1] last_key,
  (array_agg(city order by occurred_at,id))[1] first_city,(array_agg(city order by occurred_at desc,id desc))[1] last_city
  from located group by session_id,owner),
 compared as (select *,lag(last_key) over(partition by owner order by first_at,session_id) prev_key,
  lag(last_city) over(partition by owner order by first_at,session_id) prev_city from session_city),
 alerts as (select session_id,owner,first_at,case when cities>1 then 'within_session' else 'between_sessions' end kind,
  case when cities>1 then first_city else prev_city end previous_city,last_city city,cities_observed from compared
  where (first_at at time zone 'America/La_Paz')::date between p_from and p_to
  and (cities>1 or prev_key is not null and prev_key<>first_key) order by first_at desc limit 50)
 select jsonb_build_object('status','accepted','role',v_role,'timezone','America/La_Paz',
 'totals',(select jsonb_build_object('opens',count(*) filter(where kind='history_open'),'accounts',count(distinct owner) filter(where kind='history_open'),
 'anonymous_browsers',count(distinct browser_id) filter(where kind='history_open' and owner is null),'cities',count(distinct city_key) filter(where city is not null),'countries',count(distinct country)) from period),
 'cities',coalesce((select jsonb_agg(to_jsonb(c)) from cities c),'[]'::jsonb),
 'visitors',coalesce((select jsonb_agg((to_jsonb(v)||jsonb_build_object('name',coalesce(nullif(p.display_name,''),case when v.owner is null then 'Navegador anónimo' else 'Arquero' end)))-'owner'-'visitor') from visitors v left join public.training_profiles p on p.id=v.owner),'[]'::jsonb),
 'alerts',coalesce((select jsonb_agg((to_jsonb(a)||jsonb_build_object('name',coalesce(nullif(p.display_name,''),'Arquero')))-'owner') from alerts a left join public.training_profiles p on p.id=a.owner),'[]'::jsonb),
 'limits',jsonb_build_object('cities',50,'visitors',100,'alerts',50)) into v_result;
 return v_result;
end;$$;
revoke all on function public.training_record_usage(uuid,text,jsonb,text),public.training_usage_summary(uuid,text,date,date) from public,anon,authenticated;
grant execute on function public.training_record_usage(uuid,text,jsonb,text),public.training_usage_summary(uuid,text,date,date) to service_role;
commit;

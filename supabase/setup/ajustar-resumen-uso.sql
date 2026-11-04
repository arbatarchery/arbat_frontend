-- Ajuste del resumen administrativo, conserva todos los eventos.
begin;
create or replace function public.training_usage_summary(p_principal uuid,p_buddy_subject text,p_from date,p_to date)
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
commit;

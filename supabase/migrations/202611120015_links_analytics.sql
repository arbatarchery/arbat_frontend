begin;

create table arbat_private.links_events (
  id uuid primary key,
  kind text not null check (kind in ('open','whatsapp','training','maps','tiktok','instagram','facebook','home')),
  received_at timestamptz not null default now()
);
create index links_events_period on arbat_private.links_events(received_at);
alter table arbat_private.links_events enable row level security;
revoke all on arbat_private.links_events from public,anon,authenticated,service_role;

create function public.training_record_links(p_id uuid,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_bucket timestamptz := date_trunc('minute',now());
  v_count integer;
begin
  if p_id is null or p_kind is null or p_kind not in ('open','whatsapp','training','maps','tiktok','instagram','facebook','home') then
    raise exception 'invalid_links_event' using errcode='22023';
  end if;

  -- Use a separate aggregate quota for anonymous site traffic.
  insert into arbat_private.usage_limits as limits(rate_key,bucket,n)
  values('site-links',v_bucket,1)
  on conflict(rate_key,bucket) do update set n=limits.n+1 where limits.n<600
  returning n into v_count;
  if v_count is null then return jsonb_build_object('status','rate_limited'); end if;
  if v_count=1 then
    delete from arbat_private.usage_limits where rate_key='site-links' and bucket<v_bucket-interval '2 days';
  end if;

  insert into arbat_private.links_events(id,kind) values(p_id,p_kind) on conflict(id) do nothing;
  return jsonb_build_object('status','accepted','event_id',p_id);
end;
$$;

-- Preserve the history report, its range validation, and its quota.
alter function public.training_usage_summary(uuid,text,date,date) set schema arbat_private;
revoke all on function arbat_private.training_usage_summary(uuid,text,date,date) from public,anon,authenticated,service_role;

create function public.training_usage_summary(p_principal uuid,p_buddy_subject text,p_from date,p_to date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_report jsonb;
  v_counts jsonb;
begin
  v_report := arbat_private.training_usage_summary(p_principal,p_buddy_subject,p_from,p_to);
  if v_report->>'status' is distinct from 'accepted' then return v_report; end if;

  -- /links belongs to Arbat's school. Keep the same school scope as the admin report.
  if v_report->>'role'='superadmin' or (v_report->>'role'='admin' and exists(
    select 1 from arbat_private.role_assignments
    where user_id=arbat_private.ingress_actor(p_principal,p_buddy_subject)
      and role='admin' and school_id='a8ba7000-0000-4000-8000-000000000001'
  )) then
    select jsonb_build_object(
      'open',count(*) filter(where kind='open'),
      'whatsapp',count(*) filter(where kind='whatsapp'),
      'training',count(*) filter(where kind='training'),
      'maps',count(*) filter(where kind='maps'),
      'tiktok',count(*) filter(where kind='tiktok'),
      'instagram',count(*) filter(where kind='instagram'),
      'facebook',count(*) filter(where kind='facebook'),
      'home',count(*) filter(where kind='home')
    ) into v_counts
    from arbat_private.links_events
    where received_at >= (p_from::timestamp at time zone 'America/La_Paz')
      and received_at < ((p_to+1)::timestamp at time zone 'America/La_Paz');
    v_report := v_report || jsonb_build_object('links',v_counts);
  end if;
  return v_report;
end;
$$;

revoke all on function public.training_record_links(uuid,text),public.training_usage_summary(uuid,text,date,date) from public,anon,authenticated;
grant execute on function public.training_record_links(uuid,text),public.training_usage_summary(uuid,text,date,date) to service_role;
commit;

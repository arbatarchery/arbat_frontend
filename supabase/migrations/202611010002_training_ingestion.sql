-- Server RPCs only; caller identity MUST be verified by the Edge handler.
begin;
create table arbat_private.principal_links (
  source_id uuid primary key references public.training_profiles(id),
  target_id uuid not null references public.training_profiles(id),
  linked_at timestamptz not null default now()
);
create table arbat_private.ingress_limits (
  principal_id uuid not null references public.training_profiles(id),
  window_start timestamptz not null,
  requests integer not null check (requests > 0),
  primary key (principal_id, window_start)
);
alter table arbat_private.principal_links enable row level security;
alter table arbat_private.ingress_limits enable row level security;
revoke all on arbat_private.principal_links, arbat_private.ingress_limits from public,anon,authenticated,service_role;

create function arbat_private.ingress_actor(p_principal uuid, p_subject text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_link uuid;
begin
  if not exists(select 1 from auth.users where id=p_principal) then raise exception 'invalid_principal' using errcode='28000'; end if;
  insert into public.training_profiles(id) values(p_principal) on conflict do nothing;
  select target_id into v_link from arbat_private.principal_links where source_id=p_principal;
  if p_subject is null then
    if v_link is not null or exists(select 1 from arbat_private.external_identities where user_id=p_principal) then
      raise exception 'buddy_required' using errcode='28000';
    end if;
    return p_principal;
  end if;
  select user_id into v_actor from arbat_private.external_identities
    where issuer='https://api.statetty.com' and subject=p_subject;
  if v_actor is null or v_link is distinct from v_actor then raise exception 'claim_required' using errcode='28000'; end if;
  return v_actor;
end; $$;

create function arbat_private.ingress_allow(p_principal uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  delete from arbat_private.ingress_limits where principal_id=p_principal and window_start < now()-interval '1 day';
  insert into arbat_private.ingress_limits values(p_principal,date_trunc('minute',now()),1)
    on conflict(principal_id,window_start) do update set requests=arbat_private.ingress_limits.requests+1
    returning requests into v_count;
  return v_count <= 120;
end; $$;

create function public.training_claim(p_principal uuid, p_buddy_subject text, p_proof_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_target uuid; v_link uuid; v_count integer; v_existing_subject text;
begin
  if p_principal is null or p_buddy_subject is null or length(trim(p_buddy_subject)) not between 1 and 256
     or p_proof_hash is null or p_proof_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_claim' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('arbat-principal:'||p_principal::text,0));
  if not exists(select 1 from auth.users where id=p_principal) then raise exception 'invalid_principal' using errcode='28000'; end if;
  insert into public.training_profiles(id) values(p_principal) on conflict do nothing;
  if not arbat_private.ingress_allow(p_principal) then return jsonb_build_object('status','rate_limited'); end if;
  perform pg_advisory_xact_lock(hashtextextended('arbat-buddy:'||p_buddy_subject,0));
  select target_id into v_link from arbat_private.principal_links where source_id=p_principal;
  select user_id into v_target from arbat_private.external_identities
    where issuer='https://api.statetty.com' and subject=p_buddy_subject;
  if v_link is not null then
    if v_link is distinct from v_target then raise exception 'principal_already_linked' using errcode='28000'; end if;
    return jsonb_build_object('status','accepted','owner_id',v_target,'replayed',true,'sessions_claimed',0);
  end if;
  if v_target is not null and v_target<>p_principal and not arbat_private.ingress_allow(v_target) then
    return jsonb_build_object('status','rate_limited');
  end if;
  -- Never convert a principal belonging to a different verified Buddy identity.
  select subject into v_existing_subject from arbat_private.external_identities where user_id=p_principal limit 1;
  if v_existing_subject is not null then raise exception 'principal_already_linked' using errcode='28000'; end if;
  if v_target is null then
    v_target:=p_principal;
    insert into arbat_private.external_identities(issuer,subject,user_id)
      values('https://api.statetty.com',p_buddy_subject,v_target);
  elsif v_target <> p_principal then
    -- Transfer only an actual anonymous Supabase principal, never a permanent account.
    if not exists(select 1 from auth.users where id=p_principal and is_anonymous=true) then
      raise exception 'source_not_anonymous' using errcode='28000';
    end if;
  end if;
  -- Guest ingestion cannot assign schools. Fail closed if out-of-band data has one.
  if v_target <> p_principal and exists(select 1 from public.training_sessions where owner_id=p_principal and school_id is not null) then
    raise exception 'scoped_source_not_claimable' using errcode='28000';
  end if;
  if v_target <> p_principal and (
    (select count(*) from public.training_sessions where owner_id in (p_principal,v_target))>10000
    or (select count(*) from public.training_arrows a join public.training_sessions s on s.id=a.session_id
      where s.owner_id in (p_principal,v_target))>500000
  ) then return jsonb_build_object('status','quota_exceeded'); end if;
  update public.training_sessions set owner_id=v_target,updated_at=now() where owner_id=p_principal;
  get diagnostics v_count = row_count;
  insert into arbat_private.principal_links(source_id,target_id) values(p_principal,v_target);
  if v_target <> p_principal then
    insert into arbat_private.anonymous_claims(anonymous_id,target_id,proof_hash,expires_at,consumed_at)
      values(p_principal,v_target,p_proof_hash,now()+interval '5 minutes',now());
  end if;
  -- Keep receipts under original principal: retries of pre-claim operations remain idempotent.
  insert into arbat_private.audit_events(actor_id,action,subject_id,details)
    values(v_target,'anonymous.claim',p_principal,jsonb_build_object('sessions',v_count));
  return jsonb_build_object('status','accepted','owner_id',v_target,'replayed',false,'sessions_claimed',v_count);
end; $$;

create function public.training_apply_operation(p_principal uuid, p_buddy_subject text, p_operation jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid; v_id uuid; v_session uuid; v_entity uuid; v_kind text; v_base bigint;
  v_payload jsonb; v_hash text; v_receipt arbat_private.sync_operations%rowtype;
  v_row public.training_sessions%rowtype; v_revision bigint; v_allowed text[];
begin
  if p_principal is null or jsonb_typeof(p_operation) is distinct from 'object'
     or octet_length(p_operation::text)>32768 then raise exception 'invalid_operation' using errcode='22023'; end if;
  if p_operation - array['operation_id','session_id','entity_id','kind','base_revision','payload'] <> '{}'::jsonb then
    raise exception 'unknown_operation_fields' using errcode='22023'; end if;
  v_id:=(p_operation->>'operation_id')::uuid; v_session:=(p_operation->>'session_id')::uuid;
  v_entity:=(p_operation->>'entity_id')::uuid; v_kind:=p_operation->>'kind';
  v_base:=(p_operation->>'base_revision')::bigint; v_payload:=p_operation->'payload';
  if v_id is null or v_session is null or v_entity is null or v_base is null or v_base<0
    or jsonb_typeof(v_payload) is distinct from 'object' then raise exception 'invalid_operation' using errcode='22023'; end if;
  v_allowed:=case v_kind
    when 'session.upsert' then array['legacy_session_id','local_date','timezone','started_at','session_type','arrows_per_end','shooting_distance','target_size','notes']
    when 'session.close' then array['ended_at']
    when 'end.upsert' then array['ordinal','ended_at','arrow_limit','session_type','shooting_distance','target_size','notes']
    when 'arrow.upsert' then array['end_id','ordinal','label','score','x','y','recorded_at']
    when 'arrow.delete' then array[]::text[] else null end;
  if v_allowed is null or v_payload-v_allowed <> '{}'::jsonb then raise exception 'invalid_payload_fields' using errcode='22023'; end if;
  if v_kind in ('session.upsert','session.close') and v_entity<>v_session then raise exception 'invalid_entity' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('arbat-principal:'||p_principal::text,0));
  v_actor:=arbat_private.ingress_actor(p_principal,p_buddy_subject);
  if not arbat_private.ingress_allow(v_actor) then return jsonb_build_object('status','rate_limited'); end if;
  perform pg_advisory_xact_lock(hashtextextended('arbat-session:'||v_session::text,0));
  select * into v_row from public.training_sessions where id=v_session for update;
  if v_row.id is not null and v_row.owner_id<>v_actor then raise exception 'not_owner' using errcode='42501'; end if;
  v_hash:=encode(sha256(convert_to(p_operation::text,'UTF8')),'hex');
  select * into v_receipt from arbat_private.sync_operations where principal_id=p_principal and operation_id=v_id;
  if v_receipt.operation_id is not null then
    if v_receipt.payload_hash<>v_hash then raise exception 'operation_id_reused' using errcode='22023'; end if;
    return jsonb_build_object('status','accepted','revision',v_receipt.confirmed_revision,'replayed',true);
  end if;
  if coalesce(v_row.revision,0)<>v_base then
    return jsonb_build_object('status','conflict','revision',coalesce(v_row.revision,0));
  end if;
  if v_row.id is null and v_kind<>'session.upsert' then raise exception 'session_missing' using errcode='22023'; end if;
  if v_row.ended_at is not null then raise exception 'session_closed' using errcode='22023'; end if;
  if v_row.deleted_at is not null then raise exception 'session_deleted' using errcode='22023'; end if;
  v_revision:=v_base+1;
  if v_kind='session.upsert' then
    if v_row.id is null and (select count(*) from public.training_sessions where owner_id=v_actor)>=
      (case when p_buddy_subject is null then 100 else 10000 end) then
      return jsonb_build_object('status','quota_exceeded');
    end if;
    insert into public.training_sessions(id,owner_id,legacy_session_id,local_date,timezone,started_at,session_type,arrows_per_end,shooting_distance,target_size,notes,revision)
    values(v_session,v_actor,v_payload->>'legacy_session_id',(v_payload->>'local_date')::date,v_payload->>'timezone',
      (v_payload->>'started_at')::timestamptz,coalesce(v_payload->>'session_type','training'),(v_payload->>'arrows_per_end')::smallint,
      v_payload->>'shooting_distance',v_payload->>'target_size',coalesce(v_payload->>'notes',''),v_revision)
    on conflict(id) do update set legacy_session_id=excluded.legacy_session_id,local_date=excluded.local_date,timezone=excluded.timezone,
      started_at=excluded.started_at,session_type=excluded.session_type,arrows_per_end=excluded.arrows_per_end,
      shooting_distance=excluded.shooting_distance,target_size=excluded.target_size,notes=excluded.notes;
  elsif v_kind='end.upsert' then
    if exists(select 1 from public.training_ends where id=v_entity and session_id<>v_session) then raise exception 'invalid_parent' using errcode='22023'; end if;
    insert into public.training_ends(id,session_id,ordinal,ended_at,arrow_limit,session_type,shooting_distance,target_size,notes,revision)
      values(v_entity,v_session,(v_payload->>'ordinal')::integer,(v_payload->>'ended_at')::timestamptz,
        (v_payload->>'arrow_limit')::smallint,v_payload->>'session_type',v_payload->>'shooting_distance',v_payload->>'target_size',v_payload->>'notes',v_revision)
      on conflict(id) do update set ordinal=excluded.ordinal,ended_at=excluded.ended_at,arrow_limit=excluded.arrow_limit,
        session_type=excluded.session_type,shooting_distance=excluded.shooting_distance,target_size=excluded.target_size,notes=excluded.notes,revision=excluded.revision;
  elsif v_kind='arrow.upsert' then
    if exists(select 1 from public.training_arrows where id=v_entity and (session_id<>v_session or deleted_at is not null)) then
      raise exception 'invalid_arrow_identity' using errcode='22023'; end if;
    if not exists(select 1 from public.training_arrows where id=v_entity) and
      ((select count(*) from public.training_arrows where session_id=v_session)>=10000
       or (select count(*) from public.training_arrows a join public.training_sessions s on s.id=a.session_id where s.owner_id=v_actor)>=
         (case when p_buddy_subject is null then 50000 else 500000 end)) then
      return jsonb_build_object('status','quota_exceeded');
    end if;
    insert into public.training_arrows(id,session_id,end_id,ordinal,label,score,x,y,recorded_at,revision)
      values(v_entity,v_session,(v_payload->>'end_id')::uuid,(v_payload->>'ordinal')::integer,v_payload->>'label',
        (v_payload->>'score')::smallint,(v_payload->>'x')::float8,(v_payload->>'y')::float8,(v_payload->>'recorded_at')::timestamptz,v_revision)
      on conflict(id) do update set end_id=excluded.end_id,ordinal=excluded.ordinal,label=excluded.label,score=excluded.score,
        x=excluded.x,y=excluded.y,recorded_at=excluded.recorded_at,revision=excluded.revision;
  elsif v_kind='arrow.delete' then
    update public.training_arrows set deleted_at=now(),revision=v_revision where id=v_entity and session_id=v_session and deleted_at is null;
    if not found then raise exception 'arrow_missing' using errcode='22023'; end if;
  elsif v_kind='session.close' then
    if v_payload->>'ended_at' is null then raise exception 'ended_at_required' using errcode='22023'; end if;
    update public.training_sessions set ended_at=(v_payload->>'ended_at')::timestamptz where id=v_session;
  end if;
  update public.training_sessions set revision=v_revision,updated_at=now() where id=v_session;
  insert into arbat_private.sync_operations(principal_id,operation_id,session_id,payload_hash,confirmed_revision)
    values(p_principal,v_id,v_session,v_hash,v_revision);
  return jsonb_build_object('status','accepted','revision',v_revision,'replayed',false);
end; $$;

-- A leftover anonymous JWT must not expose a Buddy-bound canonical account.
create or replace function arbat_private.can_read_training(p_owner uuid,p_school uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists(select 1 from auth.users u where u.id=auth.uid() and u.is_anonymous=false)
    or (not exists(select 1 from arbat_private.principal_links where source_id=auth.uid())
      and not exists(select 1 from arbat_private.external_identities where user_id=auth.uid()))
  ) and (
    p_owner=auth.uid() or (
      exists(select 1 from auth.users u where u.id=auth.uid() and u.is_anonymous=false) and (
        exists(select 1 from arbat_private.role_assignments r where r.user_id=auth.uid() and r.role='superadmin')
        or exists(select 1 from arbat_private.role_assignments r where r.user_id=auth.uid() and r.school_id=p_school and r.role='admin')
        or exists(select 1 from arbat_private.role_assignments r join arbat_private.coach_athletes c on c.school_id=r.school_id and c.coach_id=r.user_id
          where r.user_id=auth.uid() and r.school_id=p_school and r.role='coach' and c.athlete_id=p_owner and c.active)
      )
    )
  );
$$;
revoke all on function arbat_private.ingress_actor(uuid,text),arbat_private.ingress_allow(uuid),
  public.training_claim(uuid,text,text),public.training_apply_operation(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.training_claim(uuid,text,text),public.training_apply_operation(uuid,text,jsonb) to service_role;
commit;

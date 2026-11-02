-- ARBAT: instalacion inicial, SOLO desarrollo. Generado; no editar a mano.
-- Proyecto previsto: qbtdwlcpqcsolubhhkfa. Confirmarlo en el Dashboard antes de ejecutar.
-- Crea tablas y funciones; no despliega funciones Edge ni activa la web.
-- Una transaccion: falla sin reemplazar objetos si ya estan instalados.
begin;
do $arbat_setup$
begin
 if to_regclass('auth.users') is null then
  raise exception 'Se requiere un proyecto Supabase con Auth disponible.';
 end if;
 if to_regnamespace('arbat_private') is not null
    or to_regclass('public.training_profiles') is not null
    or to_regclass('public.training_sessions') is not null
    or to_regclass('public.training_ends') is not null
    or to_regclass('public.training_arrows') is not null then
  raise exception 'Ya existen objetos de entrenamiento. No se modificaron. Revisar antes de continuar.';
 end if;
end;
$arbat_setup$;

-- Source: 202611010001_training_foundation.sql
-- SHA-256: 1fb721dafc8f22c8c8e67ece03ce0fe9646f63e64e5895a02a0139cc12e8f63c
-- Foundation only: no client writes, ingestion RPC or Buddy trust configured.
-- Apply to an empty DEVELOPMENT project after review; never production automatically.

create schema arbat_private;
revoke all on schema arbat_private from public, anon, authenticated, service_role;
grant usage on schema arbat_private to authenticated;

create table public.training_profiles (
  id uuid primary key references auth.users(id),
  display_name text not null default '' check (char_length(display_name) <= 200),
  created_at timestamptz not null default now()
);
create table arbat_private.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200)
);
create table arbat_private.school_members (
  school_id uuid not null references arbat_private.schools(id),
  user_id uuid not null references public.training_profiles(id),
  primary key (school_id, user_id)
);
create table arbat_private.role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.training_profiles(id),
  role text not null check (role in ('user','coach','admin','superadmin')),
  school_id uuid references arbat_private.schools(id),
  check ((role = 'superadmin' and school_id is null) or (role <> 'superadmin' and school_id is not null)),
  unique nulls not distinct (user_id, role, school_id)
);
create table arbat_private.coach_athletes (
  school_id uuid not null,
  coach_id uuid not null,
  athlete_id uuid not null,
  active boolean not null default true,
  primary key (school_id, coach_id, athlete_id),
  foreign key (school_id, coach_id) references arbat_private.school_members(school_id, user_id),
  foreign key (school_id, athlete_id) references arbat_private.school_members(school_id, user_id),
  check (coach_id <> athlete_id)
);
create table arbat_private.external_identities (
  issuer text not null,
  subject text not null,
  user_id uuid not null references public.training_profiles(id),
  verified_at timestamptz not null default now(),
  primary key (issuer, subject)
);
create table public.training_sessions (
  id uuid primary key,
  owner_id uuid not null references public.training_profiles(id),
  school_id uuid,
  legacy_session_id text,
  local_date date,
  timezone text,
  started_at timestamptz,
  ended_at timestamptz,
  session_type text not null default 'training' check (session_type in ('training','competition')),
  arrows_per_end smallint check (arrows_per_end in (3,6,12)),
  shooting_distance text check (char_length(shooting_distance) <= 50),
  target_size text check (char_length(target_size) <= 50),
  notes text not null default '' check (char_length(notes) <= 10000),
  revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (school_id, owner_id) references arbat_private.school_members(school_id, user_id),
  check (ended_at is null or started_at is null or ended_at >= started_at)
);
create index training_sessions_owner_idx on public.training_sessions(owner_id, local_date);
create index training_sessions_school_idx on public.training_sessions(school_id);
create table public.training_ends (
  id uuid primary key,
  session_id uuid not null references public.training_sessions(id),
  ordinal integer not null check (ordinal > 0),
  ended_at timestamptz,
  arrow_limit smallint check (arrow_limit in (3,6,12)),
  session_type text check (session_type in ('training','competition')),
  shooting_distance text check (char_length(shooting_distance) <= 50),
  target_size text check (char_length(target_size) <= 50),
  notes text check (char_length(notes) <= 10000),
  revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz,
  unique (id, session_id),
  unique (session_id, ordinal)
);
create table public.training_arrows (
  id uuid primary key,
  session_id uuid not null references public.training_sessions(id),
  end_id uuid,
  ordinal integer not null check (ordinal > 0),
  label text not null check (label in ('M','X','1','2','3','4','5','6','7','8','9','10')),
  score smallint not null check (score between 0 and 10),
  x double precision,
  y double precision,
  recorded_at timestamptz,
  revision bigint not null default 1 check (revision > 0),
  deleted_at timestamptz,
  foreign key (end_id, session_id) references public.training_ends(id, session_id),
  check ((label = 'M' and score = 0) or (label = 'X' and score = 10) or label = score::text),
  check (x is null or (x > '-Infinity'::float8 and x < 'Infinity'::float8)),
  check (y is null or (y > '-Infinity'::float8 and y < 'Infinity'::float8)),
  check ((x is null) = (y is null))
);
-- Tombstones must not prevent a new arrow occupying a corrected position.
create unique index training_arrows_position_idx
  on public.training_arrows(session_id, end_id, ordinal) nulls not distinct where deleted_at is null;
create index training_arrows_end_idx on public.training_arrows(end_id, session_id);
create table arbat_private.sync_operations (
  principal_id uuid not null references public.training_profiles(id),
  operation_id uuid not null,
  session_id uuid not null references public.training_sessions(id),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  confirmed_revision bigint not null check (confirmed_revision > 0),
  accepted_at timestamptz not null default now(),
  primary key (principal_id, operation_id)
);
create table arbat_private.anonymous_claims (
  id uuid primary key default gen_random_uuid(),
  anonymous_id uuid not null references public.training_profiles(id),
  target_id uuid not null references public.training_profiles(id),
  proof_hash text not null unique check (proof_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (anonymous_id <> target_id),
  check (expires_at > created_at)
);
create unique index anonymous_claims_once_idx on arbat_private.anonymous_claims(anonymous_id) where consumed_at is not null;
create table arbat_private.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.training_profiles(id),
  action text not null,
  subject_id uuid,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

-- Server-owned roles only. No trust in user_metadata, browser roles or payload.owner.
-- Checking auth.users also prevents anonymous principals gaining privileges through
-- forged/stale is_anonymous claims. The owner can still read their own sessions.
create function arbat_private.can_read_training(p_owner uuid, p_school uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    p_owner = auth.uid() or (
      exists (select 1 from auth.users u where u.id = auth.uid() and u.is_anonymous = false)
      and (
        exists (select 1 from arbat_private.role_assignments r
          where r.user_id = auth.uid() and r.role = 'superadmin')
        or exists (select 1 from arbat_private.role_assignments r
          where r.user_id = auth.uid() and r.school_id = p_school and r.role = 'admin')
        or exists (select 1 from arbat_private.role_assignments r
          join arbat_private.coach_athletes c on c.school_id = r.school_id and c.coach_id = r.user_id
          where r.user_id = auth.uid() and r.school_id = p_school
          and r.role = 'coach' and c.athlete_id = p_owner and c.active)
      )
    )
  );
$$;
revoke all on function arbat_private.can_read_training(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function arbat_private.can_read_training(uuid, uuid) to authenticated;

alter table public.training_profiles enable row level security;
alter table public.training_sessions enable row level security;
alter table public.training_ends enable row level security;
alter table public.training_arrows enable row level security;
alter table arbat_private.schools enable row level security;
alter table arbat_private.school_members enable row level security;
alter table arbat_private.role_assignments enable row level security;
alter table arbat_private.coach_athletes enable row level security;
alter table arbat_private.external_identities enable row level security;
alter table arbat_private.sync_operations enable row level security;
alter table arbat_private.anonymous_claims enable row level security;
alter table arbat_private.audit_events enable row level security;

create policy profiles_read_self on public.training_profiles for select to authenticated
  using (id = (select auth.uid()));
create policy sessions_read_authorized on public.training_sessions for select to authenticated
  using (arbat_private.can_read_training(owner_id, school_id));
create policy ends_read_authorized on public.training_ends for select to authenticated
  using (exists (select 1 from public.training_sessions s where s.id = session_id));
create policy arrows_read_authorized on public.training_arrows for select to authenticated
  using (exists (select 1 from public.training_sessions s where s.id = session_id));

-- Explicit grants work with "Automatically expose new tables" disabled.
-- Reads only. All writes and private-table reads remain denied until validated
-- ingestion/admin/claim functions are implemented and separately reviewed.
revoke all on public.training_profiles, public.training_sessions, public.training_ends, public.training_arrows
  from public, anon, authenticated, service_role;
revoke all on all tables in schema arbat_private from public, anon, authenticated, service_role;
grant select on public.training_profiles, public.training_sessions, public.training_ends, public.training_arrows to authenticated;
comment on schema arbat_private is 'Server-only identity, role, claim and sync bookkeeping. Do not expose in Data API.';
comment on table public.training_sessions is 'Local-first mirror. Client writes deliberately disabled in foundation migration.';


-- Source: 202611010002_training_ingestion.sql
-- SHA-256: 9bf324b369c7d582f4bd3a09a9f7580cb571a59c0549ec810f88750e15ab79fd
-- Server RPCs only; caller identity MUST be verified by the Edge handler.
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


-- Source: 202611010003_training_history.sql
-- SHA-256: 7e750190538ec128e05db31f8c71796ce486f66cbda79f7f95bd54eb38728ed6
-- Paginated history, service RPCs only; the Edge handler verifies both identities.
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


-- Source: 202611010004_buddy_bridge.sql
-- SHA-256: 1030d4427ba2994c180753018dfb4059cc6830e934c0712c784bf501c9e3c820
-- Only the Edge function may resolve a subject verified against Buddy.
create function public.training_buddy_lookup(p_subject text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
 if p_subject is null or length(trim(p_subject)) not between 1 and 256 then
  raise exception 'invalid_subject' using errcode='22023';
 end if;
 select user_id into v_id from arbat_private.external_identities
 where issuer='https://api.statetty.com' and subject=p_subject;
 return jsonb_build_object('status','accepted','principal_id',v_id);
end; $$;
revoke all on function public.training_buddy_lookup(text) from public,anon,authenticated;
grant execute on function public.training_buddy_lookup(text) to service_role;


-- Source: 202611010005_training_batches.sql
-- SHA-256: 2026ab78d558d8962d11e930f2cb7aaeed49b62e6b4cf6fcda9ba1321e44032e
-- Bounded ordered batches. Original per-operation checks are preserved.
create function arbat_private.apply_training_operation(p_principal uuid, p_buddy_subject text, p_operation jsonb, p_rate_checked boolean)
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
  if not p_rate_checked and not arbat_private.ingress_allow(v_actor) then return jsonb_build_object('status','rate_limited'); end if;
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

-- Single-operation compatibility keeps the original request-level rate check.
create or replace function public.training_apply_operation(p_principal uuid,p_buddy_subject text,p_operation jsonb)
returns jsonb language sql security definer set search_path = '' as $$
 select arbat_private.apply_training_operation(p_principal,p_buddy_subject,p_operation,false);
$$;

create function public.training_apply_batch(p_principal uuid,p_buddy_subject text,p_operations jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_op jsonb; v_result jsonb; v_results jsonb:='[]'::jsonb;
 v_stopped boolean:=false; v_code text; v_session text;
begin
 if jsonb_typeof(p_operations) is distinct from 'array' then
  raise exception 'invalid_batch' using errcode='22023';
 end if;
 if jsonb_array_length(p_operations) not between 1 and 32 or octet_length(p_operations::text)>131072 then
  raise exception 'invalid_batch' using errcode='22023';
 end if;
 v_session:=p_operations->0->>'session_id';
 if v_session is null or exists(select 1 from jsonb_array_elements(p_operations) op where op->>'session_id' is distinct from v_session) then
  raise exception 'invalid_batch_sessions' using errcode='22023';
 end if;
 v_actor:=arbat_private.ingress_actor(p_principal,p_buddy_subject);
 -- One rate-limit unit per bounded request, not per arrow. Row/storage quotas
 -- and ownership checks remain inside each operation. No client can skip them.
 if not arbat_private.ingress_allow(v_actor) then
  v_stopped:=true;
 end if;
 for v_op in select value from jsonb_array_elements(p_operations) loop
  if v_stopped then
   v_result:=jsonb_build_object('status',case when jsonb_array_length(v_results)=0 then 'rate_limited' else 'not_attempted' end);
  else
   begin
    v_result:=arbat_private.apply_training_operation(p_principal,p_buddy_subject,v_op,true);
   exception when others then
    get stacked diagnostics v_code=returned_sqlstate;
    v_result:=case
     when v_code='28000' then jsonb_build_object('status','retry_or_auth_required','code','claim_or_buddy_required')
     when v_code='42501' then jsonb_build_object('status','retry_or_auth_required','code','not_owner')
     when left(v_code,2) in ('22','23') then jsonb_build_object('status','rejected','code','operation_rejected')
     else jsonb_build_object('status','retry_or_auth_required','code','server_unavailable') end;
   end;
   v_stopped:=v_result->>'status' is distinct from 'accepted';
  end if;
  v_results:=v_results||jsonb_build_array(jsonb_build_object('operation_id',v_op->>'operation_id')||v_result);
 end loop;
 return jsonb_build_object('results',v_results);
end; $$;
revoke all on function arbat_private.apply_training_operation(uuid,text,jsonb,boolean),public.training_apply_batch(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.training_apply_batch(uuid,text,jsonb) to service_role;


-- Source: 202611020006_training_coaching.sql
-- SHA-256: 6ce3f6166ce8f19e9f08c3d8dcfa4b208aaa27c787a639163b4279594d48877b
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

do $arbat_verify$
declare n integer;
begin
 select count(*) into n from pg_catalog.pg_class c join pg_catalog.pg_namespace s on s.oid=c.relnamespace
 where c.relkind='r' and c.relrowsecurity and (s.nspname='arbat_private' or (s.nspname='public' and c.relname in ('training_profiles','training_sessions','training_ends','training_arrows')));
 if n<>14 then raise exception 'La verificacion RLS no coincide con las 14 tablas previstas.'; end if;
 if has_function_privilege('anon','public.training_apply_operation(uuid,text,jsonb)','execute')
    or has_function_privilege('authenticated','public.training_apply_operation(uuid,text,jsonb)','execute')
    or has_function_privilege('anon','public.training_claim(uuid,text,text)','execute')
    or has_function_privilege('authenticated','public.training_claim(uuid,text,text)','execute')
    or has_function_privilege('anon','public.training_apply_batch(uuid,text,jsonb)','execute')
    or has_function_privilege('authenticated','public.training_apply_batch(uuid,text,jsonb)','execute')
    or has_function_privilege('service_role','arbat_private.apply_training_operation(uuid,text,jsonb,boolean)','execute') then
  raise exception 'Las funciones de ingreso no deben estar disponibles para clientes.';
 end if;
 if has_table_privilege('anon','public.training_sessions','select')
    or has_table_privilege('authenticated','public.training_sessions','insert')
    or has_table_privilege('authenticated','public.training_sessions','update') then
  raise exception 'Los privilegios directos de sesiones no coinciden con el modelo previsto.';
 end if;
end;
$arbat_verify$;
commit;

-- Consulta de solo lectura: no crea usuarios, no escribe datos ni envia solicitudes.
select
 count(*)::integer as tablas_entrenamiento,
 count(*) filter (where c.relrowsecurity)::integer as tablas_con_rls,
 case when count(*)=14 and bool_and(c.relrowsecurity)
   then 'estructura_preparada' else 'revisar_estructura' end as estado
from pg_catalog.pg_class c
join pg_catalog.pg_namespace s on s.oid=c.relnamespace
where c.relkind='r'
 and (s.nspname='arbat_private'
 or (s.nspname='public' and c.relname in ('training_profiles','training_sessions','training_ends','training_arrows')));

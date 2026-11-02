-- Foundation only: no client writes, ingestion RPC or Buddy trust configured.
-- Apply to an empty DEVELOPMENT project after review; never production automatically.
begin;

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
commit;

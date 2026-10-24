-- TRACE core schema.
-- Lives alongside the legacy `lift_state` table in the same project; nothing here touches it.
--
-- Historical integrity: workout_sessions / session_exercises / session_sets snapshot the
-- names and targets they were performed with. Templates can be edited or deleted freely
-- without rewriting completed training.

-- ───────────────────────────── profiles ─────────────────────────────
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  display_name   text check (char_length(display_name) <= 60),
  goal           text check (goal in ('strength', 'hypertrophy', 'general', 'endurance')),
  experience     text check (experience in ('new', 'intermediate', 'advanced')),
  equipment      text[] not null default '{}',
  -- ISO weekdays the user intends to train, 1 = Monday … 7 = Sunday
  training_days  smallint[] not null default '{}',
  weekly_target  smallint generated always as (coalesce(array_length(training_days, 1), 0)) stored,
  unit           text not null default 'kg' check (unit in ('kg', 'lb')),
  onboarded_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_trace_profile
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill accounts that existed before TRACE (e.g. from Lift).
insert into public.profiles (id) select id from auth.users on conflict do nothing;

-- ───────────────────────────── exercises ─────────────────────────────
-- owner_id null  → shared library row (read-only for users)
-- owner_id = uid → user's custom exercise
create table public.exercises (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid references auth.users (id) on delete cascade,
  slug            text not null,
  name            text not null check (char_length(name) between 1 and 80),
  primary_muscle  text not null,
  category        text not null check (category in ('compound', 'isolation')),
  equipment       text not null,
  -- how the exercise is measured; drives e1RM eligibility
  measure         text not null default 'weight_reps' check (measure in ('weight_reps', 'bodyweight_reps')),
  -- variation_of groups related movements (e.g. Incline Press → Bench Press)
  variation_of    uuid references public.exercises (id) on delete set null,
  created_at      timestamptz not null default now()
);
create unique index exercises_global_slug on public.exercises (slug) where owner_id is null;
create unique index exercises_owner_slug on public.exercises (owner_id, slug) where owner_id is not null;
create index exercises_variation_of on public.exercises (variation_of);

-- ───────────────────────────── templates ─────────────────────────────
create table public.workout_templates (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  focus        text,
  est_minutes  smallint check (est_minutes between 5 and 300),
  position     smallint not null default 0,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index workout_templates_owner on public.workout_templates (owner_id, position);

create table public.template_exercises (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  template_id   uuid not null references public.workout_templates (id) on delete cascade,
  exercise_id   uuid not null references public.exercises (id) on delete restrict,
  position      smallint not null,
  rest_seconds  smallint not null default 120 check (rest_seconds between 0 and 900),
  notes         text check (char_length(notes) <= 500)
);
create index template_exercises_template on public.template_exercises (template_id, position);
create index template_exercises_owner on public.template_exercises (owner_id);
create index template_exercises_exercise on public.template_exercises (exercise_id);

create table public.template_sets (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  template_exercise_id  uuid not null references public.template_exercises (id) on delete cascade,
  position              smallint not null,
  target_reps           smallint check (target_reps between 1 and 100),
  target_weight         numeric(6, 2) check (target_weight >= 0)
);
create index template_sets_parent on public.template_sets (template_exercise_id, position);
create index template_sets_owner on public.template_sets (owner_id);

-- ───────────────────────────── sessions ─────────────────────────────
create table public.workout_sessions (
  -- client-generated so offline completion is idempotent
  id                uuid primary key,
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  template_id       uuid references public.workout_templates (id) on delete set null,
  template_name     text,                        -- snapshot
  started_at        timestamptz not null,
  ended_at          timestamptz not null,
  notes             text check (char_length(notes) <= 2000),
  -- sum(weight × reps) over completed working sets, stored for cheap history queries
  total_volume      numeric(10, 2) not null default 0,
  completed_sets    smallint not null default 0,
  -- development sample data, never mixed into real history silently
  is_sample         boolean not null default false,
  created_at        timestamptz not null default now(),
  check (ended_at >= started_at)
);
create index workout_sessions_owner_time on public.workout_sessions (owner_id, started_at desc);
create index workout_sessions_template on public.workout_sessions (template_id);

create table public.session_exercises (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id            uuid not null references public.workout_sessions (id) on delete cascade,
  exercise_id           uuid not null references public.exercises (id) on delete restrict,
  exercise_name         text not null,             -- snapshot
  substituted_for       uuid references public.exercises (id) on delete set null,
  position              smallint not null,
  notes                 text check (char_length(notes) <= 1000)
);
create index session_exercises_session on public.session_exercises (session_id, position);
create index session_exercises_owner_exercise on public.session_exercises (owner_id, exercise_id);
create index session_exercises_exercise on public.session_exercises (exercise_id);
create index session_exercises_substituted on public.session_exercises (substituted_for);

create table public.session_sets (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_exercise_id  uuid not null references public.session_exercises (id) on delete cascade,
  position             smallint not null,
  weight               numeric(6, 2) check (weight >= 0),
  reps                 smallint check (reps between 0 and 200),
  target_weight        numeric(6, 2),               -- snapshot of the prescription
  target_reps          smallint,
  completed            boolean not null default false,
  completed_at         timestamptz
);
create index session_sets_parent on public.session_sets (session_exercise_id, position);
create index session_sets_owner on public.session_sets (owner_id);

-- ───────────────────────────── personal records ─────────────────────────────
-- Derived milestones, written when a session is completed. `kind` separates actual
-- measurements (heaviest weight, most reps) from estimates (e1RM, Epley formula).
create table public.personal_records (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id     uuid not null references public.exercises (id) on delete cascade,
  session_id      uuid not null references public.workout_sessions (id) on delete cascade,
  session_set_id  uuid not null references public.session_sets (id) on delete cascade,
  kind            text not null check (kind in ('heaviest_weight', 'most_reps', 'estimated_1rm')),
  value           numeric(8, 2) not null,
  weight          numeric(6, 2),
  reps            smallint,
  achieved_at     timestamptz not null
);
create index personal_records_owner_exercise on public.personal_records (owner_id, exercise_id, kind, achieved_at desc);
create index personal_records_session on public.personal_records (session_id);
create index personal_records_set on public.personal_records (session_set_id);
create index personal_records_exercise on public.personal_records (exercise_id);

-- ───────────────────────────── body measurements ─────────────────────────────
create table public.body_measurements (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  measured_on  date not null,
  body_weight  numeric(5, 2) check (body_weight > 0),
  notes        text check (char_length(notes) <= 500),
  created_at   timestamptz not null default now(),
  unique (owner_id, measured_on)
);

-- ───────────────────────────── row level security ─────────────────────────────
alter table public.profiles            enable row level security;
alter table public.exercises           enable row level security;
alter table public.workout_templates   enable row level security;
alter table public.template_exercises  enable row level security;
alter table public.template_sets       enable row level security;
alter table public.workout_sessions    enable row level security;
alter table public.session_exercises   enable row level security;
alter table public.session_sets        enable row level security;
alter table public.personal_records    enable row level security;
alter table public.body_measurements   enable row level security;

create policy "profiles: read own"   on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profiles: update own" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "exercises: read library and own" on public.exercises for select to authenticated
  using (owner_id is null or owner_id = (select auth.uid()));
create policy "exercises: insert own" on public.exercises for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "exercises: update own" on public.exercises for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "exercises: delete own" on public.exercises for delete to authenticated using (owner_id = (select auth.uid()));

-- Owner-scoped tables share one shape of policy.
do $$
declare t text;
begin
  foreach t in array array[
    'workout_templates', 'template_exercises', 'template_sets',
    'workout_sessions', 'session_exercises', 'session_sets',
    'personal_records', 'body_measurements'
  ] loop
    execute format(
      'create policy "%1$s: owner all" on public.%1$I for all to authenticated
         using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Children may only point at parents owned by the same user.
create policy "template_exercises: parent owned" on public.template_exercises as restrictive for insert to authenticated
  with check (exists (select 1 from public.workout_templates p where p.id = template_id and p.owner_id = (select auth.uid())));
create policy "template_sets: parent owned" on public.template_sets as restrictive for insert to authenticated
  with check (exists (select 1 from public.template_exercises p where p.id = template_exercise_id and p.owner_id = (select auth.uid())));

-- ───────────────────────────── personal record derivation ─────────────────────────────
-- Compares the best set per exercise in one session against every record already held.
-- Estimated 1RM uses Epley and is only computed for sets of ≤ 12 reps.
-- Kept separate from complete_session so records can be replayed from scratch.
create or replace function public.derive_session_records(sid uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  with done as (
    select ss.id as set_id, ss.weight, ss.reps, se.exercise_id, e.measure, s.ended_at, s.owner_id,
           case when e.measure = 'weight_reps' and ss.reps <= 12 and ss.weight > 0
                then round(ss.weight * (1 + ss.reps / 30.0), 1) end as e1rm
    from public.session_sets ss
    join public.session_exercises se on se.id = ss.session_exercise_id
    join public.workout_sessions s on s.id = se.session_id
    join public.exercises e on e.id = se.exercise_id
    where s.id = sid and s.owner_id = (select auth.uid()) and ss.completed and coalesce(ss.reps, 0) > 0
  ),
  -- best set per exercise and kind within this session
  candidates as (
    (select distinct on (exercise_id) 'heaviest_weight'::text as kind, weight as value, *
       from done where measure = 'weight_reps' and weight > 0
       order by exercise_id, weight desc, reps desc)
    union all
    (select distinct on (exercise_id) 'estimated_1rm', e1rm, *
       from done where e1rm is not null
       order by exercise_id, e1rm desc)
    union all
    (select distinct on (exercise_id) 'most_reps', reps, *
       from done where measure = 'bodyweight_reps'
       order by exercise_id, reps desc)
  )
  insert into public.personal_records (owner_id, exercise_id, session_id, session_set_id, kind, value, weight, reps, achieved_at)
  select c.owner_id, c.exercise_id, sid, c.set_id, c.kind, c.value, c.weight, c.reps, c.ended_at
  from candidates c
  where c.value > coalesce((
    select max(pr.value) from public.personal_records pr
    where pr.owner_id = c.owner_id and pr.exercise_id = c.exercise_id and pr.kind = c.kind
  ), 0);
$$;

-- Rebuilds every record for the current user in chronological order.
create or replace function public.recompute_personal_records()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s record;
begin
  delete from public.personal_records where owner_id = auth.uid();
  for s in select id from public.workout_sessions where owner_id = auth.uid() order by ended_at loop
    perform public.derive_session_records(s.id);
  end loop;
end;
$$;

-- ───────────────────────────── complete_session RPC ─────────────────────────────
-- Writes a finished workout atomically and derives personal records.
-- Idempotent on the client-generated session id, so the offline outbox can retry safely.
--
-- payload shape:
-- { id, template_id?, template_name?, started_at, ended_at, notes?, is_sample?,
--   exercises: [{ exercise_id, exercise_name, substituted_for?, notes?,
--                 sets: [{ weight?, reps?, target_weight?, target_reps?, completed, completed_at? }] }] }
create or replace function public.complete_session(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid       uuid := auth.uid();
  sid       uuid := (payload ->> 'id')::uuid;
  ex        jsonb;
  st        jsonb;
  ex_pos    int := 0;
  set_pos   int;
  se_id     uuid;
  v_reps    int;
  v_done    boolean;
  v_at      timestamptz := (payload ->> 'ended_at')::timestamptz;
  is_latest boolean;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if sid is null then
    raise exception 'session id required' using errcode = '22023';
  end if;
  if exists (select 1 from public.workout_sessions where id = sid) then
    return sid; -- already recorded (outbox retry)
  end if;
  if jsonb_typeof(payload -> 'exercises') is distinct from 'array' then
    raise exception 'exercises must be an array' using errcode = '22023';
  end if;

  insert into public.workout_sessions (id, owner_id, template_id, template_name, started_at, ended_at, notes, is_sample)
  values (
    sid, uid,
    (select t.id from public.workout_templates t where t.id = (payload ->> 'template_id')::uuid and t.owner_id = uid),
    nullif(payload ->> 'template_name', ''),
    (payload ->> 'started_at')::timestamptz,
    v_at,
    nullif(payload ->> 'notes', ''),
    coalesce((payload ->> 'is_sample')::boolean, false)
  );

  for ex in select * from jsonb_array_elements(payload -> 'exercises') loop
    if not exists (
      select 1 from public.exercises e
      where e.id = (ex ->> 'exercise_id')::uuid and (e.owner_id is null or e.owner_id = uid)
    ) then
      raise exception 'unknown exercise %', ex ->> 'exercise_id' using errcode = '22023';
    end if;

    insert into public.session_exercises (owner_id, session_id, exercise_id, exercise_name, substituted_for, position, notes)
    values (uid, sid, (ex ->> 'exercise_id')::uuid, ex ->> 'exercise_name',
            (ex ->> 'substituted_for')::uuid, ex_pos, nullif(ex ->> 'notes', ''))
    returning id into se_id;
    ex_pos := ex_pos + 1;
    set_pos := 0;

    for st in select * from jsonb_array_elements(coalesce(ex -> 'sets', '[]'::jsonb)) loop
      v_reps := (st ->> 'reps')::int;
      v_done := coalesce((st ->> 'completed')::boolean, false) and coalesce(v_reps, 0) > 0;
      insert into public.session_sets (owner_id, session_exercise_id, position, weight, reps, target_weight, target_reps, completed, completed_at)
      values (uid, se_id, set_pos, (st ->> 'weight')::numeric, v_reps,
              (st ->> 'target_weight')::numeric, (st ->> 'target_reps')::int,
              v_done, case when v_done then coalesce((st ->> 'completed_at')::timestamptz, v_at) end);
      set_pos := set_pos + 1;
    end loop;
  end loop;

  update public.workout_sessions s set
    total_volume = coalesce((
      select sum(ss.weight * ss.reps) from public.session_sets ss
      join public.session_exercises se on se.id = ss.session_exercise_id
      where se.session_id = sid and ss.completed and ss.weight is not null), 0),
    completed_sets = (
      select count(*) from public.session_sets ss
      join public.session_exercises se on se.id = ss.session_exercise_id
      where se.session_id = sid and ss.completed)
  where s.id = sid;

  -- A session synced late (older than existing history) invalidates later records; replay.
  select not exists (
    select 1 from public.workout_sessions where owner_id = uid and id <> sid and ended_at > v_at
  ) into is_latest;
  if is_latest then
    perform public.derive_session_records(sid);
  else
    perform public.recompute_personal_records();
  end if;

  return sid;
end;
$$;

-- Removes sample sessions for the current user, then rebuilds records from real history only.
create or replace function public.clear_sample_history()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.workout_sessions where owner_id = auth.uid() and is_sample;
  perform public.recompute_personal_records();
end;
$$;

revoke execute on function public.complete_session(jsonb) from public, anon;
revoke execute on function public.clear_sample_history() from public, anon;
revoke execute on function public.recompute_personal_records() from public, anon;
revoke execute on function public.derive_session_records(uuid) from public, anon;
grant execute on function public.complete_session(jsonb) to authenticated;
grant execute on function public.clear_sample_history() to authenticated;
grant execute on function public.recompute_personal_records() to authenticated;
grant execute on function public.derive_session_records(uuid) to authenticated;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Runs: outdoor (GPS or logged by hand) and treadmill. Private to their owner; nothing here is
-- ever shared. The GPS route lives on the row, so deleting a run deletes its route with it.
-- Splits, paces and best efforts are derived from the route at read time, never stored.
create table public.runs (
  -- generated on the device when the run starts, so a retried save can never create a duplicate
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind              text not null check (kind in ('outdoor', 'treadmill')),
  source            text not null check (source in ('gps', 'manual')),
  title             text check (char_length(title) <= 80),
  started_at        timestamptz not null,
  ended_at          timestamptz not null,
  -- wall-clock time from start to finish, pauses included
  elapsed_seconds   integer not null check (elapsed_seconds between 0 and 172800),
  -- time spent actually moving: pauses and standing still excluded
  moving_seconds    integer not null check (moving_seconds >= 0),
  distance_m        numeric(9, 1) not null check (distance_m between 0 and 500000),
  -- only when the device reported reliable altitude
  elevation_gain_m  numeric(7, 1) check (elevation_gain_m >= 0),
  -- { "v": 1, "points": [[lat, lng, t_ms, accuracy_m, altitude_m|null, segment], ...] }
  route             jsonb,
  is_sample         boolean not null default false,
  created_at        timestamptz not null default now(),
  check (ended_at >= started_at),
  check (moving_seconds <= elapsed_seconds),
  check (route is null or (source = 'gps' and kind = 'outdoor')),
  check (route is null or jsonb_array_length(route -> 'points') <= 40000)
);

create index runs_owner_started on public.runs (owner_id, started_at desc);

alter table public.runs enable row level security;
create policy "runs: owner all" on public.runs for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

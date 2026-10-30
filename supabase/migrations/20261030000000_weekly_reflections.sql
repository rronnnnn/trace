-- Weekly reflections: the only part of a week the person writes. The facts (sessions, volume,
-- records) are derived from history at read time and never stored here, so they can't drift.
create table public.weekly_reflections (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Monday of the week, in the viewer's timezone
  week_start  date not null check (extract(isodow from week_start) = 1),
  -- how the week felt: 1 drained … 5 strong
  energy      smallint check (energy between 1 and 5),
  note        text check (char_length(note) <= 2000),
  next_focus  text check (char_length(next_focus) <= 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (owner_id, week_start)
);

alter table public.weekly_reflections enable row level security;
create policy "weekly_reflections: owner all" on public.weekly_reflections for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

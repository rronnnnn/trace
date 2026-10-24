-- Goals: a summit to climb. Weighted goals: lift target_weight for at least target_reps.
-- Bodyweight goals (target_weight null): reach target_reps in one set.
-- Progress is never stored; it is derived from recorded sets, so it can't drift from history.
create table public.goals (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  exercise_id    uuid not null references public.exercises (id) on delete restrict,
  exercise_name  text not null check (char_length(exercise_name) between 1 and 80), -- snapshot
  target_weight  numeric(6, 2) check (target_weight > 0 and target_weight < 10000),
  target_reps    smallint not null default 1 check (target_reps between 1 and 200),
  note           text check (char_length(note) <= 200),
  achieved_at    timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index goals_owner on public.goals (owner_id, created_at desc);
create index goals_exercise on public.goals (exercise_id);

alter table public.goals enable row level security;
create policy "goals: owner all" on public.goals for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "goals: references visible" on public.goals as restrictive for all to authenticated
  using (true) with check (public.can_use_exercise(exercise_id));

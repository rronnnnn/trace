-- The first value ever recorded for an exercise is a baseline, not an achievement.
-- Keep it (later records compare against it) but mark it so the UI never celebrates it.
alter table public.personal_records add column is_baseline boolean not null default false;

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
  ),
  compared as (
    select c.*, (
      select max(pr.value) from public.personal_records pr
      where pr.owner_id = c.owner_id and pr.exercise_id = c.exercise_id and pr.kind = c.kind
    ) as prev_best
    from candidates c
  )
  insert into public.personal_records (owner_id, exercise_id, session_id, session_set_id, kind, value, weight, reps, achieved_at, is_baseline)
  select owner_id, exercise_id, sid, set_id, kind, value, weight, reps, ended_at, prev_best is null
  from compared
  where prev_best is null or value > prev_best;
$$;

-- Re-derive existing users' records so baselines are flagged.
update public.personal_records pr set is_baseline = true
where not exists (
  select 1 from public.personal_records earlier
  where earlier.owner_id = pr.owner_id and earlier.exercise_id = pr.exercise_id and earlier.kind = pr.kind
    and (earlier.achieved_at, earlier.id) < (pr.achieved_at, pr.id)
);

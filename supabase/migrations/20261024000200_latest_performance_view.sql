-- Most recent session in which each exercise had at least one completed set.
-- security_invoker so the caller's RLS applies (users only see their own rows).
create view public.latest_exercise_performance
with (security_invoker = true) as
select distinct on (se.owner_id, se.exercise_id)
  se.owner_id,
  se.exercise_id,
  se.id as session_exercise_id,
  s.id as session_id,
  s.ended_at
from public.session_exercises se
join public.workout_sessions s on s.id = se.session_id
where exists (select 1 from public.session_sets ss where ss.session_exercise_id = se.id and ss.completed)
order by se.owner_id, se.exercise_id, s.ended_at desc;

grant select on public.latest_exercise_performance to authenticated;
revoke all on public.latest_exercise_performance from anon;

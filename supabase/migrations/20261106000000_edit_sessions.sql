-- Corrections to logged sessions: a mistyped weight, a set logged twice, a forgotten set.
-- Edits are explicit operations rather than a full replacement, so nothing the editor didn't
-- show (planned sets that were skipped) is lost by accident. Totals and personal records are
-- rebuilt afterwards, because a corrected set can make or unmake any later record.
--
-- payload shape:
-- { id, notes?,
--   exercises?: [{ id, notes? }],                                   -- notes per session exercise
--   sets?: [{ id?, session_exercise_id, weight?, reps }],           -- id null → a new performed set
--   delete_sets?: [uuid], delete_exercises?: [uuid] }
create or replace function public.edit_session(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid   uuid := auth.uid();
  sid   uuid := (payload ->> 'id')::uuid;
  v_at  timestamptz;
  ex    jsonb;
  st    jsonb;
  v_reps int;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select ended_at into v_at from public.workout_sessions where id = sid and owner_id = uid for update;
  if v_at is null then
    raise exception 'unknown session' using errcode = '22023';
  end if;

  update public.workout_sessions set notes = nullif(payload ->> 'notes', '') where id = sid;

  for ex in select * from jsonb_array_elements(coalesce(payload -> 'exercises', '[]'::jsonb)) loop
    update public.session_exercises set notes = nullif(ex ->> 'notes', '')
    where id = (ex ->> 'id')::uuid and session_id = sid;
  end loop;

  delete from public.session_sets ss using public.session_exercises se
  where se.id = ss.session_exercise_id and se.session_id = sid
    and ss.id in (select (jsonb_array_elements_text(coalesce(payload -> 'delete_sets', '[]'::jsonb)))::uuid);

  delete from public.session_exercises
  where session_id = sid
    and id in (select (jsonb_array_elements_text(coalesce(payload -> 'delete_exercises', '[]'::jsonb)))::uuid);

  for st in select * from jsonb_array_elements(coalesce(payload -> 'sets', '[]'::jsonb)) loop
    v_reps := (st ->> 'reps')::int;
    if coalesce(v_reps, 0) < 1 then
      raise exception 'every set needs at least one rep' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.session_exercises where id = (st ->> 'session_exercise_id')::uuid and session_id = sid
    ) then
      raise exception 'unknown exercise in session' using errcode = '22023';
    end if;

    if st ->> 'id' is null then
      insert into public.session_sets (owner_id, session_exercise_id, position, weight, reps, completed, completed_at)
      select uid, (st ->> 'session_exercise_id')::uuid, coalesce(max(position) + 1, 0),
             (st ->> 'weight')::numeric, v_reps, true, v_at
      from public.session_sets where session_exercise_id = (st ->> 'session_exercise_id')::uuid;
    else
      update public.session_sets set
        weight = (st ->> 'weight')::numeric,
        reps = v_reps,
        completed = true,
        completed_at = coalesce(completed_at, v_at)
      where id = (st ->> 'id')::uuid and session_exercise_id = (st ->> 'session_exercise_id')::uuid;
    end if;
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

  perform public.recompute_personal_records();
  return sid;
end;
$$;

-- Deletes one session (its exercises, sets and records cascade) and rebuilds records without it.
create or replace function public.delete_session(sid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.workout_sessions where id = sid and owner_id = auth.uid();
  if not found then
    raise exception 'unknown session' using errcode = '22023';
  end if;
  perform public.recompute_personal_records();
end;
$$;

revoke execute on function public.edit_session(jsonb) from public, anon;
revoke execute on function public.delete_session(uuid) from public, anon;
grant execute on function public.edit_session(jsonb) to authenticated;
grant execute on function public.delete_session(uuid) to authenticated;

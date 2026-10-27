-- User-built routines and exercises.
--
-- Exercises used in recorded training can't be hard-deleted (session_exercises, goals and
-- personal_records restrict), so deleting one of those archives it instead: it disappears from
-- the library and routines, while history keeps pointing at it.

alter table public.exercises add column if not exists archived_at timestamptz;

-- ───────────────────────────── save_template RPC ─────────────────────────────
-- Creates or fully replaces a routine in one transaction, so a half-saved edit can't
-- leave a routine without its sets.
--
-- payload shape:
-- { id?, name, focus?, est_minutes?,
--   exercises: [{ exercise_id, rest_seconds?, notes?, sets: [{ target_reps?, target_weight? }] }] }
create or replace function public.save_template(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  tid     uuid := nullif(payload ->> 'id', '')::uuid;
  ex      jsonb;
  st      jsonb;
  ex_pos  int := 0;
  set_pos int;
  te_id   uuid;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(payload -> 'exercises') is distinct from 'array' then
    raise exception 'exercises must be an array' using errcode = '22023';
  end if;

  if tid is null then
    insert into public.workout_templates (owner_id, name, focus, est_minutes, position)
    values (
      uid,
      btrim(payload ->> 'name'),
      nullif(btrim(payload ->> 'focus'), ''),
      (payload ->> 'est_minutes')::smallint,
      coalesce((select max(position) + 1 from public.workout_templates where owner_id = uid), 0)
    )
    returning id into tid;
  else
    update public.workout_templates set
      name = btrim(payload ->> 'name'),
      focus = nullif(btrim(payload ->> 'focus'), ''),
      est_minutes = (payload ->> 'est_minutes')::smallint,
      updated_at = now()
    where id = tid and owner_id = uid;
    if not found then
      raise exception 'unknown routine' using errcode = '22023';
    end if;
    delete from public.template_exercises where template_id = tid;
  end if;

  for ex in select * from jsonb_array_elements(payload -> 'exercises') loop
    if not exists (
      select 1 from public.exercises e
      where e.id = (ex ->> 'exercise_id')::uuid and (e.owner_id is null or e.owner_id = uid) and e.archived_at is null
    ) then
      raise exception 'unknown exercise %', ex ->> 'exercise_id' using errcode = '22023';
    end if;

    insert into public.template_exercises (owner_id, template_id, exercise_id, position, rest_seconds, notes)
    values (uid, tid, (ex ->> 'exercise_id')::uuid, ex_pos,
            coalesce((ex ->> 'rest_seconds')::smallint, 120), nullif(btrim(ex ->> 'notes'), ''))
    returning id into te_id;
    ex_pos := ex_pos + 1;
    set_pos := 0;

    for st in select * from jsonb_array_elements(coalesce(ex -> 'sets', '[]'::jsonb)) loop
      insert into public.template_sets (owner_id, template_exercise_id, position, target_reps, target_weight)
      values (uid, te_id, set_pos, (st ->> 'target_reps')::smallint, (st ->> 'target_weight')::numeric);
      set_pos := set_pos + 1;
    end loop;
  end loop;

  return tid;
end;
$$;

-- ───────────────────────────── delete_exercise RPC ─────────────────────────────
-- Removes one of the user's own exercises from every routine, then deletes it — or archives
-- it when recorded training, goals or records still reference it. Returns 'deleted' | 'archived'.
create or replace function public.delete_exercise(eid uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.exercises where id = eid and owner_id = uid) then
    raise exception 'unknown exercise' using errcode = '22023';
  end if;

  delete from public.template_exercises where exercise_id = eid and owner_id = uid;

  if exists (select 1 from public.session_exercises where exercise_id = eid)
     or exists (select 1 from public.goals where exercise_id = eid)
     or exists (select 1 from public.personal_records where exercise_id = eid) then
    update public.exercises set archived_at = now() where id = eid and owner_id = uid;
    return 'archived';
  end if;

  delete from public.exercises where id = eid and owner_id = uid;
  return 'deleted';
end;
$$;

revoke execute on function public.save_template(jsonb) from public, anon;
revoke execute on function public.delete_exercise(uuid) from public, anon;
grant execute on function public.save_template(jsonb) to authenticated;
grant execute on function public.delete_exercise(uuid) to authenticated;

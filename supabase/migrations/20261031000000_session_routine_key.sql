-- A session's routine, kept for good. workout_sessions.template_id is set null when a routine is
-- deleted, and the Training Landscape keys each range by its routine: without the original id, a
-- deleted routine's range (and every landmark on it) would move to a new place. routine_key
-- remembers the routine id the session was logged with. No foreign key on purpose: it must
-- outlive the routine. It is only ever set once.
alter table public.workout_sessions add column if not exists routine_key uuid;

update public.workout_sessions set routine_key = template_id where routine_key is null and template_id is not null;

create or replace function public.keep_routine_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.routine_key := coalesce(old.routine_key, old.template_id, new.template_id);
  else
    new.routine_key := new.template_id;
  end if;
  return new;
end;
$$;

drop trigger if exists workout_sessions_routine_key on public.workout_sessions;
create trigger workout_sessions_routine_key
  before insert or update on public.workout_sessions
  for each row execute function public.keep_routine_key();

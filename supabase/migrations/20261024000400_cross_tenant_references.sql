-- Foreign keys are checked without RLS, so an owner-scoped row could still *reference* another
-- user's row (e.g. B attaching a session_exercise to A's session). These restrictive policies
-- require every reference written by a user to point at rows that user owns, or at library rows.
-- "for all ... using (true)" leaves reads and deletes to the permissive owner policies.

drop policy if exists "template_exercises: parent owned" on public.template_exercises;
drop policy if exists "template_sets: parent owned" on public.template_sets;

create or replace function public.can_use_exercise(eid uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select eid is null or exists (
    select 1 from public.exercises e where e.id = eid and (e.owner_id is null or e.owner_id = (select auth.uid()))
  );
$$;

create policy "exercises: references visible" on public.exercises as restrictive for all to authenticated
  using (true) with check (public.can_use_exercise(variation_of));

create policy "template_exercises: references owned" on public.template_exercises as restrictive for all to authenticated
  using (true)
  with check (
    exists (select 1 from public.workout_templates p where p.id = template_id and p.owner_id = (select auth.uid()))
    and public.can_use_exercise(exercise_id)
  );

create policy "template_sets: references owned" on public.template_sets as restrictive for all to authenticated
  using (true)
  with check (exists (select 1 from public.template_exercises p where p.id = template_exercise_id and p.owner_id = (select auth.uid())));

create policy "workout_sessions: references owned" on public.workout_sessions as restrictive for all to authenticated
  using (true)
  with check (template_id is null or exists (select 1 from public.workout_templates t where t.id = template_id and t.owner_id = (select auth.uid())));

create policy "session_exercises: references owned" on public.session_exercises as restrictive for all to authenticated
  using (true)
  with check (
    exists (select 1 from public.workout_sessions s where s.id = session_id and s.owner_id = (select auth.uid()))
    and public.can_use_exercise(exercise_id)
    and public.can_use_exercise(substituted_for)
  );

create policy "session_sets: references owned" on public.session_sets as restrictive for all to authenticated
  using (true)
  with check (exists (select 1 from public.session_exercises p where p.id = session_exercise_id and p.owner_id = (select auth.uid())));

create policy "personal_records: references owned" on public.personal_records as restrictive for all to authenticated
  using (true)
  with check (
    exists (select 1 from public.workout_sessions s where s.id = session_id and s.owner_id = (select auth.uid()))
    and exists (select 1 from public.session_sets x where x.id = session_set_id and x.owner_id = (select auth.uid()))
    and public.can_use_exercise(exercise_id)
  );

revoke execute on function public.can_use_exercise(uuid) from public, anon;
grant execute on function public.can_use_exercise(uuid) to authenticated;

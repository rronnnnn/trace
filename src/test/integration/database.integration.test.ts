/**
 * Live database audit: account isolation (RLS), persistence, historical integrity, records and validation.
 * Runs against the real Supabase project with two dedicated QA accounts. Skipped unless configured:
 *
 *   TRACE_IT_A_EMAIL / TRACE_IT_A_PASSWORD   account A (may hold other data; only its own test rows are touched)
 *   TRACE_IT_B_EMAIL / TRACE_IT_B_PASSWORD   account B (its TRACE data is wiped before the run)
 *
 *   npm run test:db
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { Database, Json } from "@/lib/supabase/database.types";
import { toCompletionPayload, workoutReducer } from "@/lib/workout/reducer";

const env = process.env;
const configured = Boolean(env.TRACE_IT_A_EMAIL && env.TRACE_IT_B_EMAIL && env.NEXT_PUBLIC_SUPABASE_URL);
const d = configured ? describe : describe.skip;

type Client = SupabaseClient<Database>;
const client = () =>
  createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Node 20 has no global WebSocket; realtime is unused here but the client constructs it.
    realtime: { transport: WebSocket as never },
  });

async function signIn(email: string, password: string) {
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { c, uid: data.user.id };
}

const uuid = () => crypto.randomUUID();

let A: Client, B: Client, anon: Client;
let aUid: string, bUid: string;
let bench: string, squat: string, pullup: string;
let aSession: string, aTemplate: string, aCustomExercise: string;

type Payload = { [k: string]: Json } & { id: string };

function payload(over: { [k: string]: Json } = {}): Payload {
  return {
    id: uuid(),
    template_id: null,
    template_name: "IT Session",
    started_at: "2026-10-01T10:00:00Z",
    ended_at: "2026-10-01T11:00:00Z",
    notes: null,
    exercises: [
      {
        exercise_id: bench,
        exercise_name: "Bench Press",
        substituted_for: null,
        notes: null,
        sets: [
          { weight: 100, reps: 5, target_weight: null, target_reps: 5, completed: true, completed_at: null },
          { weight: 100, reps: 4, target_weight: null, target_reps: 5, completed: true, completed_at: null },
          { weight: 100, reps: null, target_weight: null, target_reps: 5, completed: false, completed_at: null },
        ],
      },
    ],
    ...over,
  } as Payload;
}

async function wipeB() {
  await B.from("goals").delete().eq("owner_id", bUid);
  await B.from("workout_sessions").delete().eq("owner_id", bUid);
  await B.from("workout_templates").delete().eq("owner_id", bUid);
  await B.from("exercises").delete().eq("owner_id", bUid);
}

d("database audit", () => {
  beforeAll(async () => {
    ({ c: A, uid: aUid } = await signIn(env.TRACE_IT_A_EMAIL!, env.TRACE_IT_A_PASSWORD!));
    ({ c: B, uid: bUid } = await signIn(env.TRACE_IT_B_EMAIL!, env.TRACE_IT_B_PASSWORD!));
    anon = client();
    const { data: lib } = await A.from("exercises")
      .select("id, slug")
      .is("owner_id", null)
      .in("slug", ["barbell-bench-press", "barbell-back-squat", "pull-up"]);
    const by = Object.fromEntries(lib!.map((e) => [e.slug, e.id]));
    [bench, squat, pullup] = [by["barbell-bench-press"], by["barbell-back-squat"], by["pull-up"]];

    // A's private fixtures
    const { data: t } = await A.from("workout_templates").insert({ owner_id: aUid, name: "IT private template" }).select("id").single();
    aTemplate = t!.id;
    const { data: ex } = await A.from("exercises")
      .insert({
        owner_id: aUid,
        slug: `it-private-${Date.now()}`,
        name: "IT Private Move",
        primary_muscle: "Chest",
        category: "compound",
        equipment: "barbell",
      })
      .select("id")
      .single();
    aCustomExercise = ex!.id;
    aSession = uuid();
    const { error } = await A.rpc("complete_session", {
      payload: payload({
        id: aSession,
        template_name: "IT A session",
        ended_at: "2020-01-01T11:00:00Z",
        started_at: "2020-01-01T10:00:00Z",
      }),
    });
    if (error) throw error;
    await wipeB();
  }, 60_000);

  afterAll(async () => {
    if (!configured) return;
    await wipeB();
    await A.from("workout_sessions").delete().eq("id", aSession);
    await A.from("workout_templates").delete().eq("id", aTemplate);
    await A.from("exercises").delete().eq("id", aCustomExercise);
    // A's records may have been rebuilt around the removed session
    await A.rpc("recompute_personal_records");
  }, 60_000);

  describe("account isolation", () => {
    it("B cannot read A's sessions, sets, records, templates or profile", async () => {
      expect((await B.from("workout_sessions").select("id").eq("id", aSession)).data).toEqual([]);
      expect((await B.from("session_exercises").select("id").eq("session_id", aSession)).data).toEqual([]);
      expect((await B.from("personal_records").select("id").eq("session_id", aSession)).data).toEqual([]);
      expect((await B.from("workout_templates").select("id").eq("id", aTemplate)).data).toEqual([]);
      expect((await B.from("profiles").select("id").eq("id", aUid)).data).toEqual([]);
      expect((await B.from("exercises").select("id").eq("id", aCustomExercise)).data).toEqual([]);
      expect((await B.from("latest_exercise_performance").select("owner_id")).data!.every((r) => r.owner_id === bUid)).toBe(true);
    });

    it("B cannot modify or delete A's rows", async () => {
      await B.from("workout_sessions").update({ notes: "pwned" }).eq("id", aSession);
      await B.from("workout_sessions").delete().eq("id", aSession);
      await B.from("profiles").update({ display_name: "pwned" }).eq("id", aUid);
      const { data } = await A.from("workout_sessions").select("id, notes").eq("id", aSession).single();
      expect(data).toEqual({ id: aSession, notes: null });
      const { data: p } = await A.from("profiles").select("display_name").eq("id", aUid).single();
      expect(p!.display_name).not.toBe("pwned");
    });

    it("B cannot write rows owned by A", async () => {
      const { error } = await B.from("workout_sessions").insert({
        id: uuid(),
        owner_id: aUid,
        started_at: "2026-01-01T00:00:00Z",
        ended_at: "2026-01-01T01:00:00Z",
      });
      expect(error?.code).toBe("42501");
    });

    it("B cannot attach its own rows to A's session, template or private exercise", async () => {
      const se = await B.from("session_exercises").insert({
        owner_id: bUid,
        session_id: aSession,
        exercise_id: bench,
        exercise_name: "x",
        position: 9,
      });
      expect(se.error?.code).toBe("42501");

      const te = await B.from("template_exercises").insert({ owner_id: bUid, template_id: aTemplate, exercise_id: bench, position: 0 });
      expect(te.error?.code).toBe("42501");

      const { data: own } = await B.from("workout_templates").insert({ owner_id: bUid, name: "B template" }).select("id").single();
      const priv = await B.from("template_exercises").insert({
        owner_id: bUid,
        template_id: own!.id,
        exercise_id: aCustomExercise,
        position: 0,
      });
      expect(priv.error?.code).toBe("42501");

      const ws = await B.from("workout_sessions").insert({
        id: uuid(),
        owner_id: bUid,
        template_id: aTemplate,
        started_at: "2026-01-01T00:00:00Z",
        ended_at: "2026-01-01T01:00:00Z",
      });
      expect(ws.error?.code).toBe("42501");

      const pr = await B.from("personal_records").insert({
        owner_id: bUid,
        exercise_id: bench,
        session_id: aSession,
        session_set_id: uuid(),
        kind: "heaviest_weight",
        value: 1,
        achieved_at: "2026-01-01T00:00:00Z",
      });
      expect(pr.error).not.toBeNull();
      await B.from("workout_templates").delete().eq("id", own!.id);
    });

    it("complete_session ignores A's template and rejects A's private exercise", async () => {
      const id = uuid();
      const { error } = await B.rpc("complete_session", { payload: payload({ id, template_id: aTemplate }) });
      expect(error).toBeNull();
      const { data } = await B.from("workout_sessions").select("template_id").eq("id", id).single();
      expect(data!.template_id).toBeNull();

      const bad = await B.rpc("complete_session", {
        payload: payload({
          exercises: [{ exercise_id: aCustomExercise, exercise_name: "x", sets: [{ weight: 1, reps: 1, completed: true }] }],
        }),
      });
      expect(bad.error?.code).toBe("22023");
      await B.from("workout_sessions").delete().eq("id", id);
    });

    it("goals are private and can only target exercises the owner can use", async () => {
      const { data: g, error } = await A.from("goals")
        .insert({ owner_id: aUid, exercise_id: bench, exercise_name: "Bench Press", target_weight: 100 })
        .select("id")
        .single();
      expect(error).toBeNull();
      expect((await B.from("goals").select("id").eq("id", g!.id)).data).toEqual([]);
      await B.from("goals").update({ target_weight: 1 }).eq("id", g!.id);
      expect(Number((await A.from("goals").select("target_weight").eq("id", g!.id).single()).data!.target_weight)).toBe(100);

      const onPrivate = await B.from("goals").insert({
        owner_id: bUid,
        exercise_id: aCustomExercise,
        exercise_name: "x",
        target_weight: 50,
      });
      expect(onPrivate.error?.code).toBe("42501");
      const asA = await B.from("goals").insert({ owner_id: aUid, exercise_id: bench, exercise_name: "x", target_weight: 50 });
      expect(asA.error?.code).toBe("42501");
      const invalid = await B.from("goals").insert({ owner_id: bUid, exercise_id: bench, exercise_name: "x", target_weight: -5 });
      expect(invalid.error?.code).toBe("23514");
      await A.from("goals").delete().eq("id", g!.id);
    });

    it("anonymous visitors get nothing", async () => {
      expect((await anon.from("workout_sessions").select("id")).data ?? []).toEqual([]);
      expect((await anon.from("exercises").select("id")).data ?? []).toEqual([]);
      expect((await anon.from("goals").select("id")).data ?? []).toEqual([]);
      const { error } = await anon.rpc("complete_session", { payload: payload() });
      expect(error).not.toBeNull();
    });
  });

  describe("persistence and historical integrity", () => {
    it("stores a completed workout exactly, including skipped sets and totals", async () => {
      const id = uuid();
      const { data: rid, error } = await B.rpc("complete_session", { payload: payload({ id, notes: "felt good" }) });
      expect(error).toBeNull();
      expect(rid).toBe(id);
      const { data: s } = await B.from("workout_sessions")
        .select(
          "template_name, notes, total_volume, completed_sets, session_exercises(exercise_name, position, session_sets(position, weight, reps, target_reps, completed))",
        )
        .eq("id", id)
        .single();
      expect(s!.notes).toBe("felt good");
      expect(Number(s!.total_volume)).toBe(100 * 5 + 100 * 4);
      expect(s!.completed_sets).toBe(2);
      const sets = s!.session_exercises[0].session_sets.sort((a, b) => a.position - b.position);
      expect(sets.map((x) => [Number(x.weight), x.reps, x.completed])).toEqual([
        [100, 5, true],
        [100, 4, true],
        [100, null, false],
      ]);
      expect(sets[2].target_reps).toBe(5);
    });

    it("retrying the same session (offline outbox) does not duplicate it", async () => {
      const p = payload();
      await B.rpc("complete_session", { payload: p });
      const again = await B.rpc("complete_session", { payload: p });
      expect(again.error).toBeNull();
      const { count } = await B.from("workout_sessions").select("id", { count: "exact", head: true }).eq("id", p.id);
      expect(count).toBe(1);
    });

    it("editing or deleting the routine never rewrites completed sessions", async () => {
      const { data: t } = await B.from("workout_templates").insert({ owner_id: bUid, name: "Push A" }).select("id").single();
      const { data: te } = await B.from("template_exercises")
        .insert({ owner_id: bUid, template_id: t!.id, exercise_id: bench, position: 0 })
        .select("id")
        .single();
      await B.from("template_sets").insert({ owner_id: bUid, template_exercise_id: te!.id, position: 0, target_reps: 5 });

      const id = uuid();
      await B.rpc("complete_session", { payload: payload({ id, template_id: t!.id, template_name: "Push A" }) });

      await B.from("workout_templates").update({ name: "Push A (renamed)" }).eq("id", t!.id);
      await B.from("template_exercises").update({ exercise_id: squat }).eq("id", te!.id);
      await B.from("template_sets").update({ target_reps: 12 }).eq("template_exercise_id", te!.id);
      let { data: s } = await B.from("workout_sessions")
        .select("template_id, template_name, session_exercises(exercise_id, exercise_name, session_sets(target_reps))")
        .eq("id", id)
        .single();
      expect(s).toMatchObject({ template_id: t!.id, template_name: "Push A" });
      expect(s!.session_exercises[0]).toMatchObject({ exercise_id: bench, exercise_name: "Bench Press" });
      expect(s!.session_exercises[0].session_sets.every((x) => x.target_reps === 5)).toBe(true);

      const del = await B.from("workout_templates").delete().eq("id", t!.id);
      expect(del.error).toBeNull();
      ({ data: s } = await B.from("workout_sessions")
        .select("template_id, template_name, session_exercises(exercise_name)")
        .eq("id", id)
        .single());
      expect(s).toMatchObject({ template_id: null, template_name: "Push A" });
      expect(s!.session_exercises).toHaveLength(1);
    });
  });

  describe("workout flow through the app's own data layer", () => {
    it("starts from a routine, recalls last time, logs and edits sets, and completes", async () => {
      const { data: t } = await B.from("workout_templates").insert({ owner_id: bUid, name: "Flow", est_minutes: 40 }).select("id").single();
      const { data: te } = await B.from("template_exercises")
        .insert({ owner_id: bUid, template_id: t!.id, exercise_id: bench, position: 0, rest_seconds: 90 })
        .select("id")
        .single();
      await B.from("template_sets").insert(
        [0, 1].map((position) => ({ owner_id: bUid, template_exercise_id: te!.id, position, target_reps: 6 })),
      );
      await B.rpc("complete_session", {
        payload: payload({
          started_at: "2026-10-15T10:00:00Z",
          ended_at: "2026-10-15T11:00:00Z",
          exercises: [
            {
              exercise_id: bench,
              exercise_name: "Bench Press",
              sets: [
                { weight: 90, reps: 6, completed: true },
                { weight: 92.5, reps: 5, completed: true },
              ],
            },
          ],
        }),
      });

      // imported lazily: the app module reads Supabase env, which only this configured run provides
      const { buildWorkoutFromTemplate } = await import("@/lib/workout/start");
      let w = await buildWorkoutFromTemplate(bUid, t!.id, B);
      expect(w).toMatchObject({ templateId: t!.id, templateName: "Flow", estMinutes: 40 });
      const ex = w.exercises[0];
      expect(ex).toMatchObject({ restSeconds: 90, exercise: { id: bench, name: "Bench Press", measure: "weight_reps" } });
      expect(ex.sets.map((x) => x.targetReps)).toEqual([6, 6]);
      expect(ex.previous?.sets).toEqual([
        { weight: 90, reps: 6 },
        { weight: 92.5, reps: 5 },
      ]);

      // log set 1 from the suggestion, then correct its weight; log set 2; add a third set and leave it
      w = workoutReducer(w, { type: "set.toggle", exerciseKey: ex.key, setKey: ex.sets[0].key, now: Date.now() });
      w = workoutReducer(w, { type: "set.update", exerciseKey: ex.key, setKey: ex.sets[0].key, patch: { weight: 95 } });
      w = workoutReducer(w, { type: "set.update", exerciseKey: ex.key, setKey: ex.sets[1].key, patch: { weight: 95, reps: 4 } });
      w = workoutReducer(w, { type: "set.toggle", exerciseKey: ex.key, setKey: ex.sets[1].key, now: Date.now() });
      w = workoutReducer(w, { type: "set.add", exerciseKey: ex.key, key: "extra" });
      const p = toCompletionPayload(w, new Date());
      const { error } = await B.rpc("complete_session", { payload: p as unknown as Json });
      expect(error).toBeNull();

      const { data: s } = await B.from("workout_sessions")
        .select("template_id, total_volume, completed_sets, session_exercises(session_sets(position, weight, reps, completed))")
        .eq("id", p.id)
        .single();
      expect(s!.template_id).toBe(t!.id);
      expect(s!.completed_sets).toBe(2);
      expect(Number(s!.total_volume)).toBe(95 * 6 + 95 * 4);
      expect(
        s!.session_exercises[0].session_sets.sort((a, b) => a.position - b.position).map((x) => [Number(x.weight), x.reps, x.completed]),
      ).toEqual([
        [95, 6, true],
        [95, 4, true],
        [0, null, false], // the added, unlogged set: no weight (Number(null) → 0), no reps, skipped
      ]);

      // the next start recalls this session, not the older one
      const next = await buildWorkoutFromTemplate(bUid, t!.id, B);
      expect(next.exercises[0].previous?.sets).toEqual([
        { weight: 95, reps: 6 },
        { weight: 95, reps: 4 },
      ]);
    });
  });

  describe("personal records", () => {
    const set = (weight: number | null, reps: number) => ({ weight, reps, completed: true });
    const ex = (exercise_id: string, sets: ReturnType<typeof set>[]) => ({ exercise_id, exercise_name: "x", sets });

    it("first values are baselines, later bests are records, and late-synced history is replayed", async () => {
      await wipeB();
      const s1 = uuid();
      const s2 = uuid();
      await B.rpc("complete_session", {
        payload: payload({
          id: s1,
          started_at: "2026-03-01T10:00:00Z",
          ended_at: "2026-03-01T11:00:00Z",
          exercises: [ex(squat, [set(100, 5), set(100, 5)]), ex(pullup, [set(null, 8)])],
        }),
      });
      await B.rpc("complete_session", {
        payload: payload({
          id: s2,
          started_at: "2026-03-08T10:00:00Z",
          ended_at: "2026-03-08T11:00:00Z",
          exercises: [ex(squat, [set(105, 3), set(102.5, 5)]), ex(pullup, [set(null, 7)])],
        }),
      });

      const rows = async () =>
        (await B.from("personal_records").select("session_id, exercise_id, kind, value, is_baseline").order("achieved_at")).data!.map(
          (r) => ({ ...r, value: Number(r.value) }),
        );
      let pr = await rows();
      expect(pr.filter((r) => r.session_id === s1).every((r) => r.is_baseline)).toBe(true);
      expect(pr.find((r) => r.session_id === s2 && r.kind === "heaviest_weight")).toMatchObject({ value: 105, is_baseline: false });
      // only the best set of a session counts (one heaviest row per exercise per session)
      expect(pr.filter((r) => r.session_id === s2 && r.kind === "heaviest_weight")).toHaveLength(1);
      // 7 pull-ups after 8 is not a record
      expect(pr.some((r) => r.session_id === s2 && r.exercise_id === pullup)).toBe(false);
      // e1RM is stored separately (Epley 102.5 × (1 + 5/30) = 119.6 > 105 × 1.1 = 115.5)
      expect(pr.find((r) => r.session_id === s2 && r.kind === "estimated_1rm")?.value).toBe(119.6);

      // An older session synced late, with a heavier squat, becomes the record holder
      const s0 = uuid();
      await B.rpc("complete_session", {
        payload: payload({
          id: s0,
          started_at: "2026-02-20T10:00:00Z",
          ended_at: "2026-02-20T11:00:00Z",
          exercises: [ex(squat, [set(110, 2)])],
        }),
      });
      pr = await rows();
      expect(pr.find((r) => r.kind === "heaviest_weight" && r.exercise_id === squat && r.session_id === s0)).toMatchObject({
        value: 110,
        is_baseline: true,
      });
      expect(pr.some((r) => r.kind === "heaviest_weight" && r.session_id === s2)).toBe(false);
    });

    it("clearing sample data removes only sample sessions and rebuilds records", async () => {
      const real = (await B.from("workout_sessions").select("id")).data!.length;
      await B.rpc("complete_session", {
        payload: payload({
          is_sample: true,
          started_at: "2026-04-01T10:00:00Z",
          ended_at: "2026-04-01T11:00:00Z",
          exercises: [ex(squat, [set(200, 1)])],
        }),
      });
      expect((await B.rpc("clear_sample_history")).error).toBeNull();
      const { data } = await B.from("workout_sessions").select("id, is_sample");
      expect(data!.length).toBe(real);
      expect(data!.every((s) => !s.is_sample)).toBe(true);
      const { data: best } = await B.from("personal_records").select("value").eq("kind", "heaviest_weight").eq("exercise_id", squat);
      expect(Math.max(...best!.map((b) => Number(b.value)))).toBe(110);
      // A's data untouched
      expect((await A.from("workout_sessions").select("id").eq("id", aSession)).data).toHaveLength(1);
    });
  });

  describe("validation", () => {
    const bad = async (p: unknown) => (await B.rpc("complete_session", { payload: p as never })).error?.code;
    it("rejects malformed or impossible workouts", async () => {
      expect(await bad({ ...payload(), id: null })).toBe("22023");
      expect(await bad({ ...payload(), exercises: "nope" })).toBe("22023");
      expect(await bad(payload({ exercises: [{ exercise_id: uuid(), exercise_name: "ghost", sets: [] }] }))).toBe("22023");
      expect(await bad(payload({ ended_at: "2026-10-01T09:00:00Z" }))).toBe("23514");
      expect(
        await bad(payload({ exercises: [{ exercise_id: bench, exercise_name: "x", sets: [{ weight: 50, reps: 500, completed: true }] }] })),
      ).toBe("23514");
      expect(
        await bad(payload({ exercises: [{ exercise_id: bench, exercise_name: "x", sets: [{ weight: -5, reps: 5, completed: true }] }] })),
      ).toBe("23514");
      expect(await bad({ ...payload(), id: "not-a-uuid" })).toBe("22P02");
    });

    it("leaves no partial rows behind when a workout is rejected", async () => {
      const id = uuid();
      await B.rpc("complete_session", {
        payload: payload({
          id,
          exercises: [
            { exercise_id: bench, exercise_name: "ok", sets: [{ weight: 50, reps: 5, completed: true }] },
            { exercise_id: bench, exercise_name: "bad", sets: [{ weight: 50, reps: 999, completed: true }] },
          ],
        }),
      });
      expect((await B.from("workout_sessions").select("id").eq("id", id)).data).toEqual([]);
    });
  });
});

// Generated from the Supabase schema (supabase/migrations). Regenerate after schema changes.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Rel = { foreignKeyName: string; columns: string[]; isOneToOne: boolean; referencedRelation: string; referencedColumns: string[] };
type Table<Row, Required extends keyof Row, R extends Rel[] = []> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: R;
};
type FK<Name extends string, Col extends string, Ref extends string> = {
  foreignKeyName: Name;
  columns: [Col];
  isOneToOne: false;
  referencedRelation: Ref;
  referencedColumns: ["id"];
};

export type Database = {
  __InternalSupabase: { PostgrestVersion: "14.18" };
  public: {
    Tables: {
      profiles: Table<
        {
          id: string;
          display_name: string | null;
          goal: string | null;
          experience: string | null;
          equipment: string[];
          training_days: number[];
          weekly_target: number | null;
          unit: string;
          onboarded_at: string | null;
          created_at: string;
          updated_at: string;
        },
        "id"
      >;
      exercises: Table<
        {
          id: string;
          owner_id: string | null;
          slug: string;
          name: string;
          primary_muscle: string;
          category: string;
          equipment: string;
          measure: string;
          variation_of: string | null;
          created_at: string;
        },
        "slug" | "name" | "primary_muscle" | "category" | "equipment",
        [FK<"exercises_variation_of_fkey", "variation_of", "exercises">]
      >;
      workout_templates: Table<
        {
          id: string;
          owner_id: string;
          name: string;
          focus: string | null;
          est_minutes: number | null;
          position: number;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        },
        "name"
      >;
      template_exercises: Table<
        {
          id: string;
          owner_id: string;
          template_id: string;
          exercise_id: string;
          position: number;
          rest_seconds: number;
          notes: string | null;
        },
        "template_id" | "exercise_id" | "position",
        [
          FK<"template_exercises_exercise_id_fkey", "exercise_id", "exercises">,
          FK<"template_exercises_template_id_fkey", "template_id", "workout_templates">,
        ]
      >;
      template_sets: Table<
        {
          id: string;
          owner_id: string;
          template_exercise_id: string;
          position: number;
          target_reps: number | null;
          target_weight: number | null;
        },
        "template_exercise_id" | "position",
        [FK<"template_sets_template_exercise_id_fkey", "template_exercise_id", "template_exercises">]
      >;
      workout_sessions: Table<
        {
          id: string;
          owner_id: string;
          template_id: string | null;
          template_name: string | null;
          started_at: string;
          ended_at: string;
          notes: string | null;
          total_volume: number;
          completed_sets: number;
          is_sample: boolean;
          created_at: string;
        },
        "id" | "started_at" | "ended_at",
        [FK<"workout_sessions_template_id_fkey", "template_id", "workout_templates">]
      >;
      session_exercises: Table<
        {
          id: string;
          owner_id: string;
          session_id: string;
          exercise_id: string;
          exercise_name: string;
          substituted_for: string | null;
          position: number;
          notes: string | null;
        },
        "session_id" | "exercise_id" | "exercise_name" | "position",
        [
          FK<"session_exercises_exercise_id_fkey", "exercise_id", "exercises">,
          FK<"session_exercises_session_id_fkey", "session_id", "workout_sessions">,
          FK<"session_exercises_substituted_for_fkey", "substituted_for", "exercises">,
        ]
      >;
      session_sets: Table<
        {
          id: string;
          owner_id: string;
          session_exercise_id: string;
          position: number;
          weight: number | null;
          reps: number | null;
          target_weight: number | null;
          target_reps: number | null;
          completed: boolean;
          completed_at: string | null;
        },
        "session_exercise_id" | "position",
        [FK<"session_sets_session_exercise_id_fkey", "session_exercise_id", "session_exercises">]
      >;
      personal_records: Table<
        {
          id: string;
          owner_id: string;
          exercise_id: string;
          session_id: string;
          session_set_id: string;
          kind: string;
          value: number;
          weight: number | null;
          reps: number | null;
          achieved_at: string;
          is_baseline: boolean;
        },
        "exercise_id" | "session_id" | "session_set_id" | "kind" | "value" | "achieved_at",
        [
          FK<"personal_records_exercise_id_fkey", "exercise_id", "exercises">,
          FK<"personal_records_session_id_fkey", "session_id", "workout_sessions">,
          FK<"personal_records_session_set_id_fkey", "session_set_id", "session_sets">,
        ]
      >;
      body_measurements: Table<
        {
          id: string;
          owner_id: string;
          measured_on: string;
          body_weight: number | null;
          notes: string | null;
          created_at: string;
        },
        "measured_on"
      >;
    };
    Views: {
      latest_exercise_performance: {
        Row: { owner_id: string; exercise_id: string; session_exercise_id: string; session_id: string; ended_at: string };
        Relationships: [];
      };
    };
    Functions: {
      complete_session: { Args: { payload: Json }; Returns: string };
      clear_sample_history: { Args: never; Returns: undefined };
      recompute_personal_records: { Args: never; Returns: undefined };
      derive_session_records: { Args: { sid: string }; Returns: undefined };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Row<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];

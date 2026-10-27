import type { Metadata } from "next";
import { requireProfile } from "@/lib/supabase/server";
import { RoutineEditor } from "../routine-editor";

export const metadata: Metadata = { title: "New routine" };

export default async function NewRoutinePage() {
  const { userId, profile } = await requireProfile();
  return <RoutineEditor uid={userId} unit={profile.unit} initial={{ id: null, name: "", focus: "", estMinutes: null, exercises: [] }} />;
}

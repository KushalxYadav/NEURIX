"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/session";
import { getDataMode } from "@/lib/config/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface PreferencesState {
  error?: string;
  saved?: boolean;
}

const optionalEnum = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(values).optional());

const Preferences = z.object({
  examTitle: z.string().trim().min(1, "Give the exam a name.").max(200),
  examDate: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.iso.date("Enter a valid date.").optional(),
  ),
  dailyMinutes: z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number().int().min(10, "At least 10 minutes.").max(720, "At most 12 hours.").optional(),
  ),
  knowledgeLevel: optionalEnum(["none", "beginner", "intermediate", "advanced"]),
  preferredTime: optionalEnum(["morning", "afternoon", "evening", "night", "flexible"]),
});

export async function saveStudyPreferences(_: PreferencesState, formData: FormData): Promise<PreferencesState> {
  if (getDataMode() !== "supabase") return { error: "Saving preferences needs Supabase." };
  const user = await requireUser();
  const parsed = Preferences.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const values = parsed.data;
  const subjectId = formData.get("subjectId");
  if (typeof subjectId !== "string" || !subjectId) return { error: "No active subject." };

  const supabase = await createSupabaseServerClient();
  // Ownership is re-checked here and enforced again by Row Level Security.
  const { data: subject } = await supabase.from("subjects").select("id").eq("id", subjectId).maybeSingle();
  if (!subject) return { error: "Subject not found." };

  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      daily_study_minutes: values.dailyMinutes ?? null,
      knowledge_level: values.knowledgeLevel ?? null,
      preferred_study_time: values.preferredTime ?? null,
    })
    .eq("id", user.id);
  if (profileError) return { error: "Could not save your study preferences." };

  const { data: existing } = await supabase
    .from("exams")
    .select("id")
    .eq("user_id", user.id)
    .eq("subject_id", subjectId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (values.examDate) {
    const row = { user_id: user.id, subject_id: subjectId, title: values.examTitle, exam_date: values.examDate };
    const { error } = existing
      ? await supabase.from("exams").update(row).eq("id", existing.id)
      : await supabase.from("exams").insert(row);
    if (error) return { error: "Could not save the exam date." };
  } else if (existing) {
    const { error } = await supabase.from("exams").delete().eq("id", existing.id);
    if (error) return { error: "Could not clear the exam date." };
  }
  refresh();
  return { saved: true };
}

import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Learning-state reads for the dashboard. Every row comes from what the
 * student actually did (lessons, checkpoints, quizzes, reviews); nothing is
 * estimated from page views, and empty tables stay empty in the UI.
 */
export interface UpcomingExam {
  id: string;
  title: string;
  examDate: string;
}

export interface StudyTaskRow {
  id: string;
  title: string;
  taskType: string;
  estimatedMinutes: number | null;
  status: string;
}

export interface MasteryRow {
  topicId: string;
  topicTitle: string;
  estimatedMastery: number | null;
  verifiedMastery: number | null;
}

export interface SessionRow {
  id: string;
  activity: string;
  startedAt: string;
  durationSeconds: number | null;
  topicTitle: string | null;
}

export interface LearningActivity {
  exam: UpcomingExam | null;
  todayTasks: StudyTaskRow[];
  weakTopics: MasteryRow[];
  recentSessions: SessionRow[];
  topicsWithEvidence: number;
}

export async function getLearningActivity(userId: string, subjectId: string, todayIso: string): Promise<LearningActivity> {
  const supabase = await createSupabaseServerClient();
  const [exam, tasks, weak, sessions, evidence] = await Promise.all([
    supabase
      .from("exams")
      .select("id, title, exam_date")
      .eq("user_id", userId)
      .eq("subject_id", subjectId)
      .gte("exam_date", todayIso)
      .order("exam_date")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("study_tasks")
      .select("id, title, task_type, estimated_minutes, status")
      .eq("user_id", userId)
      .eq("subject_id", subjectId)
      .eq("scheduled_date", todayIso)
      .order("priority", { ascending: false }),
    supabase
      .from("topic_mastery")
      .select("topic_id, estimated_mastery, verified_mastery, topics(title)")
      .eq("user_id", userId)
      .eq("subject_id", subjectId)
      .not("verified_mastery", "is", null)
      .lt("verified_mastery", 60)
      .order("verified_mastery")
      .limit(5),
    supabase
      .from("study_sessions")
      .select("id, activity, started_at, duration_seconds, topics(title)")
      .eq("user_id", userId)
      .eq("subject_id", subjectId)
      .order("started_at", { ascending: false })
      .limit(6),
    supabase
      .from("topic_mastery")
      .select("topic_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("subject_id", subjectId),
  ]);
  for (const result of [exam, tasks, weak, sessions, evidence]) {
    if (result.error) throw new Error(`Could not load learning activity: ${result.error.message}`);
  }
  const title = (relation: unknown): string | null => {
    const row = Array.isArray(relation) ? relation[0] : relation;
    return (row as { title?: string } | null)?.title ?? null;
  };
  return {
    exam: exam.data ? { id: exam.data.id, title: exam.data.title, examDate: exam.data.exam_date } : null,
    todayTasks: (tasks.data ?? []).map((t) => ({
      id: t.id,
      title: t.title,
      taskType: t.task_type,
      estimatedMinutes: t.estimated_minutes,
      status: t.status,
    })),
    weakTopics: (weak.data ?? []).map((m) => ({
      topicId: m.topic_id,
      topicTitle: title(m.topics) ?? "Untitled topic",
      estimatedMastery: m.estimated_mastery,
      verifiedMastery: m.verified_mastery,
    })),
    recentSessions: (sessions.data ?? []).map((s) => ({
      id: s.id,
      activity: s.activity,
      startedAt: s.started_at,
      durationSeconds: s.duration_seconds,
      topicTitle: title(s.topics),
    })),
    topicsWithEvidence: evidence.count ?? 0,
  };
}

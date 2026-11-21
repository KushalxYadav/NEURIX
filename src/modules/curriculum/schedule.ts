import type { AssessmentEvent, Curriculum, Session } from "./schemas";

/** Pure schedule logic over the curriculum (no I/O, unit-tested). */

export function sessionsByDate(sessions: Session[]): Session[] {
  return sessions.filter((s) => s.date).sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));
}

/** The next dated sessions on or after `today` (ISO date). */
export function upcomingSessions(sessions: Session[], today: string, limit = 3): Session[] {
  return sessionsByDate(sessions)
    .filter((s) => s.date! >= today)
    .slice(0, limit);
}

/** The most recent dated session before `today`. */
export function lastSession(sessions: Session[], today: string): Session | null {
  const past = sessionsByDate(sessions).filter((s) => s.date! < today);
  return past.at(-1) ?? null;
}

export interface AssessmentGroup {
  key: string;
  title: string;
  /** Earliest date among the sources that are not LMS bookkeeping. */
  date: string | null;
  events: AssessmentEvent[];
  conflict: boolean;
}

/**
 * Upcoming assessments, one row per assessment key. When sources disagree,
 * the most recently published dated source (a module schedule) comes first
 * and the other dates are kept for display.
 */
export function upcomingAssessments(events: AssessmentEvent[], today: string, horizonDays = 45): AssessmentGroup[] {
  const horizon = addDays(today, horizonDays);
  const groups = new Map<string, AssessmentEvent[]>();
  for (const event of events) {
    if (event.sourceKind === "lms") continue; // LMS "opened" dates are bookkeeping, not sittings
    const list = groups.get(event.key) ?? [];
    list.push(event);
    groups.set(event.key, list);
  }
  const rank = (e: AssessmentEvent) => (e.sourceKind === "module_schedule" ? 0 : 1);
  const out: AssessmentGroup[] = [];
  for (const [key, list] of groups) {
    const ordered = [...list].sort((a, b) => rank(a) - rank(b) || (a.date ?? "").localeCompare(b.date ?? ""));
    const primary = ordered[0];
    const dates = new Set(list.map((e) => e.date).filter(Boolean));
    if (!primary.date || primary.date < today || primary.date > horizon) continue;
    out.push({ key, title: primary.title, date: primary.date, events: ordered, conflict: dates.size > 1 || list.some((e) => Boolean(e.conflict)) });
  }
  return out.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function sessionHref(session: Pick<Session, "key">): string {
  return `/learning/${encodeURIComponent(session.key)}`;
}

export function moduleTitle(curriculum: Curriculum, module: number | null): string {
  if (module == null) return "Course";
  const found = curriculum.modules.find((m) => m.number === module);
  return found?.title ? `Module ${module} · ${found.title}` : `Module ${module}`;
}

/** Documents a student should open for a session, slides first, shared practice last. */
export function studyDocuments(session: Session) {
  const order: Record<string, number> = { slides: 0, reading: 1, activity: 2, practice: 3 };
  return [...session.documents].sort((a, b) => Number(a.shared) - Number(b.shared) || (order[a.role] ?? 9) - (order[b.role] ?? 9));
}

/** Page size of the Source Library document viewer (src/app/(app)/sources/[documentId]). */
export const SOURCE_VIEWER_PAGE_SIZE = 12;

/** Link to a specific slide/page (1-based unit number) in the Source Library viewer. */
export function sourceUnitHref(documentId: string, unitNumber: number): string {
  const page = Math.max(1, Math.ceil(unitNumber / SOURCE_VIEWER_PAGE_SIZE));
  return `/sources/${documentId}?page=${page}#unit-${unitNumber}`;
}

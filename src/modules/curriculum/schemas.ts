import { z } from "zod";

/**
 * Zod schemas for `data/processed/curriculum.json` and `questions.json`
 * (written by ingestion/synapse_ingest/curriculum.py and questions.py).
 * Snake case is mapped to the camel-case domain model here, once.
 * Unknown keys are ignored so newer pipeline versions stay readable.
 */
const str = z.string().nullable().optional().transform((v) => v ?? null);
const num = z.number().nullable().optional().transform((v) => v ?? null);
const strings = z.array(z.string()).default([]);

const Verification = z.enum(["source_confirmed", "unverified", "heuristic"]).catch("unverified");

const SessionDocument = z
  .object({
    document_id: z.string(),
    filename: z.string(),
    role: z.string(),
    shared: z.boolean().default(false),
    evidence: strings,
    verification: Verification,
  })
  .transform((d) => ({
    documentId: d.document_id,
    filename: d.filename,
    role: d.role,
    shared: d.shared,
    evidence: d.evidence,
    verification: d.verification,
  }));

const ResolvedPages = z
  .object({
    title: z.string(),
    page_start: z.number(),
    page_end: z.number(),
    matched_by: z.string().default(""),
    page_basis: z.string().default(""),
    verification: Verification,
  })
  .transform((r) => ({
    title: r.title,
    pageStart: r.page_start,
    pageEnd: r.page_end,
    matchedBy: r.matched_by,
    pageBasis: r.page_basis,
    verification: r.verification,
  }));

const FurtherReading = z
  .object({
    book_key: z.string(),
    book_document_id: z.string(),
    book_title: z.string(),
    cited_in: z.string(),
    cited_at: z.string(),
    excerpt: z.string().default(""),
    resolved: z.array(ResolvedPages).default([]),
  })
  .transform((r) => ({
    bookKey: r.book_key,
    bookDocumentId: r.book_document_id,
    bookTitle: r.book_title,
    citedIn: r.cited_in,
    citedAt: r.cited_at,
    excerpt: r.excerpt,
    resolved: r.resolved,
  }));

const Suggested = z
  .object({
    book_title: z.string(),
    book_document_id: z.string(),
    title: z.string(),
    page_start: z.number(),
    page_end: z.number(),
    score: z.number(),
  })
  .transform((s) => ({
    bookTitle: s.book_title,
    bookDocumentId: s.book_document_id,
    title: s.title,
    pageStart: s.page_start,
    pageEnd: s.page_end,
    score: s.score,
  }));

const WeekLink = z
  .object({ week_id: z.string(), ordinal: z.number(), label: z.string(), basis: z.string().default(""), verification: Verification })
  .transform((w) => ({ weekId: w.week_id, ordinal: w.ordinal, label: w.label, basis: w.basis, verification: w.verification }));

export const SessionSchema = z
  .object({
    key: z.string(),
    module: num,
    numbering: z.enum(["session", "class"]),
    number: z.number(),
    label: z.string(),
    title: z.string(),
    title_source: str,
    subtitle: str,
    driving_question: str,
    driving_question_source: str,
    objectives: strings,
    objectives_source: str,
    date: str,
    date_basis: str,
    plan_week: WeekLink.nullable().optional().transform((v) => v ?? null),
    planned_topic_match: WeekLink.nullable().optional().transform((v) => v ?? null),
    lms_units: strings,
    schedule_cover: str,
    documents: z.array(SessionDocument).default([]),
    further_reading: z.array(FurtherReading).default([]),
    suggested_textbook_sections: z.array(Suggested).default([]),
    discrepancies: strings,
  })
  .transform((s) => ({
    key: s.key,
    module: s.module,
    numbering: s.numbering,
    number: s.number,
    label: s.label,
    title: s.title,
    titleSource: s.title_source,
    subtitle: s.subtitle,
    drivingQuestion: s.driving_question,
    drivingQuestionSource: s.driving_question_source,
    objectives: s.objectives,
    objectivesSource: s.objectives_source,
    date: s.date,
    dateBasis: s.date_basis,
    planWeek: s.plan_week,
    plannedTopicMatch: s.planned_topic_match,
    lmsUnits: s.lms_units,
    scheduleCover: s.schedule_cover,
    documents: s.documents,
    furtherReading: s.further_reading,
    suggestedSections: s.suggested_textbook_sections,
    discrepancies: s.discrepancies,
  }));

const AssessmentEvent = z
  .object({
    key: z.string(),
    title: z.string().nullable().transform((v) => v ?? "Assessment"),
    date: str,
    detail: str,
    how: str,
    source: z.string(),
    source_kind: z.string(),
    conflict: str,
  })
  .transform((e) => ({
    key: e.key,
    title: e.title,
    date: e.date,
    detail: e.detail,
    how: e.how,
    source: e.source,
    sourceKind: e.source_kind,
    conflict: e.conflict,
  }));

export const CurriculumSchema = z
  .object({
    subject_key: z.string(),
    generated_at: z.string().optional(),
    course: z
      .object({
        title: str,
        course_title: str,
        course_code: str,
        credits: str,
        semester: str,
        driving_question: str,
        guiding_questions: strings,
        outcomes: z.array(z.object({ code: z.string(), text: z.string() })).default([]),
        readings: z.array(z.object({ author: z.string(), year: z.string(), title: z.string(), role: z.string() })).default([]),
      })
      .partial()
      .default({}),
    modules: z
      .array(z.object({ number: z.number(), title: str, session_keys: strings }))
      .default([]),
    sessions: z.array(SessionSchema).default([]),
    assessments: z.object({ events: z.array(AssessmentEvent).default([]) }).default({ events: [] }),
    discrepancies: z
      .array(z.object({ kind: z.string(), severity: z.string(), detail: z.string(), sources: strings }))
      .default([]),
    books: z
      .array(z.object({ key: z.string(), document_id: z.string(), title: z.string(), chapter_basis: z.string(), chapter_count: z.number().default(0) }))
      .default([]),
    module_resources: z
      .array(z.object({ document_id: z.string(), filename: z.string(), role: z.string(), module: num, note: str }))
      .default([]),
  })
  .transform((c) => ({
    subjectKey: c.subject_key,
    generatedAt: c.generated_at ?? null,
    course: {
      title: c.course.course_title ?? c.course.title ?? null,
      code: c.course.course_code ?? null,
      credits: c.course.credits ?? null,
      semester: c.course.semester ?? null,
      drivingQuestion: c.course.driving_question ?? null,
      guidingQuestions: c.course.guiding_questions ?? [],
      outcomes: c.course.outcomes ?? [],
      readings: c.course.readings ?? [],
    },
    modules: c.modules.map((m) => ({ number: m.number, title: m.title, sessionKeys: m.session_keys })),
    sessions: c.sessions,
    assessments: c.assessments.events,
    discrepancies: c.discrepancies,
    books: c.books.map((b) => ({ key: b.key, documentId: b.document_id, title: b.title, chapterBasis: b.chapter_basis, chapterCount: b.chapter_count })),
    moduleResources: c.module_resources.map((r) => ({ documentId: r.document_id, filename: r.filename, role: r.role, module: r.module, note: r.note })),
  }));

const Question = z
  .object({
    id: z.string(),
    kind: z.enum(["practice", "review"]),
    number: z.number(),
    question: z.string(),
    question_kind: str,
    level: str,
    marks: num,
    answer: str,
    document_id: z.string(),
    filename: z.string(),
    question_citation: z.string(),
    answer_citation: str,
    session_keys: strings,
    module: num,
  })
  .transform((q) => ({
    id: q.id,
    kind: q.kind,
    number: q.number,
    question: q.question,
    questionKind: q.question_kind,
    level: q.level,
    marks: q.marks,
    answer: q.answer,
    documentId: q.document_id,
    filename: q.filename,
    questionCitation: q.question_citation,
    answerCitation: q.answer_citation,
    sessionKeys: q.session_keys,
    module: q.module,
  }));

const Term = z
  .object({
    id: z.string(),
    term: z.string(),
    definition: z.string(),
    document_id: z.string(),
    citation: z.string(),
    session_keys: strings,
    module: num,
  })
  .transform((t) => ({
    id: t.id,
    term: t.term,
    definition: t.definition,
    documentId: t.document_id,
    citation: t.citation,
    sessionKeys: t.session_keys,
    module: t.module,
  }));

export const QuestionBankSchema = z.object({
  questions: z.array(Question).default([]),
  terms: z.array(Term).default([]),
});

export type Curriculum = z.output<typeof CurriculumSchema>;
export type Session = z.output<typeof SessionSchema>;
export type SessionDocument = Session["documents"][number];
export type FurtherReading = Session["furtherReading"][number];
export type AssessmentEvent = Curriculum["assessments"][number];
export type Discrepancy = Curriculum["discrepancies"][number];
export type QuestionBank = z.output<typeof QuestionBankSchema>;
export type PracticeQuestion = QuestionBank["questions"][number];
export type KeyTerm = QuestionBank["terms"][number];

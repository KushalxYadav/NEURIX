import { ArrowLeft, ChevronLeft, ChevronRight, ScanText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DataErrorPanel } from "@/components/common/data-error";
import { NoSourcesState } from "@/components/common/no-sources";
import { PageHeader } from "@/components/common/page-header";
import { Stat } from "@/components/common/stat";
import { EvidenceBadge, StatusBadge } from "@/components/common/status";
import { CopyCommand } from "@/components/sources/copy-command";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getSubjectContext } from "@/lib/server/context";
import { attempt } from "@/lib/server/load";
import { formatBytes, formatNumber, formatTimestamp } from "@/lib/utils/format";
import { DOCUMENT_TYPE_LABEL } from "@/modules/sources/timeline";
import type { DocumentUnit } from "@/modules/sources/types";

export const metadata: Metadata = { title: "Document" };

const PAGE_SIZE = 12;
const FLAG_LABELS: Record<string, string> = {
  has_table: "Table",
  has_chart: "Chart",
  has_diagram: "Diagram",
  has_equation: "Equation",
  formula_heavy: "Formulas",
  has_content_images: "Images",
  needs_ocr: "Needs OCR",
  hidden: "Hidden slide",
  extraction_error: "Extraction error",
};

type Params = Promise<{ documentId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function DocumentPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <>
      <Link href="/sources" className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" /> Source Library
      </Link>
      <Suspense fallback={<Skeleton className="h-[520px] rounded-[var(--radius-card)]" />}>
        <DocumentDetail params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

function unitHeading(unit: DocumentUnit): string {
  if (unit.unitType === "slide") return `Slide ${unit.slideNumber}`;
  if (unit.unitType === "page") {
    if (unit.pageLabel && unit.pageLabel !== String(unit.pageNumber)) return `Page ${unit.pageLabel} · PDF page ${unit.pageNumber}`;
    return `Page ${unit.pageLabel ?? unit.pageNumber}`;
  }
  return `Section ${unit.unitNumber}`;
}

async function DocumentDetail({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ documentId }, query] = await Promise.all([params, searchParams]);
  const pageParam = Number(typeof query.page === "string" ? query.page : 1);
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

  const loaded = await attempt(async () => {
    const context = await getSubjectContext();
    if (!context.subject) return { ...context, document: null, units: null };
    const subjectId = context.subject.id;
    const [document, units] = await Promise.all([
      context.repo.getDocument(subjectId, documentId),
      context.repo.listDocumentUnits(subjectId, documentId, { offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE }),
    ]);
    return { ...context, document, units };
  });
  if (!loaded.ok) return <DataErrorPanel error={loaded.error} />;
  const { subject, repo, document, units } = loaded.value;
  if (!subject) return <NoSourcesState mode={repo.mode} />;
  if (!document || !units) notFound();

  const pages = Math.max(1, Math.ceil(units.total / PAGE_SIZE));
  const reprocess = `.venv/bin/python scripts/run_pipeline.py --only "${document.sourcePath}"${
    repo.mode === "supabase" ? " && .venv/bin/python scripts/load_to_database.py --owner-email <you>" : ""
  }`;

  return (
    <div className="animate-fade-up">
      <PageHeader
        eyebrow={DOCUMENT_TYPE_LABEL[document.documentType]}
        title={<span className="break-all">{document.originalFilename}</span>}
        description={document.title && document.title !== document.originalFilename ? document.title : undefined}
        actions={<StatusBadge status={document.processingStatus} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="grid grid-cols-2 gap-5 pt-5 sm:grid-cols-4">
            <Stat label="Size" value={formatBytes(document.sizeBytes)} />
            <Stat
              label={document.slideCount != null ? "Slides" : document.pageCount != null ? "Pages" : "Sections"}
              value={formatNumber(document.slideCount ?? document.pageCount ?? document.unitCount)}
            />
            <Stat label="Words" value={formatNumber(document.wordCount)} />
            <Stat label="Passages" value={formatNumber(document.chunkCount)} />
            <div className="col-span-2 text-[12.5px] text-subtle sm:col-span-4">
              {document.archivePaths.map((p) => <div key={p} className="break-all font-mono">{p}</div>)}
              {document.convertedFrom && <div className="mt-1">Converted from legacy file {document.convertedFrom} with LibreOffice.</div>}
              <div className="mt-1">Processed {formatTimestamp(document.processedAt)}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Weeks</CardTitle>
          </CardHeader>
          <CardContent>
            {document.weekAssociations.length === 0 ? (
              <p className="text-[13px] text-muted">
                {document.documentType === "textbook"
                  ? "The textbook supports every week; chapter links appear on each week’s page."
                  : "Not linked to any week in the overview."}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {document.weekAssociations.map((a) => (
                  <li key={`${a.weekId}-${a.source}`}>
                    <Link href={`/weekly-overview/${a.weekId}`} className="flex flex-wrap items-center gap-2 text-[13.5px] hover:underline">
                      Week {a.weekOrdinal} <EvidenceBadge evidence={a.evidence} />
                    </Link>
                    {a.note && <div className="mt-0.5 text-[12px] text-subtle">{a.note}</div>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {(document.errors.length > 0 || document.warnings.length > 0) && (
        <div className="mt-4 flex flex-col gap-2">
          {document.errors.map((error, i) => (
            <div key={`e${i}`} role="alert" className="whitespace-pre-line rounded-xl border border-danger/25 bg-danger-soft px-3 py-2 text-[13px] text-danger">
              {error}
            </div>
          ))}
          {document.warnings.map((warning, i) => (
            <div key={`w${i}`} className="rounded-xl border border-warning/25 bg-warning-soft px-3 py-2 text-[13px] text-warning">{warning}</div>
          ))}
        </div>
      )}

      {document.chapters.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Chapters</CardTitle>
            <EvidenceBadge evidence={document.chapters.every((c) => c.source === "pdf_outline" || c.source === "docx_heading") ? "source_confirmed" : "unverified"} />
          </CardHeader>
          <CardContent>
            <ol className="grid gap-2 sm:grid-cols-2">
              {document.chapters.map((chapter) => (
                <li key={chapter.index} className="rounded-xl border border-border bg-surface px-3 py-2">
                  <div className="text-[13.5px] font-medium">{chapter.title}</div>
                  {chapter.pageStart != null && (
                    <div className="text-[12px] text-subtle">PDF pages {chapter.pageStart}–{chapter.pageEnd}</div>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {document.ocrPages.length > 0 && (
        <div className="mt-4 flex gap-2 rounded-xl border border-warning/25 bg-warning-soft px-3 py-2 text-[13px] text-warning">
          <ScanText aria-hidden className="mt-0.5 size-4 shrink-0" />
          {document.ocrPages.length} scanned page(s) contain no extractable text (PDF pages {document.ocrPages.slice(0, 12).join(", ")}
          {document.ocrPages.length > 12 ? "…" : ""}). Re-run with <code className="font-mono">--ocr</code> if OCRmyPDF is installed.
        </div>
      )}

      <section aria-labelledby="content-heading" className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="content-heading" className="text-[15px] font-semibold">Extracted content</h2>
            <p className="text-[13px] text-muted">Exactly what SYNAPSE can cite, with the original slide and page numbers.</p>
          </div>
          {pages > 1 && <Pager documentId={document.id} page={page} pages={pages} />}
        </div>
        {units.items.length === 0 ? (
          <p className="glass rounded-2xl p-5 text-[13.5px] text-muted">No extracted content for this document.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {units.items.map((unit) => (
              <li key={unit.id} className="glass rounded-2xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[13px] font-semibold text-foreground">
                    {unitHeading(unit)}
                    {unit.title && <span className="ml-2 font-normal text-muted">{unit.title}</span>}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(unit.flags)
                      .filter(([key, value]) => value && FLAG_LABELS[key])
                      .map(([key]) => (
                        <Badge key={key} tone={key === "needs_ocr" || key === "extraction_error" ? "warning" : "neutral"}>
                          {FLAG_LABELS[key]}
                        </Badge>
                      ))}
                  </div>
                </div>
                {(unit.chapterTitle || unit.headingPath.length > 0) && (
                  <div className="mt-0.5 text-[12px] text-subtle">{unit.headingPath.length ? unit.headingPath.join(" › ") : unit.chapterTitle}</div>
                )}
                <div className="source-text mt-2 text-[13.5px] leading-relaxed text-muted">
                  {unit.text || <span className="italic text-subtle">No text on this {unit.unitType}.</span>}
                </div>
                {unit.notes && (
                  <details className="mt-2 text-[13px]">
                    <summary className="cursor-pointer text-primary">Speaker notes</summary>
                    <div className="source-text mt-1 text-muted">{unit.notes}</div>
                  </details>
                )}
                <div className="mt-3 font-mono text-[11.5px] text-subtle">Cite as: {unit.citation}</div>
              </li>
            ))}
          </ol>
        )}
        {pages > 1 && (
          <div className="mt-4 flex justify-end">
            <Pager documentId={document.id} page={page} pages={pages} />
          </div>
        )}
      </section>

      <Card className="mt-8 p-5">
        <h2 className="text-[15px] font-semibold">Reprocess this document</h2>
        <p className="mt-1 text-[13px] text-muted">Re-extracts only this file from your local archive; other files stay cached.</p>
        <div className="mt-3"><CopyCommand command={reprocess} /></div>
      </Card>
    </div>
  );
}

function Pager({ documentId, page, pages }: { documentId: string; page: number; pages: number }) {
  return (
    <nav aria-label="Content pages" className="flex items-center gap-2 text-[13px] text-muted">
      <Button asChild variant="secondary" size="sm" className={page <= 1 ? "pointer-events-none opacity-40" : ""}>
        <Link href={`/sources/${documentId}?page=${page - 1}`} aria-disabled={page <= 1} scroll={false}>
          <ChevronLeft aria-hidden /> Prev
        </Link>
      </Button>
      <span className="tabular-nums">{page} / {pages}</span>
      <Button asChild variant="secondary" size="sm" className={page >= pages ? "pointer-events-none opacity-40" : ""}>
        <Link href={`/sources/${documentId}?page=${page + 1}`} aria-disabled={page >= pages} scroll={false}>
          Next <ChevronRight aria-hidden />
        </Link>
      </Button>
    </nav>
  );
}

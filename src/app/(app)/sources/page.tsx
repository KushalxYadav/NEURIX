import { ChevronDown, FileWarning } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DataErrorPanel } from "@/components/common/data-error";
import { NoSourcesState } from "@/components/common/no-sources";
import { PageHeader } from "@/components/common/page-header";
import { Stat } from "@/components/common/stat";
import { StatusBadge } from "@/components/common/status";
import { CopyCommand } from "@/components/sources/copy-command";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getSubjectContext } from "@/lib/server/context";
import { attempt } from "@/lib/server/load";
import { formatBytes, formatNumber, formatTimestamp, pluralize } from "@/lib/utils/format";
import { DOCUMENT_TYPE_LABEL } from "@/modules/sources/timeline";
import type { DocumentSummary } from "@/modules/sources/types";

export const metadata: Metadata = { title: "Source Library" };

export default function SourcesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Source Library"
        title="Your course material"
        description="Every file from your archive, what SYNAPSE extracted from it, and anything that could not be processed."
      />
      <Suspense fallback={<Skeleton className="h-[480px] rounded-[var(--radius-card)]" />}>
        <Library />
      </Suspense>
    </>
  );
}

function unitsLabel(document: DocumentSummary): string {
  if (document.slideCount != null) return pluralize(document.slideCount, "slide");
  if (document.pageCount != null) return pluralize(document.pageCount, "page");
  if (document.unitCount) return pluralize(document.unitCount, "section");
  return "—";
}

async function Library() {
  const loaded = await attempt(async () => {
    const context = await getSubjectContext();
    if (!context.subject) return { ...context, documents: [], files: [] };
    const [documents, files] = await Promise.all([
      context.repo.listDocuments(context.subject.id),
      context.repo.listFiles(context.subject.id),
    ]);
    return { ...context, documents, files };
  });
  if (!loaded.ok) return <DataErrorPanel error={loaded.error} />;
  const { subject, repo, documents, files } = loaded.value;
  if (!subject) return <NoSourcesState mode={repo.mode} />;

  const count = (status: string) => documents.filter((d) => d.processingStatus === status).length;
  const problemFiles = files.filter((f) => f.processingStatus === "failed" || f.processingStatus === "rejected");
  const reloadSuffix = repo.mode === "supabase" ? " && .venv/bin/python scripts/load_to_database.py --owner-email <you>" : "";

  return (
    <div className="animate-fade-up flex flex-col gap-6">
      <Card>
        <CardContent className="grid grid-cols-2 gap-5 pt-5 sm:grid-cols-5">
          <Stat label="Archive" value={<span className="text-base">{subject.archiveFilename ?? "—"}</span>} />
          <Stat label="Study documents" value={formatNumber(documents.length)} />
          <Stat label="Processed" value={formatNumber(count("completed"))} />
          <Stat label="Partial" value={formatNumber(count("partially_processed"))} />
          <Stat label="Failed" value={formatNumber(count("failed"))} />
        </CardContent>
      </Card>

      {problemFiles.length > 0 && (
        <div role="status" className="flex gap-3 rounded-[var(--radius-card)] border border-danger/25 bg-danger-soft p-4">
          <FileWarning aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="text-[13.5px]">
            <div className="font-medium text-foreground">
              {problemFiles.length === 1 ? "1 file was not processed" : `${problemFiles.length} files were not processed`}
            </div>
            <ul className="mt-1 space-y-1 text-muted">
              {problemFiles.map((file) => (
                <li key={file.path}>
                  <code className="font-mono text-foreground">{file.path}</code> — {file.reason?.split("\n")[0] ?? file.processingStatus}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <section aria-labelledby="documents-heading">
        <h2 id="documents-heading" className="mb-3 text-[15px] font-semibold">Study documents</h2>
        <ul className="flex flex-col gap-2">
          {documents.map((document) => (
            <li key={document.id}>
              <Link
                href={`/sources/${document.id}`}
                className="glass grid gap-3 rounded-2xl p-4 transition-colors hover:border-border-strong sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all text-[14px] font-medium text-foreground">{document.originalFilename}</span>
                    <StatusBadge status={document.processingStatus} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-subtle">
                    <span>{DOCUMENT_TYPE_LABEL[document.documentType]}</span>
                    <span>{formatBytes(document.sizeBytes)}</span>
                    <span>{unitsLabel(document)}</span>
                    <span>{pluralize(document.chunkCount, "passage")}</span>
                    <span className="break-all">{document.sourcePath}</span>
                  </div>
                  {(document.errors[0] || document.warnings[0]) && (
                    <div className={`mt-1.5 line-clamp-2 text-[12.5px] ${document.errors[0] ? "text-danger" : "text-warning"}`}>
                      {(document.errors[0] ?? document.warnings[0]).split("\n")[0]}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 sm:justify-end">
                  {document.weekAssociations.length === 0 ? (
                    <Badge tone="neutral">No week</Badge>
                  ) : (
                    document.weekAssociations.map((a) => (
                      <Badge
                        key={`${a.weekId}-${a.source}`}
                        tone={a.evidence === "source_confirmed" ? "success" : "warning"}
                        title={a.note ?? undefined}
                      >
                        Week {a.weekOrdinal}
                        {a.evidence === "source_confirmed" ? "" : " ?"}
                      </Badge>
                    ))
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] text-subtle">Week badges marked “?” were matched from a filename and need verification.</p>
      </section>

      <Card className="p-5">
        <h2 className="text-[15px] font-semibold">Reprocess</h2>
        <p className="mt-1 text-[13px] text-muted">
          Extraction runs locally where your archive lives. Re-run everything (cached files are skipped), or one document with{" "}
          <code className="font-mono">--only</code> as shown on each document’s page.
          {subject.processedAt && <> Last run: {formatTimestamp(subject.processedAt)}.</>}
        </p>
        <div className="mt-3">
          <CopyCommand command={`.venv/bin/python scripts/run_pipeline.py${reloadSuffix}`} />
        </div>
      </Card>

      <details className="glass group rounded-[var(--radius-card)]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 [&::-webkit-details-marker]:hidden">
          <div>
            <h2 className="text-[15px] font-semibold">All files in the archive ({formatNumber(files.length)})</h2>
            <p className="mt-1 text-[13px] text-muted">Including images, duplicates and files that are not study documents.</p>
          </div>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-subtle transition-transform group-open:rotate-180" />
        </summary>
        <div className="scrollbar-thin overflow-x-auto px-5 pb-5">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="text-[12px] text-subtle">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">Path</th>
                <th scope="col" className="py-2 pr-3 font-medium">Type</th>
                <th scope="col" className="py-2 pr-3 font-medium">Size</th>
                <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                <th scope="col" className="py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {files.map((file) => (
                <tr key={file.path}>
                  <td className="py-2 pr-3 font-mono text-[12px] text-foreground">{file.path}</td>
                  <td className="py-2 pr-3 text-muted">{file.category.replaceAll("_", " ")}</td>
                  <td className="py-2 pr-3 tabular-nums text-muted">{formatBytes(file.sizeBytes)}</td>
                  <td className="py-2 pr-3"><StatusBadge status={file.processingStatus} /></td>
                  <td className="py-2 text-[12px] text-subtle">{file.reason?.split("\n")[0] ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

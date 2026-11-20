import { BookOpen, FileText, Presentation, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { CoverageWeekRow } from "@/modules/sources/types";

/** Per-week source coverage chips (what material exists, never learning progress). */
export function WeekCoverageChips({ row }: { row: CoverageWeekRow | undefined }) {
  if (!row) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge tone="neutral">
        <FileText aria-hidden /> In overview
      </Badge>
      {row.lectureMaterialConfirmed ? (
        <Badge tone="success">
          <Presentation aria-hidden /> Lecture slides
        </Badge>
      ) : row.lectureMaterial ? (
        <Badge tone="warning" title="Matched from a filename, not linked in the overview">
          <Presentation aria-hidden /> Slides (unverified)
        </Badge>
      ) : row.lectureMaterialFailed ? (
        <Badge tone="danger" title="A lecture file is linked but could not be processed — see Source Library">
          <Presentation aria-hidden /> Slides failed to process
        </Badge>
      ) : (
        <Badge tone="danger">
          <Presentation aria-hidden /> No lecture file
        </Badge>
      )}
      {row.textbookReferenceInOverview && (
        <Badge tone="info">
          <BookOpen aria-hidden /> Textbook reference
        </Badge>
      )}
      {row.needsVerification && (
        <Badge tone="warning">
          <TriangleAlert aria-hidden /> Verify mapping
        </Badge>
      )}
    </div>
  );
}

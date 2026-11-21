import { BookMarked, LogOut } from "lucide-react";

import { StatusBadge } from "@/components/common/status";
import { Skeleton } from "@/components/ui/skeleton";
import { signOut } from "@/app/auth/actions";
import { getSubjectContext } from "@/lib/server/context";
import { attempt } from "@/lib/server/load";

/** Active subject + account, shown at the bottom of the navigation. */
export async function SubjectChip() {
  const loaded = await attempt(getSubjectContext);
  if (!loaded.ok) return null; // the page itself renders the data error
  const { viewer, subject } = loaded.value;
  return (
    <div className="flex flex-col gap-2">
      <div className="glass rounded-2xl p-3">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-subtle">
          <BookMarked aria-hidden className="size-3.5" /> Active subject
        </div>
        {subject ? (
          <>
            <div className="mt-1.5 line-clamp-2 text-[13.5px] font-medium text-foreground" title={subject.name}>
              {subject.name}
            </div>
            <div className="mt-2">
              <StatusBadge status={subject.ingestionStatus} />
            </div>
          </>
        ) : (
          <div className="mt-1.5 text-[13px] text-muted">No study material processed yet</div>
        )}
      </div>
      {viewer.kind === "user" && (
        <form action={signOut} className="flex items-center justify-between gap-2 px-1">
          <span className="truncate text-[12px] text-subtle" title={viewer.email ?? undefined}>
            {viewer.email}
          </span>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-muted hover:bg-surface-strong hover:text-foreground"
          >
            <LogOut aria-hidden className="size-3.5" /> Sign out
          </button>
        </form>
      )}
    </div>
  );
}

export function SubjectChipSkeleton() {
  return (
    <div className="glass rounded-2xl p-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-2.5 h-4 w-40" />
      <Skeleton className="mt-2.5 h-5 w-24 rounded-full" />
    </div>
  );
}

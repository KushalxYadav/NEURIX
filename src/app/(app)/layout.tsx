import { Suspense, type ReactNode } from "react";

import { LocalModeBanner } from "@/components/shell/local-mode-banner";
import { Wordmark } from "@/components/shell/logo";
import { MobileNav } from "@/components/shell/mobile-nav";
import { NavLinks } from "@/components/shell/nav-links";
import { SubjectChip, SubjectChipSkeleton } from "@/components/shell/subject-chip";
import { getDataMode } from "@/lib/config/env";

export default function AppLayout({ children }: { children: ReactNode }) {
  const localMode = getDataMode() === "local";
  const chip = (
    <Suspense fallback={<SubjectChipSkeleton />}>
      <SubjectChip />
    </Suspense>
  );
  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-primary-strong focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <aside className="scrollbar-thin fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col gap-7 overflow-y-auto border-r border-border bg-background-raised/80 px-4 py-5 backdrop-blur-xl lg:flex">
        <div className="px-1">
          <Wordmark />
        </div>
        <NavLinks />
        <div className="mt-auto">{chip}</div>
      </aside>

      <div className="min-w-0 lg:pl-[264px]">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-xl lg:hidden">
          <MobileNav header={<Wordmark />} footer={chip} />
          <Wordmark />
        </header>
        {localMode && <LocalModeBanner />}
        <main id="main" className="mx-auto w-full max-w-[1180px] px-4 py-7 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}

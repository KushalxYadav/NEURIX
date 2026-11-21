import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export function EmptyState({
  icon: Icon,
  title,
  children,
  actions,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("glass flex flex-col items-center rounded-[var(--radius-card)] px-6 py-12 text-center", className)}>
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-border-strong bg-surface-strong">
        <Icon aria-hidden className="size-5 text-primary" />
      </div>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {children && <div className="mt-2 max-w-md text-[13.5px] leading-relaxed text-muted">{children}</div>}
      {actions && <div className="mt-5 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { cn } from "@/lib/utils/cn";

import { NAV_GROUPS, isActive } from "./nav-items";

/** Reads the current route; must sit inside <Suspense> (route data is runtime-only). */
function ActiveNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return <NavList pathname={usePathname()} onNavigate={onNavigate} />;
}

/**
 * The static shell renders the links without an active state; the highlight
 * streams in once the pathname is known.
 */
export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Suspense fallback={<NavList pathname={null} onNavigate={onNavigate} />}>
      <ActiveNavLinks onNavigate={onNavigate} />
    </Suspense>
  );
}

function NavList({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  const reduceMotion = useReducedMotion();
  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-subtle">{group.label}</div>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = pathname !== null && isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex h-9 items-center gap-3 rounded-xl px-3 text-[13.5px] transition-colors",
                      active
                        ? "bg-primary-soft text-foreground"
                        : "text-muted hover:bg-surface-strong hover:text-foreground",
                    )}
                  >
                    {active && (
                      <motion.span
                        aria-hidden
                        layoutId={onNavigate ? "nav-active-mobile" : "nav-active"}
                        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 40 }}
                        className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary"
                      />
                    )}
                    <Icon
                      aria-hidden
                      className={cn("size-[17px] shrink-0", active ? "text-primary" : "text-subtle group-hover:text-muted")}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

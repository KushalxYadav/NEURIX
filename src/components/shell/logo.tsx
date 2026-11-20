import { cn } from "@/lib/utils/cn";

/** Two neurons and the gap between them: the synapse. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8", className)} fill="none">
      {/* Solid colours (no gradient ids): ids collide when a copy is hidden with display:none. */}
      <rect x="0.5" y="0.5" width="31" height="31" rx="9" fill="#0e1220" stroke="rgb(148 163 184 / 0.22)" />
      <path d="M7 11.5c3 0 4.5 2 5.8 4.5M7 20.5c3 0 4.5-2 5.8-4.5" stroke="#a497ff" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M25 11.5c-3 0-4.5 2-5.8 4.5M25 20.5c-3 0-4.5-2-5.8-4.5" stroke="#5fa8ff" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="13.6" cy="16" r="1.9" fill="#a497ff" />
      <circle cx="18.4" cy="16" r="1.9" fill="#5fa8ff" />
      <circle cx="16" cy="16" r="0.75" fill="#e7eaf3" opacity="0.9" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-[0.18em] text-foreground">SYNAPSE</div>
        <div className="text-[11px] text-subtle">Your Personal Learning OS</div>
      </div>
    </div>
  );
}

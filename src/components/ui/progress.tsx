import { cn } from "@/lib/utils/cn";

export function ProgressBar({
  value,
  label,
  tone = "primary",
  className,
}: {
  value: number;
  label: string;
  tone?: "primary" | "success" | "warning";
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const fill = { primary: "bg-primary", success: "bg-success", warning: "bg-warning" }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-strong", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-700", fill)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

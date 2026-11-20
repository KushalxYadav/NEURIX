const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(value >= 10 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}

export function formatNumber(value: number | null | undefined): string {
  return value == null ? "—" : new Intl.NumberFormat("en").format(value);
}

/** Formats an ISO date (YYYY-MM-DD) without timezone shifts. */
export function formatIsoDate(iso: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return iso;
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC", ...options }).format(date);
}

export function formatDateRange(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start) return null;
  if (!end || end === start) return formatIsoDate(start);
  return `${formatIsoDate(start)} – ${formatIsoDate(end)}`;
}

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

/** Whole days from `today` to `target` (both ISO dates); negative when past. */
export function daysUntil(targetIso: string, todayIso: string): number {
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(targetIso) - toUtc(todayIso)) / 86_400_000);
}

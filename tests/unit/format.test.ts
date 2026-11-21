import { describe, expect, it } from "vitest";

import { daysUntil, formatBytes, formatDateRange, formatIsoDate, pluralize } from "@/lib/utils/format";
import { safeNextPath } from "@/lib/utils/redirect";

describe("format", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(97 * 1024 * 1024)).toBe("97 MB");
    expect(formatBytes(null)).toBe("—");
  });

  it("formats ISO dates without timezone drift", () => {
    expect(formatIsoDate("2026-08-04")).toBe("Aug 4");
    expect(formatDateRange("2026-08-04", "2026-08-10")).toBe("Aug 4 – Aug 10");
    expect(formatDateRange("2026-08-04", "2026-08-04")).toBe("Aug 4");
    expect(formatDateRange(null, null)).toBeNull();
  });

  it("counts days between ISO dates", () => {
    expect(daysUntil("2026-12-10", "2026-11-20")).toBe(20);
    expect(daysUntil("2026-11-19", "2026-11-20")).toBe(-1);
  });

  it("pluralizes", () => {
    expect(pluralize(1, "slide")).toBe("1 slide");
    expect(pluralize(3, "slide")).toBe("3 slides");
  });
});

describe("safeNextPath", () => {
  it("allows only same-site relative paths", () => {
    expect(safeNextPath("/sources/abc?page=2")).toBe("/sources/abc?page=2");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
  });
});

import { expect, test, type Page } from "@playwright/test";

import { NAV } from "./nav";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function openNav(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
  return page.getByRole("navigation", { name: "Main" }).last();
}

test("dashboard summarises the processed subject honestly", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Fixture Networks 101" })).toBeVisible();
  await expect(page.getByText("Material available per week — not a measure of learning.")).toBeVisible();
  await expect(page.getByText("1 file failed")).toBeVisible();
  await expect(page.getByText("Teaching weeks finished — revision time")).toBeVisible();
  await expect(page.getByText(/Local mode/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("every navigation section loads with one page heading", async ({ page, isMobile }) => {
  const errors = collectErrors(page);
  await page.goto("/dashboard");
  for (const item of NAV) {
    const nav = await openNav(page, isMobile);
    await nav.getByRole("link", { name: item.label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${item.href}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("main")).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("weekly timeline → week → lecture slides with citations", async ({ page }) => {
  await page.goto("/weekly-overview");
  const weeks = page.getByRole("main").getByRole("listitem").filter({ has: page.getByRole("heading", { level: 2 }) });
  await expect(weeks).toHaveCount(3);
  await expect(page.getByText("11 August - 17 August")).toBeVisible();
  await expect(page.getByText("Slides failed to process")).toBeVisible();
  await expect(page.getByText("Slides (unverified)")).toBeVisible();

  await page.getByRole("link", { name: /Week 1/ }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("4 August - 10 August");
  await expect(page.getByText("Describe the fixture layer model")).toBeVisible();
  await expect(page.getByText("Chapter 1 Fixture Layers")).toBeVisible();

  await page.getByRole("link", { name: /Lecture01_intro\.pptx/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lecture01_intro.pptx");
  await expect(page.getByText("Cite as: Lecture01_intro.pptx, slide 2 — The Fixture Model")).toBeVisible();
  await page.getByText("Speaker notes").click();
  await expect(page.getByText("Speaker note: emphasise that this is synthetic.")).toBeVisible();
});

test("source library reports failures and pages through the textbook", async ({ page }) => {
  await page.goto("/sources");
  await expect(page.getByText("1 file was not processed")).toBeVisible();
  await expect(page.getByText(/source file could not be loaded/).first()).toBeVisible();
  await page.getByText(/All files in the archive/).click();
  await expect(page.getByRole("cell", { name: "__MACOSX/._index.html" })).toBeVisible();

  await page.getByRole("link", { name: /Fixture_Networking_Textbook\.pdf/ }).click();
  await expect(page.getByText("Chapter 2 Fixture Transport").first()).toBeVisible();
  await expect(page.getByText(/scanned page\(s\) contain no extractable text/)).toBeVisible();
  await expect(page.getByText("Page i", { exact: false }).first()).toBeVisible();
  await page.getByRole("link", { name: "Next" }).first().click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText("Cite as: Fixture_Networking_Textbook.pdf, p. 10 (PDF page 13)")).toBeVisible();
});

test("auth pages explain local mode, health hides secrets", async ({ page, request }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Accounts are off in local mode" })).toBeVisible();
  const health = await request.get("/api/health");
  expect(health.ok()).toBe(true);
  const body = await health.json();
  expect(body).toMatchObject({ status: "ok", dataMode: "local" });
  expect(JSON.stringify(body)).not.toMatch(/key|secret|token/i);
});

test("unknown documents show a not-found state", async ({ page }) => {
  await page.goto("/sources/00000000-0000-0000-0000-000000000000");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
});

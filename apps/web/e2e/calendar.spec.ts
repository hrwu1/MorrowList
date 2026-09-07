import { expect, test, type Page } from "@playwright/test";

async function signup(page: Page) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Calendar Tester");
  await page.getByLabel("Email").fill(`calendar-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
}

test("month/week, dated capture, drag and keyboard reschedule, subscription revocation", async ({
  page,
}) => {
  test.setTimeout(90000);
  await signup(page);
  await page.goto("/upcoming");
  await page.getByRole("link", { name: "Open Calendar" }).click();
  await page.goto("/calendar?date=2026-09-07");
  await expect(
    page.getByRole("heading", { name: "Calendar", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".calendar-day")).toHaveCount(42);
  await page
    .getByRole("button", { name: "Add task on 2026-09-07", exact: true })
    .click();
  const capture = page.getByPlaceholder("Add a task and press Enter");
  await capture.fill("Calendar sample");
  await capture.press("Enter");
  const chip = page.locator('.calendar-day[data-date="2026-09-07"] .calendar-chip');
  await expect(chip).toContainText("Calendar sample");
  const drag = chip.getByRole("button", { name: "Reschedule Calendar sample" });
  const target = page.locator('.calendar-day[data-date="2026-09-08"]');
  await drag.scrollIntoViewIfNeeded();
  const a = await drag.boundingBox();
  const b = await target.boundingBox();
  if (!a || !b) throw new Error("Missing drag targets");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 15, a.y + a.height / 2, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  // dnd-kit retains its document click blocker for 50ms after pointer release.
  await page.waitForTimeout(60);
  await expect(target).toContainText("Calendar sample");
  await page
    .getByRole("button", { name: "Add task on 2026-09-08", exact: true })
    .click();
  const list = page.getByRole("region", { name: "Tasks on 2026-09-08" });
  await list.getByRole("button", { name: "Edit Calendar sample" }).click();
  await list
    .getByRole("listitem")
    .getByLabel("Planned", { exact: true })
    .fill("2026-09-09");
  await expect(page.locator('.calendar-day[data-date="2026-09-09"]')).toContainText(
    "Calendar sample",
  );
  const day = page.getByRole("button", { name: "Add task on 2026-09-08", exact: true });
  await day.focus();
  await day.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "Add task on 2026-09-09", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await expect(page.locator(".calendar-day")).toHaveCount(7);
  await page.locator('.calendar-day[data-date="2026-09-09"] .calendar-chip a').click();
  await expect(page.getByRole("complementary", { name: /Task details/ })).toBeVisible();
  await page.screenshot({ path: "test-results/calendar-week.png", fullPage: true });
  await page
    .getByRole("complementary", { name: /Task details/ })
    .getByRole("button", { name: "Close task details", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Tasks on 2026-09-09" })
      .getByRole("link", { name: "Calendar sample", exact: true }),
  ).toBeFocused();
  await page.goto("/calendar?date=2026-09-13&layout=week");
  const boundary = page.getByRole("button", {
    name: "Add task on 2026-09-13",
    exact: true,
  });
  await boundary.focus();
  await boundary.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "Add task on 2026-09-14", exact: true }),
  ).toBeFocused();
  await page.goto("/settings/calendar");
  await page.getByRole("button", { name: "Create feed URL", exact: true }).click();
  const url = await page
    .getByRole("textbox", { name: "Private calendar feed URL" })
    .inputValue();
  const feed = await page.request.get(url);
  expect(feed.status()).toBe(200);
  expect(await feed.text()).toContain("Calendar sample");
  await page.getByRole("button", { name: "Revoke feed URL" }).click();
  await expect(
    page.getByText("No calendar feed is active.", { exact: true }),
  ).toBeVisible();
  expect((await page.request.get(url)).status()).toBe(404);
});

test("calendar fits a narrow screen and day selection remains usable", async ({
  page,
}) => {
  test.setTimeout(60000);
  await signup(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/calendar?date=2026-09-07");
  await page
    .getByRole("button", { name: "Add task on 2026-09-08", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Tasks on 2026-09-08" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/calendar-mobile.png", fullPage: true });
});

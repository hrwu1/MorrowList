import { expect, test, type Page } from "@playwright/test";

import { openSection } from "./disclosures";

/**
 * The daily loop (spec 9.2, 9.3): choose work for today, see it in Today, finish it
 * there; give work a date and find it in Upcoming; and review yesterday's leftovers
 * without anything rolling forward on its own.
 */

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page) {
  const email = `today-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Today Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
}

async function capture(page: Page, title: string) {
  const field = page.getByPlaceholder("Add a task and press Enter");
  await field.fill(title);
  await field.press("Enter");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
}

/** The workspace's calendar date, as the server evaluates it (spec 12.3). */
async function workspaceToday(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const view = await (
      await fetch("/api/v1/views/today", { credentials: "include" })
    ).json();
    return view.data.date as string;
  });
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function row(page: Page, title: string) {
  return page.getByRole("listitem").filter({ hasText: title });
}

test("the root URL lands in Today", async ({ page }) => {
  await signUp(page);
  await page.goto("/");

  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Nothing needs you today" }),
  ).toBeVisible();
});

test("adds a task to My Day, sees it in Today, and completes it inline", async ({
  page,
}) => {
  await signUp(page);
  await capture(page, "Chosen for the day");

  await page.getByRole("button", { name: "Edit Chosen for the day" }).click();
  await page.getByRole("button", { name: "Add Chosen for the day to My Day" }).click();
  await expect(
    row(page, "Chosen for the day").getByText("My Day", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove Chosen for the day from My Day" }),
  ).toBeVisible();

  const todayLink = page.getByRole("link", { name: "Today", exact: true });
  await expect(todayLink).toContainText("1");
  await todayLink.click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  const myDay = page.getByRole("list", { name: "My Day tasks" });
  await expect(myDay.getByRole("link", { name: "Chosen for the day" })).toBeVisible();
  await page.screenshot({ path: "test-results/today-my-day.png", fullPage: true });

  await page.getByRole("button", { name: "Complete Chosen for the day" }).click();
  await expect(
    page.getByRole("heading", { name: "Nothing needs you today" }),
  ).toBeVisible();
  await expect(todayLink).toContainText("0");

  // Completion follows the global rules: the task is in Completed, not in Today.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Nothing needs you today" }),
  ).toBeVisible();
});

test("a task due tomorrow appears in Upcoming and can be rescheduled there", async ({
  page,
}) => {
  await signUp(page);
  await capture(page, "Due tomorrow");
  const today = await workspaceToday(page);
  const tomorrow = addDays(today, 1);

  await page.getByRole("button", { name: "Edit Due tomorrow" }).click();
  await row(page, "Due tomorrow").getByLabel("Planned", { exact: true }).fill(tomorrow);

  const upcomingLink = page.getByRole("link", { name: "Upcoming", exact: true });
  await expect(upcomingLink).toContainText("1");
  await upcomingLink.click();
  await expect(page.getByRole("heading", { level: 1, name: "Upcoming" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /Tomorrow/ })).toBeVisible();
  const tomorrowGroup = page.getByRole("list", { name: `Tasks due ${tomorrow}` });
  await expect(tomorrowGroup.getByRole("link", { name: "Due tomorrow" })).toBeVisible();
  await page.screenshot({ path: "test-results/upcoming.png", fullPage: true });

  // Reschedule inline: three weeks out leaves the default horizon but not the open one.
  const later = addDays(today, 21);
  await page.getByRole("button", { name: "Edit Due tomorrow" }).click();
  await row(page, "Due tomorrow").getByLabel("Planned", { exact: true }).fill(later);
  await expect(page.getByRole("heading", { name: "Nothing scheduled" })).toBeVisible();

  await page.getByLabel("Horizon").selectOption("all");
  await expect(page).toHaveURL(/horizon=all/);
  await expect(
    page.getByRole("list", { name: `Tasks due ${later}` }).getByRole("link", {
      name: "Due tomorrow",
    }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Horizon")).toHaveValue("all");
  await expect(
    page.getByRole("list", { name: `Tasks due ${later}` }).getByRole("link", {
      name: "Due tomorrow",
    }),
  ).toBeVisible();
});

test("yesterday's unfinished selection waits in the review, and an overdue My Day task shows once", async ({
  page,
}) => {
  await signUp(page);
  await capture(page, "Left over");
  await capture(page, "Overdue and chosen");
  const today = await workspaceToday(page);
  const yesterday = addDays(today, -1);

  // Yesterday happened through the API: a manual selection for the previous day, and a
  // task that is now overdue and chosen for today.
  await page.evaluate(async (yesterday) => {
    const headers = { "content-type": "application/json" };
    const list = await (
      await fetch("/api/v1/tasks?inbox=true", { credentials: "include" })
    ).json();
    const byTitle = (title: string) =>
      list.data.find((task: { title: string }) => task.title === title);
    const leftOver = byTitle("Left over");
    const overdue = byTitle("Overdue and chosen");
    await fetch(`/api/v1/tasks/${leftOver.id}/today`, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ date: yesterday }),
    });
    await fetch(`/api/v1/tasks/${overdue.id}`, {
      method: "PATCH",
      credentials: "include",
      headers,
      body: JSON.stringify({ dueDate: yesterday }),
    });
    await fetch(`/api/v1/tasks/${overdue.id}/today`, {
      method: "POST",
      credentials: "include",
      headers,
    });
  }, yesterday);

  await page.goto("/today");
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();

  // Once, under Overdue, with both badges (completion criterion).
  const overdueList = page.getByRole("list", { name: "Overdue tasks" });
  const overdueRow = overdueList
    .getByRole("listitem")
    .filter({ hasText: "Overdue and chosen" });
  await expect(overdueRow).toHaveCount(1);
  await expect(overdueRow.getByText(/^Overdue:/)).toBeVisible();
  await expect(overdueRow.getByText("My Day", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "My Day tasks" })).toHaveCount(0);

  // Nothing rolls forward: yesterday's selection is only in the review.
  const review = page.getByRole("list", { name: "Unfinished from yesterday" });
  await expect(review.getByRole("link", { name: "Left over" })).toBeVisible();
  await expect(overdueList.getByRole("link", { name: "Left over" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/today-review.png", fullPage: true });

  // Dismissing is remembered by this browser for the day, and can be undone by clearing it.
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(review).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(review).toHaveCount(0);
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(review.getByRole("link", { name: "Left over" })).toBeVisible();

  // Open yesterday shows that day's plan, with no review of its own.
  await page.getByRole("link", { name: "Open yesterday" }).click();
  await expect(page).toHaveURL(new RegExp(`date=${yesterday}`));
  await expect(page.getByRole("heading", { level: 1, name: "Plan" })).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "My Day tasks" })
      .getByRole("link", { name: "Left over" }),
  ).toBeVisible();
  await expect(review).toHaveCount(0);
  await page.getByRole("link", { name: "Back to today" }).click();

  // Acting on the review moves the task into today.
  await page.getByRole("button", { name: "Add Left over to today" }).click();
  await expect(review).toHaveCount(0);
  await expect(
    page
      .getByRole("list", { name: "My Day tasks" })
      .getByRole("link", { name: "Left over" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("list", { name: "My Day tasks" })
      .getByRole("link", { name: "Left over" }),
  ).toBeVisible();
  await expect(page.getByText("Left over from yesterday")).toHaveCount(0);
});

test("My Day can be toggled from a board card and the task detail", async ({
  page,
}) => {
  await signUp(page);
  await openSection(page, "Settings");
  await page.getByRole("link", { name: "Manage projects" }).click();
  await page.getByLabel("Project name").fill("Daily Loop");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Daily Loop" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "+ Add to Ready" }).click();
  const field = page.getByPlaceholder("Add to Ready and press Enter");
  await field.fill("Card for the day");
  await field.press("Enter");
  const ready = page.getByRole("region", { name: "Ready" });
  await expect(ready.getByRole("link", { name: "Card for the day" })).toBeVisible();

  await ready.getByRole("button", { name: "Add Card for the day to My Day" }).click();
  await expect(ready.getByText("My Day", { exact: true })).toBeVisible();

  await ready.getByRole("link", { name: "Card for the day" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await expect(panel.getByRole("button", { name: "Remove from My Day" })).toBeVisible();
  await panel.getByRole("button", { name: "Remove from My Day" }).click();
  await expect(panel.getByRole("button", { name: "Add to My Day" })).toBeVisible();
  await expect(ready.getByText("My Day", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Today", exact: true })).toContainText(
    "0",
  );
});

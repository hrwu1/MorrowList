import { expect, test, type Page } from "@playwright/test";

import { openSection } from "./disclosures";

/**
 * Start/defer dates and deadlines (GAP-16): a deferred task leaves Today, Upcoming, the
 * Inbox and the board until its date and comes back on its own; a deadline is its own
 * marker, loud only when it is close.
 */

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page) {
  const email = `dates-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Dates Tester");
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

async function editRow(page: Page, title: string, label: string, value: string) {
  const edit = page.getByRole("button", { name: `Edit ${title}` });
  if ((await edit.getAttribute("aria-expanded")) !== "true") await edit.click();
  await row(page, title).getByLabel(label, { exact: true }).fill(value);
}

test("a deferred task leaves Today, Upcoming, and the Inbox, and returns on its date", async ({
  page,
}) => {
  await signUp(page);
  await capture(page, "Due today");
  await capture(page, "Due tomorrow");
  const today = await workspaceToday(page);
  const nextWeek = addDays(today, 7);

  await editRow(page, "Due today", "Planned", today);
  await editRow(page, "Due tomorrow", "Planned", addDays(today, 1));
  const todayLink = page.getByRole("link", { name: "Today", exact: true });
  const upcomingLink = page.getByRole("link", { name: "Upcoming", exact: true });
  await expect(todayLink).toContainText("1");
  await expect(upcomingLink).toContainText("1");

  // Defer both to next week: they leave the main Inbox list and wait, collapsed.
  // One at a time: the refetch that follows the first defer re-renders the list, and a
  // value typed into the second row's date input while that lands is thrown away.
  const inboxList = page.getByRole("list", { name: "Inbox tasks" });
  await editRow(page, "Due today", "Defer until", nextWeek);
  await expect(inboxList.getByRole("link", { name: "Due today" })).toBeHidden();
  await editRow(page, "Due tomorrow", "Defer until", nextWeek);
  await expect(inboxList).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Your Inbox is clear" }),
  ).toBeVisible();
  await expect(todayLink).toContainText("0");
  await expect(upcomingLink).toContainText("0");

  const deferredSection = page.locator("details.task-list__deferred");
  await expect(deferredSection).toContainText("Deferred");
  await expect(page.getByRole("list", { name: "Deferred tasks" })).toBeHidden();
  await deferredSection.locator("summary").click();
  const deferredList = page.getByRole("list", { name: "Deferred tasks" });
  await expect(deferredList.getByRole("link", { name: "Due today" })).toBeVisible();
  await expect(deferredList.getByText(`Deferred until ${nextWeek}`)).toHaveCount(2);
  await page.screenshot({
    path: "test-results/dates-inbox-deferred.png",
    fullPage: true,
  });

  await page.goto("/today");
  await expect(
    page.getByRole("heading", { name: "Nothing needs you today" }),
  ).toBeVisible();
  await page.goto("/upcoming");
  await expect(page.getByRole("heading", { name: "Nothing scheduled" })).toBeVisible();

  // Setting the defer date to today brings the task straight back: no job, just a date.
  await page.goto("/inbox");
  await page.locator("details.task-list__deferred summary").click();
  await editRow(page, "Due tomorrow", "Defer until", today);
  await expect(inboxList.getByRole("link", { name: "Due tomorrow" })).toBeVisible();
  await expect(upcomingLink).toContainText("1");
  await expect(page.getByRole("list", { name: "Deferred tasks" })).toHaveCount(1);
  await expect(
    page.getByRole("list", { name: "Deferred tasks" }).getByRole("listitem"),
  ).toHaveCount(1);
});

test("a deadline is its own marker, loud only when close, and warns about odd orders", async ({
  page,
}) => {
  await signUp(page);
  await capture(page, "Ship the release");
  await capture(page, "Renew the domain");
  const today = await workspaceToday(page);

  await editRow(page, "Ship the release", "Deadline", addDays(today, 1));
  await editRow(page, "Renew the domain", "Deadline", addDays(today, 10));

  const soon = row(page, "Ship the release").locator(".task-row__deadline");
  await expect(soon).toHaveText(`Deadline ${addDays(today, 1)}`);
  await expect(soon).toHaveAttribute("data-tone", "soon");
  const later = row(page, "Renew the domain").locator(".task-row__deadline");
  await expect(later).toHaveAttribute("data-tone", "later");
  await page.screenshot({
    path: "test-results/dates-deadline-marker.png",
    fullPage: true,
  });

  // The detail edits the deadline time and shows the soft order warning.
  await page.getByRole("link", { name: "Ship the release" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await openSection(panel, "Scheduling & priority");
  await panel.getByLabel("Deadline time").fill("17:00");
  await expect(soon).toHaveText(`Deadline ${addDays(today, 1)} at 17:00`);
  await openSection(panel, "Scheduling & priority");
  await panel.getByLabel("Planned", { exact: true }).fill(addDays(today, 3));
  await expect(panel.getByText("These dates are in an unusual order")).toBeVisible();
  await expect(panel.getByText("The planned day is after the deadline.")).toBeVisible();
  await page.screenshot({
    path: "test-results/dates-detail-warning.png",
    fullPage: true,
  });

  await openSection(panel, "Scheduling & priority");
  await panel.getByLabel("Deadline", { exact: true }).fill("");
  await expect(soon).toHaveCount(0);
  await expect(panel.getByText("These dates are in an unusual order")).toHaveCount(0);
});

test("the board hides a deferred card until asked to show it", async ({ page }) => {
  await signUp(page);
  await openSection(page, "Settings");
  await page.getByRole("link", { name: "Manage projects" }).click();
  await page.getByLabel("Project name").fill("Deferral");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Deferral" })).toBeVisible();
  await page.getByRole("button", { name: "+ Add to Ready" }).click();
  const field = page.getByPlaceholder("Add to Ready and press Enter");
  await field.fill("Later card");
  await field.press("Enter");
  const ready = page.getByRole("region", { name: "Ready" });
  await expect(ready.getByRole("link", { name: "Later card" })).toBeVisible();
  const today = await workspaceToday(page);

  await ready.getByRole("link", { name: "Later card" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await openSection(panel, "Scheduling & priority");
  await panel.getByLabel("Defer until").fill(addDays(today, 7));
  await expect(ready.getByRole("link", { name: "Later card" })).toHaveCount(0);

  const controls = page.getByRole("region", { name: "Board controls" });
  await controls.locator("summary").click();
  await controls.getByLabel("Deferred shown").selectOption("show");
  await expect(page).toHaveURL(/deferred=show/);
  await expect(ready.getByRole("link", { name: "Later card" })).toBeVisible();
  await expect(ready.getByText(`Deferred until ${addDays(today, 7)}`)).toBeVisible();
  await page.screenshot({
    path: "test-results/dates-board-deferred.png",
    fullPage: true,
  });

  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Ready" })
      .getByRole("link", { name: "Later card" }),
  ).toBeVisible();
});

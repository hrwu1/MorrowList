import { openSection } from "./disclosures";
import { expect, test, type Page } from "./fixtures";

/**
 * Recurring tasks (GAP-12): give a task a weekly rule, complete it, find the next
 * occurrence a week later in Upcoming, skip one, and change the rule on the new
 * occurrence without touching the completed one.
 */

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page) {
  const email = `recur-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Recurrence Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
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

function panel(page: Page) {
  return page.getByRole("complementary", { name: /Task details for/ });
}

test("a weekly task spawns its next occurrence on completion, can be skipped, and takes a new rule for the future only", async ({
  page,
}) => {
  await signUp(page);
  const today = await workspaceToday(page);

  const field = page.getByPlaceholder("Add a task and press Enter");
  await field.fill("Water plants");
  await field.press("Enter");
  await page.getByRole("link", { name: "Water plants" }).click();

  // A due date and a weekly preset anchored at it.
  const detail = panel(page);
  await openSection(detail, "Scheduling & priority");
  await detail.getByLabel("Planned", { exact: true }).fill(today);
  await openSection(detail, "Scheduling & priority");
  await detail.getByLabel("Repeat", { exact: true }).selectOption("weekly");
  await expect(detail.getByText(/^Every week on \w{3}\. Completing/)).toBeVisible();
  await expect(
    row(page, "Water plants").getByLabel(/^Repeats: Every week on/),
  ).toBeVisible();
  await expect(detail.getByText("Saved", { exact: true })).toBeVisible();

  // The custom form starts from the chosen rule and saves each change as a whole rule.
  await openSection(detail, "Scheduling & priority");
  await detail.getByLabel("Repeat", { exact: true }).selectOption("custom");
  await detail.getByLabel("Every").fill("2");
  await expect(detail.getByText(/^Every 2 weeks on \w{3}\. Completing/)).toBeVisible();
  await detail.getByLabel("Ends").selectOption("count");
  await expect(
    detail.getByText(/^Every 2 weeks on \w{3}, 5 occurrences left\. Completing/),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/recurrence-editor.png", fullPage: true });
  await openSection(detail, "Scheduling & priority");
  await detail.getByLabel("Repeat", { exact: true }).selectOption("weekly");
  await expect(detail.getByText(/^Every week on \w{3}\. Completing/)).toBeVisible();
  await expect(detail.getByText("Saved", { exact: true })).toBeVisible();

  // Completing creates the next occurrence a week later; the Inbox shows only that one.
  await detail.getByRole("button", { name: "Mark complete" }).click();
  await expect(detail.getByRole("button", { name: "Reopen task" })).toBeVisible();
  const nextWeek = addDays(today, 7);
  await expect(row(page, "Water plants")).toHaveCount(1);
  await expect(row(page, "Water plants").getByText(`Due ${nextWeek}`)).toBeVisible();
  await expect(detail.getByRole("list", { name: "Other occurrences" })).toContainText(
    "RecurrenceTester-000002",
  );

  const upcomingLink = page.getByRole("link", { name: "Upcoming", exact: true });
  await expect(upcomingLink).toContainText("1");
  await upcomingLink.click();
  await expect(page.getByRole("heading", { level: 1, name: "Upcoming" })).toBeVisible();
  // The later occurrences fall outside the default two-week horizon.
  await page.getByLabel("Horizon").selectOption("all");
  await expect(page).toHaveURL(/horizon=all/);
  const group = page.getByRole("list", { name: `Tasks due ${nextWeek}` });
  await expect(group.getByRole("link", { name: "Water plants" })).toBeVisible();
  await page.screenshot({
    path: "test-results/recurrence-upcoming.png",
    fullPage: true,
  });

  // Skip moves the same task on another week; nothing new appears.
  await group.getByRole("link", { name: "Water plants" }).click();
  const next = panel(page);
  await expect(
    next.getByText("RecurrenceTester-000002", { exact: true }),
  ).toBeVisible();
  await next.getByText("More actions").click();
  await next.getByRole("button", { name: "Skip this occurrence" }).click();
  const twoWeeks = addDays(today, 14);
  await expect(
    page.getByRole("list", { name: `Tasks due ${twoWeeks}` }).getByRole("link", {
      name: "Water plants",
    }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: `Tasks due ${nextWeek}` })).toHaveCount(
    0,
  );
  await expect(upcomingLink).toContainText("1");

  // A new rule on this occurrence shapes the next one; the completed RecurrenceTester-000001 is untouched.
  await openSection(next, "Scheduling & priority");
  await next.getByLabel("Repeat", { exact: true }).selectOption("daily");
  await expect(next.getByText(/^Every day\. Completing/)).toBeVisible();
  await expect(next.getByText("Saved", { exact: true })).toBeVisible();
  await next.getByRole("button", { name: "Mark complete" }).click();
  await expect(next.getByRole("button", { name: "Reopen task" })).toBeVisible();
  const dayAfter = addDays(twoWeeks, 1);
  await expect(
    page.getByRole("list", { name: `Tasks due ${dayAfter}` }).getByRole("link", {
      name: "Water plants",
    }),
  ).toBeVisible();
  const occurrences = next.getByRole("list", { name: "Other occurrences" });
  await expect(occurrences.getByRole("listitem")).toHaveCount(2);
  await expect(occurrences).toContainText("RecurrenceTester-000001");
  await expect(occurrences).toContainText("RecurrenceTester-000003");
  await page.screenshot({ path: "test-results/recurrence-series.png", fullPage: true });

  // RecurrenceTester-000001 was completed under the weekly rule and keeps its own history.
  await page.goto("/tasks/RecurrenceTester-000001");
  await expect(page.getByRole("button", { name: "Reopen task" })).toBeVisible();
  await expect(page.getByLabel("Repeat", { exact: true })).toHaveValue("none");
  await expect(
    page.getByText("Completed task; next occurrence is #000002"),
  ).toBeVisible();
});

import { expect, test, type Page } from "@playwright/test";

import { openSection } from "./disclosures";

/**
 * Flow metrics (GAP-17): moving work across the board records the intervals the Flow
 * view and the card age badge are computed from. The badge follows the browser clock,
 * so two weeks pass with a fake clock rather than a fortnight of waiting.
 */

const PASSWORD = "correct-horse-battery-staple";
const DAY_MS = 86_400_000;

async function signUp(page: Page) {
  const email = `flow-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Flow Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
}

async function createProject(page: Page, name: string) {
  await openSection(page, "Settings");
  await page.getByRole("link", { name: "Manage projects" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

/** The quick-add stays open after a capture, so only the first task opens it. */
async function addReadyTask(page: Page, title: string) {
  const capture = page.getByPlaceholder("Add to Ready and press Enter");
  if (!(await capture.isVisible())) {
    await page.getByRole("button", { name: "+ Add to Ready" }).click();
  }
  await capture.fill(title);
  await capture.press("Enter");
  await expect(
    page.getByRole("region", { name: "Ready" }).getByRole("link", { name: title }),
  ).toBeVisible();
}

async function moveTo(page: Page, title: string, status: string) {
  await page.getByLabel(`Move ${title}`).selectOption({ label: status });
  await expect(
    page.getByRole("region", { name: status }).getByRole("link", { name: title }),
  ).toBeVisible();
}

test("the Flow view and the card age badge follow the board's moves", async ({
  page,
}) => {
  await signUp(page);
  await createProject(page, "Research Launch");

  await addReadyTask(page, "Draft brief");
  await addReadyTask(page, "Write outline");
  await addReadyTask(page, "Plan launch");
  await moveTo(page, "Draft brief", "In Progress");
  await moveTo(page, "Write outline", "In Progress");
  await moveTo(page, "Write outline", "Done");

  // One completion is enough for the column to learn how long work usually takes.
  const inProgress = page.getByRole("region", { name: "In Progress" });
  await expect(inProgress.getByText("Usually done in 1 day")).toBeVisible();
  // Nothing has been in a column for a day yet, so no card carries an age.
  await expect(page.locator(".board-card__age")).toHaveCount(0);

  await page.getByRole("link", { name: "Flow", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Flow" })).toBeVisible();
  const summary = page.getByRole("region", { name: "Flow summary" });
  await expect(summary).toContainText("Work in progress1");
  await expect(summary).toContainText("Completed1");
  await expect(summary).toContainText("1 started task");
  await expect(
    page.getByRole("img", { name: /^Throughput by week: .*: 1/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /^Cumulative flow ending/ }),
  ).toBeVisible();
  const aging = page.getByRole("list", { name: "Aging tasks, oldest first" });
  await expect(aging).toContainText("Draft brief");
  await expect(aging).not.toContainText("Plan launch");
  await page.screenshot({ path: "test-results/flow-light.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "test-results/flow-dark.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByLabel("Range").selectOption("30");
  await expect(page).toHaveURL(/range=30/);
  await expect(summary).toContainText("last 30 days");

  // Two weeks later the card in progress is stale and says so; the toggle hides it.
  await page.getByRole("link", { name: "Research Launch board" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Research Launch" }),
  ).toBeVisible();
  await page.clock.setFixedTime(Date.now() + 14 * DAY_MS);
  await page.reload();
  const card = page
    .getByRole("region", { name: "In Progress" })
    .getByRole("listitem")
    .filter({ hasText: "Draft brief" });
  await expect(card).toHaveAttribute("data-age", "stale");
  await expect(card.getByLabel("In this column for 14 days")).toHaveText("14d");
  await expect(
    page
      .getByRole("region", { name: "Done" })
      .getByRole("listitem")
      .filter({ hasText: "Write outline" }),
  ).not.toHaveAttribute("data-age", /./);
  await page.screenshot({ path: "test-results/flow-board-stale.png", fullPage: true });

  const controls = page.getByRole("region", { name: "Board controls" });
  await controls.locator("summary").click();
  await controls.getByLabel("Card age shown").selectOption("hide");
  await expect(page).toHaveURL(/age=off/);
  await expect(page.locator(".board-card__age")).toHaveCount(0);
  await expect(card).not.toHaveAttribute("data-age", /./);
});

import { expect, test, type Page } from "@playwright/test";

import { openProjectBoard, openSection } from "./disclosures";

/**
 * Activity history (GAP-09, ACT-001): a move and a title edit show up in the task's
 * history with the right summaries, the project sees the same events, and a long
 * history pages with "Load more".
 */

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page) {
  const email = `activity-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Activity Tester");
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

test("a move and a title edit appear in the task's and the project's activity", async ({
  page,
}) => {
  await signUp(page);
  await createProject(page, "Research Launch");
  await openProjectBoard(page);

  await page.getByRole("button", { name: "+ Add a task" }).click();
  const capture = page.getByPlaceholder("Add to Ready and press Enter");
  await capture.fill("Draft research brief");
  await capture.press("Enter");
  const ready = page.getByRole("region", { name: "Ready" });
  await expect(ready.getByRole("link", { name: "Draft research brief" })).toBeVisible();

  await page
    .getByLabel("Move Draft research brief")
    .selectOption({ label: "In Progress" });
  const inProgress = page.getByRole("region", { name: "In Progress" });
  await expect(
    inProgress.getByRole("link", { name: "Draft research brief" }),
  ).toBeVisible();

  await inProgress.getByRole("link", { name: "Draft research brief" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await panel.getByLabel("Title").fill("Draft the research brief");
  await panel.getByLabel("Title").blur();
  await expect(panel.getByText("Saved")).toBeVisible();

  await panel.locator("summary").filter({ hasText: "Activity" }).click();
  const activity = panel.getByRole("list", { name: /^Activity for [A-Z]+-1$/ });
  const items = activity.locator(":scope > li");
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText("Updated task fields");
  await expect(items.nth(0)).toContainText(
    "Title: Draft research brief → Draft the research brief",
  );
  await expect(items.nth(0)).toContainText("Activity Tester");
  await expect(items.nth(0)).toContainText("just now");
  await expect(items.nth(1)).toContainText("Moved task to another status");
  await expect(items.nth(2)).toContainText(/Created task [A-Z]+-1/);
  // Only mapped fields render; a raw payload would show its keys.
  await expect(activity).not.toContainText("taskId");
  await expect(panel.getByRole("button", { name: "Load more" })).toHaveCount(0);
  await panel.screenshot({ path: "test-results/activity-panel.png" });

  // The next edit refreshes the open list without a reload.
  await openSection(panel, "Scheduling & priority");
  await panel.getByLabel("Priority").selectOption("high");
  await expect(items).toHaveCount(4);
  await expect(items.nth(0)).toContainText("Priority: none → high");

  await page.locator("summary").filter({ hasText: "Project activity" }).click();
  const projectActivity = page.getByRole("list", {
    name: "Activity for Research Launch",
  });
  const projectItems = projectActivity.locator(":scope > li");
  await expect(projectItems).toHaveCount(5);
  await expect(projectItems.nth(0)).toContainText("Updated task fields");
  await expect(projectItems.nth(4)).toContainText("Created project Research Launch");
  await page.screenshot({
    path: "test-results/activity-board.png",
    fullPage: true,
  });
});

test("the task page opens its history and pages a long one with Load more", async ({
  page,
}) => {
  await signUp(page);
  const field = page.getByPlaceholder("Add a task and press Enter");
  await field.fill("Edited many times");
  await field.press("Enter");
  await expect(page.getByRole("link", { name: "Edited many times" })).toBeVisible();

  // Twenty-five edits through the same API the UI uses: with the creation that is 26
  // events, one more than a single page.
  await page.evaluate(async () => {
    const list = await (
      await fetch("/api/v1/tasks?inbox=true", { credentials: "include" })
    ).json();
    const task = list.data[0];
    let version = task.version;
    for (let edit = 1; edit <= 25; edit += 1) {
      const response = await fetch(`/api/v1/tasks/${task.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `Edited many times (${edit})`,
          expectedVersion: version,
        }),
      });
      version = (await response.json()).data.version;
    }
  });

  await page.getByRole("link", { name: /Edited many times/ }).click();
  await page.getByRole("link", { name: "Open this task on its own page" }).click();
  await expect(page).toHaveURL(/\/tasks\/[A-Z]+-1$/);

  const activity = page.getByRole("list", { name: /^Activity for [A-Z]+-1$/ });
  const items = activity.locator(":scope > li");
  await expect(items).toHaveCount(20);
  await expect(items.nth(0)).toContainText(
    "Title: Edited many times (24) → Edited many times (25)",
  );

  await page.getByRole("button", { name: "Load more" }).click();
  await expect(items).toHaveCount(26);
  await expect(items.nth(25)).toContainText(/Created task [A-Z]+-1/);
  await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/activity-page.png", fullPage: true });
});

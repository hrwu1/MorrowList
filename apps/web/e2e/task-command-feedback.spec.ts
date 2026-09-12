import type { ProjectDetailDto, TaskDto } from "@morrowlist/contracts";

import { openProjectBoard } from "./disclosures";
import { expect, test, type Page } from "./fixtures";

// These journeys exercise command metadata, not service-worker caching.
test.use({ serviceWorkers: "block" });

async function seed(page: Page, completed = true) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Command Feedback Tester");
  await page
    .getByLabel("Email")
    .fill(`feedback-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
  const me = await page.request.get("/api/v1/me");
  const { data: workspace } = await me.json();
  expect(
    (
      await page.request.patch(`/api/v1/workspaces/${workspace.defaultWorkspaceId}`, {
        data: { inProgressLimit: 1 },
      })
    ).ok(),
  ).toBeTruthy();
  const created = await page.request.post("/api/v1/projects", {
    data: { name: "Feedback project" },
  });
  expect(created.status()).toBe(201);
  const { data: project }: { data: ProjectDetailDto } = await created.json();
  const doing = project.statuses.find((status) => status.category === "in_progress")!;
  const ready = project.statuses.find((status) => status.category === "ready")!;
  async function create(title: string, statusId: string): Promise<TaskDto> {
    const response = await page.request.post("/api/v1/tasks", {
      data: { title, projectId: project.project.id, statusId },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).data;
  }
  const paused = await create("Paused work", doing.id);
  if (completed)
    expect(
      (
        await page.request.post(`/api/v1/tasks/${paused.id}/complete`, {
          data: { expectedVersion: paused.version },
        })
      ).ok(),
    ).toBeTruthy();
  await create("Active work", doing.id);
  return { project, paused, doing, ready, create };
}

for (const entry of ["row", "shortcut", "mobile panel"] as const) {
  test(`shows the same WIP warning when reopening through ${entry}`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const { paused } = await seed(page);
    await page.goto("/completed");
    if (entry === "row") {
      await page
        .getByRole("button", { name: "Reopen Paused work", exact: true })
        .click();
    } else if (entry === "shortcut") {
      await page.getByRole("link", { name: "Paused work", exact: true }).focus();
      await page.keyboard.press("e");
    } else {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("link", { name: "Paused work", exact: true }).click();
      const panel = page.getByRole("complementary", { name: /Task details for/ });
      await panel.getByRole("button", { name: "Reopen task", exact: true }).click();
      await expect(panel.locator(".ml-alert--warning")).toBeVisible();
    }
    const warning = page.locator(".ml-alert--warning");
    await expect(warning).toHaveCount(1);
    await expect(warning).toContainText(
      "2 tasks are in progress across your projects; the limit is 1.",
    );
    await expect(
      warning.getByRole("button", { name: "Move Paused work to Ready", exact: true }),
    ).toBeVisible();
    const current = await page.request.get(`/api/v1/tasks/${paused.id}`);
    expect((await current.json()).data.isCompleted).toBe(false);
  });
}

test("bulk moves show the shared warning and its corrective action", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { project, ready, create } = await seed(page);
  await create("First ready", ready.id);
  await create("Second ready", ready.id);
  await page.goto(`/projects/${project.project.id}/board`);
  await openProjectBoard(page);
  await page.getByRole("checkbox", { name: "Select First ready", exact: true }).check();
  await page
    .getByRole("checkbox", { name: "Select Second ready", exact: true })
    .check();
  const toolbar = page.getByRole("region", { name: /Bulk actions/ });
  await toolbar.getByRole("combobox").first().selectOption({ label: "In Progress" });
  const warning = page.locator(".ml-alert--warning");
  await expect(warning).toContainText(
    "3 tasks are in progress across your projects; the limit is 1.",
  );
  await warning
    .getByRole("button", { name: "Move First ready to Ready", exact: true })
    .click();
  await expect(
    warning.getByRole("list", { name: "Tasks in progress" }),
  ).not.toContainText("First ready");
});

test("undoing completion preserves the reopening warning", async ({ page }) => {
  test.setTimeout(60_000);
  const { paused } = await seed(page, false);
  await page.goto(`/tasks/${paused.key}`);
  await page.getByRole("button", { name: "Mark complete", exact: true }).click();
  await page.getByTestId("undo-toast").getByRole("button", { name: /^Undo/ }).click();
  await expect(page.locator(".task-detail .ml-alert--warning")).toContainText(
    "2 tasks are in progress across your projects; the limit is 1.",
  );
  await expect(
    page.getByRole("button", { name: "Mark complete", exact: true }),
  ).toBeVisible();
});

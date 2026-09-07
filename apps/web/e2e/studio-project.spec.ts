import type { WorkflowStatusDto } from "@morrowlist/contracts";
import { expect, test, type Page } from "@playwright/test";

import { openProjectBoard } from "./disclosures";

async function createStudio(page: Page) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Studio Tester");
  await page
    .getByLabel("Email")
    .fill(`studio-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Inbox", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  const form = page.getByRole("form", { name: "Quick add project" });
  await form.getByLabel("Project name").fill("A more thoughtful launch");
  await form.getByLabel("Project name").press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "A more thoughtful launch" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Project views", exact: true })
      .getByRole("link", { name: "Overview" }),
  ).toHaveAttribute("aria-current", "page");
  return new URL(page.url()).pathname.split("/")[2]!;
}

async function addTask(page: Page, title: string) {
  const input = page.getByPlaceholder("Add to Ready and press Enter");
  if (!(await input.isVisible()))
    await page.getByRole("button", { name: "+ Add a task" }).click();
  await input.fill(title);
  await input.press("Enter");
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
}

test("project studio keeps movement, detail focus, completion and Undo on the real task", async ({
  page,
}) => {
  await createStudio(page);
  await addTask(page, "Shape the launch story");
  await addTask(page, "Wait for the research notes");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  const stage = page.getByLabel("Move Shape the launch story", { exact: true });
  await stage.focus();
  await stage.selectOption({ label: "In Progress" });
  const motion = page.locator("#studio-motion");
  const next = page.locator("#studio-next");
  await expect(
    motion.getByRole("link", { name: "Shape the launch story" }),
  ).toBeVisible();
  await expect(next.getByRole("link", { name: "Shape the launch story" })).toHaveCount(
    0,
  );
  await expect(
    motion.getByLabel("Move Shape the launch story", { exact: true }),
  ).toBeFocused();

  await motion.getByRole("link", { name: "Shape the launch story" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await expect(panel.getByLabel("Title", { exact: true })).toHaveValue(
    "Shape the launch story",
  );
  await expect(page).toHaveURL(/task=/);
  await panel
    .getByLabel("Title", { exact: true })
    .fill("Shape a thoughtful launch story");
  await panel.getByLabel("Title", { exact: true }).blur();
  await expect(panel.getByText("Saved", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(
    motion.getByRole("link", { name: "Shape a thoughtful launch story" }),
  ).toBeFocused();

  await motion
    .getByRole("button", { name: "Complete Shape a thoughtful launch story" })
    .click();
  await expect(
    page
      .locator("#studio-completed")
      .getByRole("link", { name: "Shape a thoughtful launch story" }),
  ).toBeVisible();
  await expect(
    motion.getByRole("link", { name: "Shape a thoughtful launch story" }),
  ).toHaveCount(0);
  await page.getByTestId("undo-toast").getByRole("button", { name: /^Undo/ }).click();
  await expect(
    motion.getByRole("button", { name: "Complete Shape a thoughtful launch story" }),
  ).toBeVisible();

  await page
    .getByLabel("Move Wait for the research notes", { exact: true })
    .selectOption({ label: "Blocked" });
  await expect(
    page
      .locator("#studio-blocked")
      .getByRole("link", { name: "Wait for the research notes" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    motion.getByRole("link", { name: "Shape a thoughtful launch story" }),
  ).toBeVisible();
  await expect(motion.getByLabel("Move Shape a thoughtful launch story")).toHaveValue(
    /./,
  );
  await expect(
    page
      .locator("#studio-blocked")
      .getByRole("link", { name: "Wait for the research notes" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Project at a glance" })
      .getByRole("link", { name: /1 In motion/ }),
  ).toBeVisible();
});

test("Overview and Board preserve every workflow stage and fit a narrow phone", async ({
  page,
}) => {
  const projectId = await createStudio(page);
  const response = await page.request.get(`/api/v1/projects/${projectId}/board`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { data: { statuses: WorkflowStatusDto[] } };
  for (const status of body.data.statuses) {
    const created = await page.request.post("/api/v1/tasks", {
      data: {
        projectId,
        ...(status.isTerminal ? {} : { statusId: status.id }),
        title: `A thoughtful next step for ${status.name}`,
      },
    });
    expect(created.ok(), `create task in ${status.name}`).toBe(true);
    // The task contract creates open work; reaching Done uses the real move command.
    if (status.isTerminal) {
      const { data: task } = await created.json();
      const moved = await page.request.post(`/api/v1/tasks/${task.id}/move`, {
        data: { projectId, statusId: status.id, expectedVersion: task.version },
      });
      expect(moved.ok(), `move task into ${status.name}`).toBe(true);
    }
  }
  await page.reload();
  for (const status of body.data.statuses) {
    await expect(
      page.getByRole("link", {
        name: `A thoughtful next step for ${status.name}`,
        exact: true,
      }),
    ).toHaveCount(1);
  }
  await expect(page.locator("#studio-motion .task-row")).toHaveCount(2);
  await expect(page.locator("#studio-next .task-row")).toHaveCount(2);
  await expect(page.locator("#studio-blocked .task-row")).toHaveCount(1);
  await expect(page.locator("#studio-completed .task-row")).toHaveCount(1);

  await openProjectBoard(page);
  const controls = page.getByRole("region", { name: "Project views and controls" });
  await controls.locator("summary").click();
  await controls.getByLabel("Stages shown").selectOption("all");
  await controls.locator("summary").click();
  await page.reload();
  for (const status of body.data.statuses) {
    const column = page.getByRole("region", { name: status.name, exact: true });
    await expect(
      column.getByRole("link", {
        name: `A thoughtful next step for ${status.name}`,
        exact: true,
      }),
    ).toBeVisible();
  }
  await page
    .getByRole("navigation", { name: "Project views", exact: true })
    .getByRole("link", { name: "Overview" })
    .click();
  await expect(page).not.toHaveURL(/canvas=board/);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator("#studio-motion")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `${width}px studio width`,
    ).toBe(true);
  }
  const title = page
    .locator("#studio-motion")
    .getByRole("link", { name: "A thoughtful next step for In Progress", exact: true });
  await title.click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Close task details" }).click();
  await expect(title).toBeFocused();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});

test("a refused stage move restores focus and a settled move respects a later focus choice", async ({
  page,
}) => {
  await createStudio(page);
  await addTask(page, "Keep the keyboard thread");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  const stage = page.getByLabel("Move Keep the keyboard thread", { exact: true });
  await page.route(
    "**/api/v1/tasks/*/move**",
    async (route) => {
      await route.fulfill({
        status: 409,
        json: {
          error: {
            code: "TASK_VERSION_CONFLICT",
            message: "Task changed elsewhere.",
            requestId: "studio-focus-conflict",
          },
        },
      });
    },
    { times: 1 },
  );
  await stage.focus();
  await stage.selectOption({ label: "In Progress" });
  await expect(page.locator(".board-page").getByRole("alert")).toContainText(
    "This task moved somewhere else",
  );
  await expect(
    page
      .locator("#studio-next")
      .getByRole("link", { name: "Keep the keyboard thread" }),
  ).toBeVisible();
  await expect(stage).toBeFocused();

  let releaseMove: () => void = () => {};
  const heldMove = new Promise<void>((resolve) => {
    releaseMove = resolve;
  });
  await page.route(
    "**/api/v1/tasks/*/move**",
    async (route) => {
      await heldMove;
      await route.continue();
    },
    { times: 1 },
  );
  await stage.selectOption({ label: "In Progress" });
  await expect(
    page
      .locator("#studio-motion")
      .getByRole("link", { name: "Keep the keyboard thread" }),
  ).toBeVisible();
  const settings = page.getByRole("link", { name: "Project settings", exact: true });
  await settings.focus();
  releaseMove();
  await expect(stage).toBeEnabled();
  await expect(settings).toBeFocused();
});

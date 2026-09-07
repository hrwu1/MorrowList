import { expect, test, type Locator, type Page } from "@playwright/test";

import { openProjectBoard } from "./disclosures";

/**
 * Undo and bulk edit (GAP-08, spec 10.3, 10.4).
 *
 * The point of these journeys is that undo really reverses the change on the server
 * rather than repainting the screen: every assertion after an undo reloads or navigates,
 * so a purely optimistic revert would fail here.
 */

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page, prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Undo Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
}

async function capture(page: Page, title: string) {
  const form = page.getByRole("form", { name: "Quick add" }).first();
  await form.getByLabel("Task title").fill(title);
  await form.getByLabel("Task title").press("Enter");
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
}

/** dnd-kit activates after a few pointer moves, so a drag is a stepped mouse path. */
async function dragWithPointer(source: Locator, target: Locator, page: Page) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  if (!from || !to) return;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12);
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function createProject(page: Page, name: string) {
  await page.getByRole("button", { name: "Add project" }).click();
  const form = page.getByRole("form", { name: "Quick add project" });
  await form.getByLabel("Project name").fill(name);
  await form.getByLabel("Project name").press("Enter");
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

test("completes a task and takes it back with the undo toast", async ({ page }) => {
  await signUp(page, "undo");
  await page.getByRole("link", { name: "Open full Inbox" }).first().click();
  await capture(page, "Draft the brief");

  // The Inbox lists open work, so completing takes the row out of it.
  await page.getByRole("button", { name: "Complete Draft the brief" }).click();
  await expect(
    page.getByRole("link", { name: "Draft the brief", exact: true }),
  ).toHaveCount(0);

  const toast = page.getByTestId("undo-toast");
  await expect(toast).toContainText("Completed Draft the brief");
  await toast.getByRole("button", { name: /^Undo/ }).click();
  await expect(toast).toHaveCount(0);

  // Reload rather than trust the screen: the undo has to have reached the server.
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Complete Draft the brief" }),
  ).toBeVisible();
});

test("undoes a completion with Cmd/Ctrl+Z while the toast is open", async ({
  page,
}) => {
  await signUp(page, "undo-key");
  await page.getByRole("link", { name: "Open full Inbox" }).first().click();
  await capture(page, "Book the venue");

  await page.getByRole("button", { name: "Complete Book the venue" }).click();
  await expect(page.getByTestId("undo-toast")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("undo-toast")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Complete Book the venue" }),
  ).toBeVisible();
});

test("undoes a soft delete, putting the task back out of the Trash", async ({
  page,
}) => {
  await signUp(page, "undo-delete");
  await page.getByRole("link", { name: "Open full Inbox" }).first().click();
  await capture(page, "Cancel the caterer");

  await page.getByRole("button", { name: "Edit Cancel the caterer" }).click();
  await page.getByRole("button", { name: "Delete Cancel the caterer" }).click();
  await expect(
    page.getByRole("link", { name: "Cancel the caterer", exact: true }),
  ).toHaveCount(0);

  await page.getByTestId("undo-toast").getByRole("button", { name: /^Undo/ }).click();
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Cancel the caterer", exact: true }),
  ).toBeVisible();
});

test("undoes a dragged card back into the column it came from", async ({ page }) => {
  await signUp(page, "undo-drag");
  await createProject(page, "Research Launch");
  await openProjectBoard(page);

  await page.getByRole("button", { name: "+ Add a task" }).click();
  await capture(page, "Draft research brief");

  const ready = page.getByRole("region", { name: "Ready" });
  const inProgress = page.getByRole("region", { name: "In Progress" });
  await expect(ready.getByRole("link", { name: "Draft research brief" })).toBeVisible();

  await dragWithPointer(
    ready.getByRole("listitem").filter({ hasText: "Draft research brief" }),
    inProgress,
    page,
  );
  await expect(
    inProgress.getByRole("link", { name: "Draft research brief" }),
  ).toBeVisible();

  await page.getByTestId("undo-toast").getByRole("button", { name: /^Undo/ }).click();
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Ready" })
      .getByRole("link", { name: "Draft research brief" }),
  ).toBeVisible();
});

test("selects three rows with Shift, moves them, and undoes the whole batch", async ({
  page,
}) => {
  await signUp(page, "bulk");
  await createProject(page, "Research Launch");
  await openProjectBoard(page);

  await page.getByRole("button", { name: "+ Add a task" }).click();
  for (const title of ["First card", "Second card", "Third card", "Fourth card"]) {
    await capture(page, title);
  }

  const ready = page.getByRole("region", { name: "Ready" });
  const inProgress = page.getByRole("region", { name: "In Progress" });

  await ready.getByRole("checkbox", { name: "Select First card" }).click();
  // Shift-click the third card: the range takes the second one with it.
  await ready
    .getByRole("checkbox", { name: "Select Third card" })
    .click({ modifiers: ["Shift"] });

  const toolbar = page.getByRole("region", { name: /Bulk actions/ });
  await expect(toolbar).toContainText("3 tasks selected");

  await toolbar.getByRole("combobox").first().selectOption({ label: "In Progress" });

  for (const title of ["First card", "Second card", "Third card"]) {
    await expect(inProgress.getByRole("link", { name: title })).toBeVisible();
  }
  await expect(ready.getByRole("link", { name: "Fourth card" })).toBeVisible();

  await page.getByTestId("undo-toast").getByRole("button", { name: /^Undo/ }).click();
  await page.reload();

  const readyAfter = page.getByRole("region", { name: "Ready" });
  for (const title of ["First card", "Second card", "Third card", "Fourth card"]) {
    await expect(readyAfter.getByRole("link", { name: title })).toBeVisible();
  }
  await expect(
    page
      .getByRole("region", { name: "In Progress" })
      .getByRole("link", { name: "First card" }),
  ).toHaveCount(0);
});

test("bulk completes a list selection taken with Cmd/Ctrl+A", async ({ page }) => {
  await signUp(page, "bulk-list");
  await page.getByRole("link", { name: "Open full Inbox" }).first().click();
  for (const title of ["Alpha task", "Beta task"]) await capture(page, title);

  // Focus a row first: the shortcut is bound to the list, not to the window.
  await page.getByRole("checkbox", { name: "Select Alpha task" }).focus();
  await page.keyboard.press("ControlOrMeta+a");

  const toolbar = page.getByRole("region", { name: /Bulk actions/ });
  await expect(toolbar).toContainText("2 tasks selected");
  await toolbar.getByRole("button", { name: "Complete" }).click();

  // The Inbox lists open work, so both rows leave it.
  for (const title of ["Alpha task", "Beta task"]) {
    await expect(page.getByRole("link", { name: title, exact: true })).toHaveCount(0);
  }
  const toast = page.getByTestId("undo-toast");
  await expect(toast).toContainText("2 tasks completed");

  // One offer for the whole batch, and one inverse batch to take it back.
  await toast.getByRole("button", { name: /^Undo/ }).click();
  await page.reload();
  for (const title of ["Alpha task", "Beta task"]) {
    await expect(page.getByRole("button", { name: `Complete ${title}` })).toBeVisible();
  }
});

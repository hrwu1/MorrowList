import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page) {
  const email = `workflow-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Workflow Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
}

async function createProject(page: Page, name = "Research Launch") {
  await page.getByRole("link", { name: "Manage projects" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

async function addReadyTask(page: Page, title: string) {
  await page.getByRole("button", { name: "+ Add to Ready" }).click();
  const capture = page.getByPlaceholder("Add to Ready and press Enter");
  await capture.fill(title);
  await capture.press("Enter");
  await expect(
    page.getByRole("region", { name: "Ready" }).getByRole("link", { name: title }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
}

function columnOrder(page: Page) {
  return page
    .getByRole("list", { name: "Workflow columns" })
    .getByRole("listitem")
    .evaluateAll((items) => items.map((item) => item.getAttribute("aria-label")));
}

test("edits columns from the board header menu", async ({ page }) => {
  await signUp(page);
  await createProject(page);

  // Rename inline: the category, and so the meaning, stays the same.
  await page.getByLabel("Options for Backlog").click();
  await page
    .getByRole("region", { name: "Backlog" })
    .getByRole("button", { name: "Rename" })
    .click();
  const rename = page.getByRole("form", { name: "Rename Backlog" });
  await rename.getByLabel("Column name").fill("Ideas");
  await rename.getByLabel("Column name").press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Ideas" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Ideas" })).toHaveAttribute(
    "data-category",
    "backlog",
  );

  // A WIP limit warns once the column holds more than it should.
  await addReadyTask(page, "Draft research brief");
  await addReadyTask(page, "Interview two customers");
  await page.getByLabel("Options for Ready").click();
  const wip = page.getByRole("form", { name: "WIP limit for Ready" });
  await wip.getByLabel("WIP limit").fill("1");
  await wip.getByRole("button", { name: "Set limit" }).click();
  const ready = page.getByRole("region", { name: "Ready" });
  await expect(ready).toContainText("2 / 1 WIP · over limit");
  await expect(ready).toHaveAttribute("data-wip-over", "true");

  // Collapsing is a personal view setting that survives a reload.
  await page.getByLabel("Options for In Progress").click();
  const inProgress = page.getByRole("region", { name: "In Progress" });
  await inProgress.getByRole("button", { name: "Collapse" }).click();
  await expect(inProgress).toHaveAttribute("data-collapsed", "true");
  await expect(inProgress.getByRole("list")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "In Progress" })).toHaveAttribute(
    "data-collapsed",
    "true",
  );
  await page.screenshot({ path: "test-results/workflow-board-collapsed.png" });
  await page.getByRole("button", { name: "Expand In Progress" }).click();
  await expect(page.getByRole("region", { name: "In Progress" })).not.toHaveAttribute(
    "data-collapsed",
    "true",
  );
  await page.screenshot({
    path: "test-results/workflow-board-menu.png",
    fullPage: true,
  });

  // Archiving the default column with tasks moves them and hands the default on.
  await page.getByLabel("Options for Ready").click();
  const archive = page.getByRole("form", { name: "Archive Ready" });
  await archive.getByLabel("Move 2 tasks to").selectOption({ label: "In Progress" });
  await archive
    .getByLabel("New default for new tasks")
    .selectOption({ label: "In Progress" });
  await archive.getByRole("button", { name: "Archive column" }).click();
  await expect(page.getByRole("region", { name: "Ready" })).toHaveCount(0);
  const destination = page.getByRole("region", { name: "In Progress" });
  await expect(
    destination.getByRole("link", { name: "Draft research brief" }),
  ).toBeVisible();
  await expect(
    destination.getByRole("link", { name: "Interview two customers" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "+ Add to In Progress" }),
  ).toBeVisible();

  // The last Done column is protected; the server's reason is shown on the column.
  await page.getByLabel("Options for Done").click();
  await page
    .getByRole("form", { name: "Archive Done" })
    .getByRole("button", { name: "Archive column" })
    .click();
  await expect(
    page.getByRole("region", { name: "Done" }).getByRole("alert"),
  ).toContainText("At least one active status must be a Done status.");
});

test("edits the workflow and the project from the settings page", async ({ page }) => {
  await signUp(page);
  await createProject(page);
  await addReadyTask(page, "Write launch FAQ");

  await page.getByRole("link", { name: "Project settings" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Research Launch" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Workflow" })).toBeVisible();

  // Add a column: it lands at the end of the board.
  const add = page.getByRole("form", { name: "Add a column" });
  await add.getByLabel("New column name").fill("Testing");
  await add.getByLabel("Category").selectOption("review");
  await add.getByRole("button", { name: "Add column" }).click();
  await expect
    .poll(() => columnOrder(page))
    .toEqual([
      "Backlog",
      "Ready",
      "In Progress",
      "Blocked",
      "In Review",
      "Done",
      "Testing",
    ]);

  // Reorder by keyboard: Space lifts the row, ArrowUp moves it, Enter drops it.
  const handle = page.getByRole("button", { name: /Drag Testing/ });
  await handle.focus();
  await handle.press("Space");
  await expect(page.locator("[id^=DndLiveRegion]")).toContainText("was moved over");
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await expect
    .poll(() => columnOrder(page))
    .toEqual([
      "Backlog",
      "Ready",
      "In Progress",
      "Blocked",
      "In Review",
      "Testing",
      "Done",
    ]);

  // The move buttons are the non-drag alternative.
  await page.getByRole("button", { name: "Move Testing up" }).click();
  await expect
    .poll(() => columnOrder(page))
    .toEqual([
      "Backlog",
      "Ready",
      "In Progress",
      "Blocked",
      "Testing",
      "In Review",
      "Done",
    ]);
  await page.reload();
  await expect
    .poll(() => columnOrder(page))
    .toEqual([
      "Backlog",
      "Ready",
      "In Progress",
      "Blocked",
      "Testing",
      "In Review",
      "Done",
    ]);

  // A category change across the Done boundary says what it will do before saving.
  const readyRow = page.getByRole("listitem", { name: "Ready" });
  const readyForm = readyRow.getByRole("form", { name: "Edit Ready" });
  await readyForm.getByLabel("Category").selectOption("done");
  await expect(readyRow.getByRole("status")).toContainText(
    "Saving completes the 1 task in this column",
  );
  await readyForm.getByRole("button", { name: "Save column" }).click();
  // The default column cannot become Done; the server's reason is shown.
  await expect(readyRow.getByRole("alert")).toContainText(
    "The default status for new tasks cannot be a Done status.",
  );
  await readyForm.getByLabel("Category").selectOption("ready");
  await readyForm.getByLabel("WIP limit").fill("3");
  await readyForm.getByRole("button", { name: "Save column" }).click();
  await expect(readyForm.getByRole("button", { name: "Save column" })).toBeDisabled();
  await page.screenshot({ path: "test-results/workflow-settings.png", fullPage: true });

  // Archive Ready with its task into In Progress; the board reflects it.
  await readyRow.locator("summary").click();
  const archiveReady = readyRow.getByRole("form", { name: "Archive Ready" });
  await archiveReady
    .getByLabel("Move 1 task to")
    .selectOption({ label: "In Progress" });
  await archiveReady
    .getByLabel("New default for new tasks")
    .selectOption({ label: "Backlog" });
  await archiveReady.getByRole("button", { name: "Archive column" }).click();
  await expect
    .poll(() => columnOrder(page))
    .toEqual(["Backlog", "In Progress", "Blocked", "Testing", "In Review", "Done"]);
  await expect(page.getByRole("listitem", { name: "Backlog" })).toContainText(
    "Default for new tasks",
  );
  await page.getByRole("link", { name: "Open board" }).click();
  await expect(
    page
      .getByRole("region", { name: "In Progress" })
      .getByRole("link", { name: "Write launch FAQ" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Add to Backlog" })).toBeVisible();

  // Rename the project, then archive and restore it from the projects list.
  await page.getByRole("link", { name: "Project settings" }).click();
  const projectForm = page.getByRole("form", { name: "Project" });
  await projectForm.getByLabel("Project name").fill("Research Relaunch");
  await projectForm.getByRole("button", { name: "Save project" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Research Relaunch" }),
  ).toBeVisible();
  await projectForm.getByRole("button", { name: "Archive project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
      name: "Research Relaunch",
      exact: true,
    }),
  ).toHaveCount(0);
  const archived = page.getByRole("list", { name: "Archived projects" });
  await expect(archived).toContainText("Research Relaunch");
  await page.getByRole("button", { name: "Restore Research Relaunch" }).click();
  await expect(archived).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "Projects" }).getByText("Research Relaunch"),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
      name: "Research Relaunch",
      exact: true,
    }),
  ).toBeVisible();
});

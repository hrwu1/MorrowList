import { expect, test, type Page } from "@playwright/test";

import { openSection } from "./disclosures";

/**
 * Subtasks and checklists (spec 8.3): added from the detail, ticked off there, with
 * progress on the parent's card while the board keeps the children out of the lanes.
 */

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page) {
  const email = `subtasks-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Subtask Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
}

async function createProject(page: Page) {
  await openSection(page, "Settings");
  await page.getByRole("link", { name: "Manage projects" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await page.getByLabel("Project name").fill("Research Launch");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Research Launch" }),
  ).toBeVisible();
}

async function addReadyTask(page: Page, title: string) {
  await page.getByRole("button", { name: "+ Add to Ready" }).click();
  const capture = page.getByPlaceholder("Add to Ready and press Enter");
  await capture.fill(title);
  await capture.press("Enter");
  await expect(
    page.getByRole("region", { name: "Ready" }).getByRole("link", { name: title }),
  ).toBeVisible();
}

test("subtasks are added from the detail, tracked on the card, and hidden on the board", async ({
  page,
}) => {
  await signUp(page);
  await createProject(page);
  await addReadyTask(page, "Plan launch");

  const ready = page.getByRole("region", { name: "Ready" });
  await ready.getByRole("link", { name: "Plan launch" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  const subtasks = panel.getByRole("list", { name: "Subtasks" });
  const newSubtask = panel.getByLabel("Subtask name");

  // The keyboard is enough: type a title, Enter adds it and keeps the field ready.
  await newSubtask.fill("Collect sources");
  await newSubtask.press("Enter");
  await expect(subtasks.getByRole("link", { name: "Collect sources" })).toBeVisible();
  await expect(newSubtask).toHaveValue("");
  await newSubtask.fill("Make slides");
  await newSubtask.press("Enter");
  await expect(subtasks.getByRole("listitem")).toHaveCount(2);

  // The board hides the children and shows their progress on the parent instead.
  const card = ready.getByRole("listitem").filter({ hasText: "Plan launch" });
  await expect(card.getByLabel("0 of 2 subtasks done")).toBeVisible();
  await expect(ready.getByRole("link", { name: "Collect sources" })).toHaveCount(0);

  const tick = panel.getByRole("button", { name: "Complete Collect sources" });
  await tick.focus();
  await page.keyboard.press("Space");
  await expect(
    panel.getByRole("button", { name: "Reopen Collect sources" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByLabel("1 of 2 subtasks done")).toBeVisible();
  await page.screenshot({ path: "test-results/subtasks-detail-and-card.png" });

  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Ready" })
      .getByRole("listitem")
      .filter({ hasText: "Plan launch" })
      .getByLabel("1 of 2 subtasks done"),
  ).toBeVisible();

  // Completing the parent while a child is open asks first and leaves the child alone.
  await panel.getByRole("button", { name: "Mark complete" }).click();
  await expect(panel.getByText("Some subtasks are still open")).toBeVisible();
  await panel.getByRole("button", { name: "Keep it open" }).click();
  await expect(panel.getByRole("button", { name: "Mark complete" })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Complete Make slides" }),
  ).toHaveAttribute("aria-pressed", "false");

  // The view toggle reveals the children as cards of their own.
  const controls = page.getByRole("region", { name: "Board controls" });
  await controls.locator("summary").click();
  await controls.getByLabel("Subtasks shown").selectOption("show");
  await expect(page).toHaveURL(/subtasks=show/);
  await expect(
    page
      .getByRole("region", { name: "Ready" })
      .getByRole("link", { name: "Make slides" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Done" })
      .getByRole("link", { name: "Collect sources" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/subtasks-board-shown.png" });

  // Once every child is done the detail offers to complete the parent in one click.
  await panel.getByRole("button", { name: "Complete Make slides" }).click();
  await expect(panel.getByText("All subtasks are done")).toBeVisible();
  await panel.getByRole("button", { name: "Complete parent" }).click();
  await expect(panel.getByRole("button", { name: "Reopen task" })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Done" })
      .getByRole("link", { name: "Plan launch" }),
  ).toBeVisible();
});

test("a subtask can be detached and a fourth nesting level is refused", async ({
  page,
}) => {
  await signUp(page);
  await createProject(page);
  await addReadyTask(page, "Level one");

  const ready = page.getByRole("region", { name: "Ready" });
  await ready.getByRole("link", { name: "Level one" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await panel.getByLabel("Subtask name").fill("Level two");
  await panel.getByLabel("Subtask name").press("Enter");
  await panel
    .getByRole("list", { name: "Subtasks" })
    .getByRole("link", { name: "Level two" })
    .click();

  // The subtask's own page: it names its parent and takes children of its own.
  await expect(page).toHaveURL(/\/tasks\/[A-Z]+-2$/);
  const levelTwoUrl = page.url();
  await expect(page.getByText(/Subtask of/)).toBeVisible();
  const two = page.getByLabel("Subtask name");
  await two.fill("Level three");
  await two.press("Enter");
  await page
    .getByRole("list", { name: "Subtasks" })
    .getByRole("link", { name: "Level three" })
    .click();
  await expect(page).toHaveURL(/\/tasks\/[A-Z]+-3$/);
  const three = page.getByLabel("Subtask name");
  await three.fill("Level four");
  await three.press("Enter");
  await expect(
    page.getByRole("region", { name: "Subtasks" }).getByRole("alert"),
  ).toContainText(/nest at most 3 levels/);

  await page
    .getByRole("button", { name: /Detach Level three from its parent/ })
    .click();
  await expect(page.getByText(/Subtask of/)).toHaveCount(0);

  await page.goto(levelTwoUrl);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Level two");
  await expect(page.getByRole("list", { name: "Subtasks" })).toHaveCount(0);
  await expect(page.getByText("Break this task down")).toBeVisible();
});

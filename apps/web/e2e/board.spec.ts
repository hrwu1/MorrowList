import { expect, test, type Locator, type Page } from "@playwright/test";

import { openSection } from "./disclosures";

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page) {
  const email = `board-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Board Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
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
  // React publishes the highlighted destination after the pointer event. Drop only
  // once that visible feedback confirms the sidebar has accepted this position.
  if (
    await target.evaluate((element) => element.closest(".workspace-sidebar") !== null)
  ) {
    await expect(target).toHaveAttribute("data-drop-target", "true");
  }
  await page.mouse.up();
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

test("quickly creates projects from desktop and mobile navigation", async ({
  page,
}) => {
  await signUp(page);

  const desktopAdd = page.getByRole("button", { name: "Add project" });
  await desktopAdd.click();
  const desktopForm = page.getByRole("form", { name: "Quick add project" });
  const desktopName = desktopForm.getByLabel("Project name");
  await expect(desktopName).toBeFocused();
  await desktopName.press("Escape");
  await expect(desktopForm).toHaveCount(0);
  await expect(desktopAdd).toBeFocused();

  await desktopAdd.click();
  await page
    .getByRole("form", { name: "Quick add project" })
    .getByLabel("Project name")
    .fill("Sidebar Launch");
  await page
    .getByRole("form", { name: "Quick add project" })
    .getByLabel("Project name")
    .press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Sidebar Launch" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sidebar Launch", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  await page.getByRole("button", { name: "Add project" }).click();
  const retryForm = page.getByRole("form", { name: "Quick add project" });
  const retryName = retryForm.getByLabel("Project name");
  await retryName.fill("Sidebar Launch");
  await retryName.press("Enter");
  await expect(retryForm.getByRole("alert")).toContainText(
    "A project with this name already exists.",
  );
  await expect(retryName).toHaveValue("Sidebar Launch");
  await retryName.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Open workspace navigation").click();
  await page.getByRole("button", { name: "Add project" }).click();
  const mobileForm = page.getByRole("form", { name: "Quick add project" });
  await mobileForm.getByLabel("Project name").fill("Mobile Launch");
  await mobileForm.getByRole("button", { name: "Create project" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Mobile Launch" }),
  ).toBeVisible();
  await expect(page.getByRole("form", { name: "Quick add project" })).toHaveCount(0);
});

test("creates a project and moves a board task with pointer drag", async ({ page }) => {
  await signUp(page);
  await createProject(page);

  for (const status of ["Backlog", "Ready", "In Progress", "Done"]) {
    await expect(page.getByRole("heading", { level: 2, name: status })).toBeVisible();
  }
  await expect(page.getByRole("heading", { level: 2, name: "Blocked" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "In Review" })).toHaveCount(
    0,
  );

  const controls = page.getByRole("region", { name: "Board controls" });
  await controls.locator("summary").click();
  await controls.getByLabel("Stages shown").selectOption("all");
  await expect(page.getByRole("heading", { level: 2, name: "Blocked" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "In Review" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "+ Add to Ready" }).click();
  const capture = page.getByPlaceholder("Add to Ready and press Enter");
  await capture.fill("Draft research brief");
  await capture.press("Enter");

  const ready = page.getByRole("region", { name: "Ready" });
  const inProgress = page.getByRole("region", { name: "In Progress" });
  await expect(ready.getByRole("link", { name: "Draft research brief" })).toBeVisible();

  const handle = ready.getByRole("button", { name: /Drag Draft research brief/ });
  await dragWithPointer(handle, inProgress, page);

  await expect(
    inProgress.getByRole("link", { name: "Draft research brief" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "In Progress" })
      .getByRole("link", { name: "Draft research brief" }),
  ).toBeVisible();
});

test("automatic sort disables drag but keeps the Move menu", async ({ page }) => {
  await signUp(page);
  await createProject(page);
  await page.getByRole("button", { name: "+ Add to Ready" }).click();
  const capture = page.getByPlaceholder("Add to Ready and press Enter");
  await capture.fill("Review interview notes");
  await capture.press("Enter");

  const controls = page.getByRole("region", { name: "Board controls" });
  await controls.locator("summary").click();
  await controls.getByLabel("Sort board").selectOption("priority");
  await expect(page).toHaveURL(/sort=priority/);

  // Columns accept no drops while automatically sorted, but the card still drags (it can
  // be dropped on a sidebar project), so a column drop simply leaves it where it was.
  const ready = page.getByRole("region", { name: "Ready" });
  await dragWithPointer(
    ready.getByRole("listitem").filter({ hasText: "Review interview notes" }),
    page.getByRole("region", { name: "In Progress" }),
    page,
  );
  await expect(
    ready.getByRole("link", { name: "Review interview notes" }),
  ).toBeVisible();

  const move = page.getByLabel("Move Review interview notes");
  await expect(move).toBeEnabled();
  await move.selectOption({ label: "In Review" });
  await expect(
    page
      .getByRole("region", { name: "In Review" })
      .getByRole("link", { name: "Review interview notes" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("region", { name: "Ready" })).toBeVisible();
  await expect(page.getByRole("region", { name: "In Review" })).toBeHidden();
  await page.getByLabel("Board stage").selectOption({ label: "In Review · 1" });
  await expect(page.getByRole("region", { name: "Ready" })).toBeHidden();
  await expect(page.getByRole("region", { name: "In Review" })).toBeVisible();
});

test("captures globally, sorts into a project, and keeps board history current", async ({
  page,
}) => {
  await signUp(page);
  await createProject(page);

  await page
    .getByRole("button", { name: "Capture a new Inbox task", exact: true })
    .click();
  const tray = page.getByRole("dialog", { name: "Inbox" });
  const capture = tray.getByPlaceholder("Add a task and press Enter");
  await capture.fill("Shape launch narrative");
  await capture.press("Enter");

  const trayTasks = tray.getByRole("list", { name: "Inbox tray tasks" });
  await expect(
    trayTasks.getByRole("link", { name: "Shape launch narrative" }),
  ).toBeVisible();
  await tray
    .getByLabel("Send Shape launch narrative to project")
    .selectOption({ label: "Research Launch" });
  await expect(
    trayTasks.getByRole("link", { name: "Shape launch narrative" }),
  ).toHaveCount(0);
  await expect(capture).toBeFocused();

  await tray.getByRole("button", { name: "Close Inbox" }).click();
  const ready = page.getByRole("region", { name: "Ready" });
  await expect(
    ready.getByRole("link", { name: "Shape launch narrative" }),
  ).toBeVisible();

  await ready.getByRole("link", { name: "Shape launch narrative" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await panel.getByLabel("Title").fill("Shape the launch narrative");
  await panel.getByLabel("Title").blur();
  await expect(panel.getByText("Saved")).toBeVisible();
  await expect(
    ready.getByRole("link", { name: "Shape the launch narrative" }),
  ).toBeVisible();

  await panel.locator("summary").filter({ hasText: "More actions" }).click();
  await panel.getByRole("button", { name: "Move to Trash" }).click();
  await expect(
    ready.getByRole("link", { name: "Shape the launch narrative" }),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "History" }).click();
  const history = page.getByRole("navigation", { name: "History views" });
  await history.getByRole("link", { name: "Trash" }).click();
  const trash = page.getByRole("list", { name: "Trash tasks" });
  await expect(trash.getByText("Shape the launch narrative")).toBeVisible();
  await trash
    .getByRole("button", { name: "Restore Shape the launch narrative" })
    .click();

  await page.getByRole("link", { name: "Research Launch", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Ready" })
      .getByRole("link", { name: "Shape the launch narrative" }),
  ).toBeVisible();
});

async function addSecondProject(page: Page) {
  await page.getByRole("button", { name: "Add project" }).click();
  const form = page.getByRole("form", { name: "Quick add project" });
  await form.getByLabel("Project name").fill("Design System");
  await form.getByLabel("Project name").press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Design System" }),
  ).toBeVisible();
}

/**
 * Waits for the named board before opening its capture input: the sidebar link that
 * precedes this is a soft navigation, and clicking "+ Add to Ready" while the previous
 * board is still on screen files the task under that project instead.
 */
async function addReadyTask(page: Page, project: string, title: string) {
  await expect(page.getByRole("heading", { level: 1, name: project })).toBeVisible();
  await page.getByRole("button", { name: "+ Add to Ready" }).click();
  const capture = page.getByPlaceholder("Add to Ready and press Enter");
  await capture.fill(title);
  await capture.press("Enter");
  await expect(
    page.getByRole("region", { name: "Ready" }).getByRole("link", { name: title }),
  ).toBeVisible();
}

test("the Project field moves a task to another project or back to the Inbox", async ({
  page,
}) => {
  await signUp(page);
  await createProject(page);
  await addSecondProject(page);
  await page.getByRole("link", { name: "Research Launch", exact: true }).click();
  await addReadyTask(page, "Research Launch", "Write launch FAQ");

  const ready = page.getByRole("region", { name: "Ready" });
  await ready.getByRole("link", { name: "Write launch FAQ" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await panel.getByLabel("Project").selectOption({ label: "Design System" });
  await expect(ready.getByRole("link", { name: "Write launch FAQ" })).toHaveCount(0);
  await expect(panel.getByLabel("Project")).toHaveValue(/./);

  await page.getByRole("link", { name: "Design System", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Ready" })
      .getByRole("link", { name: "Write launch FAQ" }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("region", { name: "Ready" })
    .getByRole("link", { name: "Write launch FAQ" })
    .click();
  await page
    .getByRole("complementary", { name: /Task details for/ })
    .getByLabel("Project")
    .selectOption({ label: "Inbox" });
  await expect(
    page
      .getByRole("region", { name: "Ready" })
      .getByRole("link", { name: "Write launch FAQ" }),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "Open full Inbox" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Write launch FAQ" })).toBeVisible();
});

test("dragging a card or row onto a sidebar destination moves it there", async ({
  page,
}) => {
  await signUp(page);
  await createProject(page);
  await addSecondProject(page);
  await page.getByRole("link", { name: "Research Launch", exact: true }).click();
  await addReadyTask(page, "Research Launch", "Sketch onboarding flow");

  const ready = page.getByRole("region", { name: "Ready" });
  const card = ready
    .getByRole("listitem")
    .filter({ hasText: "Sketch onboarding flow" });
  // Grabbing the title (a link) drags the card like anywhere else, and releasing it
  // never follows the link.
  await dragWithPointer(
    card.getByRole("link", { name: "Sketch onboarding flow" }),
    page.getByRole("link", { name: "Design System", exact: true }),
    page,
  );
  await expect(ready.getByRole("link", { name: "Sketch onboarding flow" })).toHaveCount(
    0,
  );
  await expect(page).not.toHaveURL(/task=/);

  await page.getByRole("link", { name: "Design System", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Ready" })
      .getByRole("link", { name: "Sketch onboarding flow" }),
  ).toBeVisible();

  // Back to the Inbox by dropping on the Inbox link, then into a project from a list row.
  await dragWithPointer(
    page
      .getByRole("region", { name: "Ready" })
      .getByRole("listitem")
      .filter({ hasText: "Sketch onboarding flow" }),
    page.getByRole("button", { name: /Open Inbox tray/ }),
    page,
  );
  await expect(
    page
      .getByRole("region", { name: "Ready" })
      .getByRole("link", { name: "Sketch onboarding flow" }),
  ).toHaveCount(0);

  await page.getByRole("link", { name: "Open full Inbox" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Sketch onboarding flow" });
  await expect(row).toBeVisible();
  await dragWithPointer(
    row,
    page.getByRole("link", { name: "Research Launch", exact: true }),
    page,
  );
  await expect(row).toHaveCount(0);

  await page.getByRole("link", { name: "Research Launch", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Ready" })
      .getByRole("link", { name: "Sketch onboarding flow" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Ready" })
      .getByRole("link", { name: "Sketch onboarding flow" }),
  ).toBeVisible();

  // The keyboard drag reaches the sidebar too: Space lifts, arrows travel across the
  // columns into the sidebar and up to the Inbox link, Enter drops.
  const handle = page.getByRole("button", { name: /Drag Sketch onboarding flow/ });
  await handle.focus();
  await handle.press("Space");
  // dnd-kit measures the drop targets right after pickup; a key pressed before that
  // measurement lands is ignored, so wait for the pickup to be announced and pace keys.
  await expect(page.locator("[id^=DndLiveRegion]")).toContainText("was moved over");
  for (const key of [
    "ArrowLeft",
    "ArrowLeft",
    "ArrowLeft",
    "ArrowUp",
    "ArrowUp",
    "ArrowUp",
  ]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(100);
  }
  await page.keyboard.press("Enter");
  await expect(
    page
      .getByRole("region", { name: "Ready" })
      .getByRole("link", { name: "Sketch onboarding flow" }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Open full Inbox" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sketch onboarding flow" }),
  ).toBeVisible();
});

import { expect, test, type Page } from "@playwright/test";

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

async function createProject(page: Page) {
  await page.getByRole("link", { name: "Manage projects" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await page.getByLabel("Project name").fill("Research Launch");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Research Launch" }),
  ).toBeVisible();
}

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
  const start = await handle.boundingBox();
  const destination = await inProgress.boundingBox();
  expect(start).not.toBeNull();
  expect(destination).not.toBeNull();
  if (!start || !destination) return;

  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    destination.x + destination.width / 2,
    destination.y + destination.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();

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
  await expect(
    page.getByRole("button", {
      name: /Drag Review interview notes unavailable while automatically sorted/,
    }),
  ).toBeDisabled();

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
  await page.getByLabel("Lane").selectOption({ label: "In Review · 1" });
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

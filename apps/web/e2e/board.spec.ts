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
  await page.getByRole("link", { name: "Projects" }).click();
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

  for (const status of [
    "Backlog",
    "Ready",
    "In Progress",
    "Blocked",
    "In Review",
    "Done",
  ]) {
    await expect(page.getByRole("heading", { level: 2, name: status })).toBeVisible();
  }

  await page.getByRole("button", { name: "+ New task" }).click();
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
  await page.getByRole("button", { name: "+ New task" }).click();
  const capture = page.getByPlaceholder("Add to Ready and press Enter");
  await capture.fill("Review interview notes");
  await capture.press("Enter");

  await page.getByLabel("Sort board").selectOption("priority");
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

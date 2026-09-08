import { openProjectBoard, openSection } from "./disclosures";
import { expect, test, type Page } from "./fixtures";

async function signUp(page: Page) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Comfort Tester");
  await page.getByLabel("Email").fill(`comfort-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();
}

async function board(page: Page) {
  await signUp(page);
  await page.getByRole("button", { name: "Add project", exact: true }).click();
  await page
    .getByRole("form", { name: "Quick add project" })
    .getByLabel("Project name")
    .fill("Quiet workspace");
  await page
    .getByRole("form", { name: "Quick add project" })
    .getByLabel("Project name")
    .press("Enter");
  await expect(
    page.getByRole("heading", { name: "Quiet workspace", exact: true }),
  ).toBeVisible();
  await openProjectBoard(page);
  await page.getByRole("button", { name: "+ Add a task" }).click();
  const input = page.getByPlaceholder("Add to Ready and press Enter");
  await input.fill("Prepare the next release with a readable title");
  await input.press("Enter");
  const title = page.getByRole("link", {
    name: "Prepare the next release with a readable title",
    exact: true,
  });
  await expect(title).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  return title;
}

test("card titles lead, settings fit, and disclosed task fields still save", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const title = await board(page);
  const card = page.locator(".board-card").filter({ has: title });
  const titleRect = await title.boundingBox();
  const cardRect = await card.boundingBox();
  const actionsRect = await card.locator(".board-card__controls").boundingBox();
  expect(titleRect!.width).toBeGreaterThan(cardRect!.width - 40);
  expect(actionsRect!.y).toBeGreaterThan(titleRect!.y + titleRect!.height);
  const sidebar = await page
    .getByRole("complementary", { name: "Workspace", exact: true })
    .boundingBox();
  const tools = await page.locator(".workspace-topline__tools").boundingBox();
  expect(tools!.x + tools!.width).toBeLessThan(sidebar!.width);
  await expect(
    page.getByRole("link", { name: "Manage projects", exact: true }),
  ).toBeHidden();
  await openSection(page, "Settings");
  await expect(
    page.getByRole("link", { name: "Manage projects", exact: true }),
  ).toBeVisible();
  // Expanding utilities on a short screen must not collapse the project section
  // underneath History or block its Add project control.
  await page.setViewportSize({ width: 1280, height: 720 });
  const addProject = page.getByRole("button", { name: "Add project", exact: true });
  await addProject.click();
  await expect(page.getByRole("form", { name: "Quick add project" })).toBeVisible();
  await addProject.click();

  await title.click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await expect(panel.getByLabel("Priority")).toBeHidden();
  const description = panel.locator("summary").filter({ hasText: "Description" });
  const schedule = panel
    .locator("summary")
    .filter({ hasText: "Scheduling & priority" });
  expect((await description.boundingBox())!.y).toBeLessThan(
    (await schedule.boundingBox())!.y,
  );
  await openSection(panel, "Description");
  await panel
    .getByLabel("Markdown", { exact: true })
    .fill("Notes stay close to the task.");
  await openSection(panel, "Scheduling & priority");
  await panel.getByLabel("Priority").selectOption("high");
  await expect(panel.getByText("Saved", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(title).toBeFocused();
  await title.click();
  await expect(schedule).toContainText("high");
  await openSection(panel, "Description");
  await expect(panel.getByLabel("Markdown", { exact: true })).toHaveValue(
    "Notes stay close to the task.",
  );
});

test("mobile reaches tasks quickly and retains a non-drag move in dark reduced-motion mode", async ({
  page,
}) => {
  const title = await board(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(title).toBeVisible();
  // The studio header changed the card's pixel offset. Keep the user guarantee:
  // the whole title is reachable without scrolling on this phone viewport.
  await expect(title).toBeInViewport({ ratio: 1 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  const header = page.locator(".workspace-mobile-header");
  expect((await header.boundingBox())!.height).toBeLessThan(75);
  const move = page.getByLabel("Move Prepare the next release with a readable title", {
    exact: true,
  });
  await move.selectOption({ label: "In Progress" });
  await page.getByLabel("Board stage").selectOption({ label: "In Progress · 1" });
  await expect(title).toBeVisible();
  await title.click();
  await page.getByRole("button", { name: "Close task details" }).click();
  await expect(title).toBeFocused();
  await page.getByLabel("Open workspace navigation", { exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Mobile workspace", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByLabel("Open workspace navigation", { exact: true }),
  ).toBeFocused();
});

test("Today chooses existing work directly and keeps the choice after reload", async ({
  page,
}) => {
  await signUp(page);
  const input = page.getByPlaceholder("Add a task and press Enter");
  await input.fill("Plan a comfortable day");
  await input.press("Enter");
  await expect(
    page.getByRole("link", { name: "Plan a comfortable day", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Today", exact: true }).click();
  const choose = page.getByRole("button", {
    name: "Choose tasks for today",
    exact: true,
  });
  await choose.click();
  await page
    .getByRole("button", {
      name: "Choose Plan a comfortable day for today",
      exact: true,
    })
    .click();
  await expect(page.getByRole("list", { name: "My Day tasks" })).toContainText(
    "Plan a comfortable day",
  );
  await expect(
    page.getByRole("button", { name: "Done choosing", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Done choosing", exact: true }).click();
  await expect(choose).toBeFocused();
  await page.reload();
  await expect(page.getByRole("list", { name: "My Day tasks" })).toContainText(
    "Plan a comfortable day",
  );
});

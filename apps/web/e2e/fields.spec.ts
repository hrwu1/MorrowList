import { expect, test, type Page } from "@playwright/test";

/**
 * Typed custom fields end to end (GAP-24): define a select field in settings, set it on a
 * task from the detail, see it on the card, filter a list by it, and watch the cap of ten
 * refuse the eleventh.
 */

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page) {
  const email = `fields-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Field Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
}

async function defineField(
  page: Page,
  name: string,
  type: string,
  options?: string,
  onCard = false,
) {
  const form = page.getByRole("form", { name: "Define a field" });
  await form.getByLabel("Field name").fill(name);
  await form.getByLabel("Type").selectOption({ label: type });
  if (options !== undefined) await form.getByLabel("Choices").fill(options);
  if (onCard) await form.getByLabel("Show on cards").check();
  await form.getByRole("button", { name: "Create field" }).click();
  await expect(page.getByRole("form", { name: `Edit field ${name}` })).toBeVisible();
}

test("a select field is defined, set on a task, shown on the row, and filtered by", async ({
  page,
}) => {
  await signUp(page);

  // Define the field in settings, reached from the workspace's own settings page.
  await page.getByRole("link", { name: "Workspace settings", exact: true }).click();
  await page.getByRole("link", { name: "Manage fields" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Custom fields" }),
  ).toBeVisible();
  await defineField(page, "Stage", "Choice", "Alpha, Beta", true);
  await expect(page.getByText("9 of 10 left.")).toBeVisible();

  // Capture two Inbox tasks.
  await page.getByRole("link", { name: "Inbox" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  const capture = page.getByPlaceholder("Add a task and press Enter");
  const inbox = page.getByRole("list", { name: "Inbox tasks" });
  for (const title of ["Ship the beta", "Write the brief"]) {
    await capture.fill(title);
    await capture.press("Enter");
    await expect(inbox.getByRole("link", { name: title })).toBeVisible();
  }
  const rows = inbox.locator(":scope > li");
  await expect(rows).toHaveCount(2);

  // Set the value from the detail panel.
  await inbox.getByRole("link", { name: "Ship the beta" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await panel.getByLabel("Stage", { exact: true }).selectOption("Beta");
  const shipped = inbox.getByRole("listitem").filter({ hasText: "Ship the beta" });
  // The flagged field reads on the row itself, once the mutation lands.
  await expect(shipped.getByText("Beta", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Close task details" }).click();

  // Filter the list by it; the choice survives a reload because it is in the URL.
  const filters = page.getByRole("region", { name: "Filter and sort" });
  await filters.locator("summary").click();
  await filters.getByLabel("Custom field").selectOption({ label: "Stage" });
  await filters.getByLabel("Stage value").selectOption("Beta");
  await expect(page).toHaveURL(/field=stage%3Aeq%3ABeta/);
  await expect(rows).toHaveCount(1);
  await expect(inbox.getByText("Ship the beta")).toBeVisible();
  await page.reload();
  await expect(rows).toHaveCount(1);
  await expect(page.getByText("Stage is Beta")).toBeVisible();
  await page.screenshot({
    path: "test-results/fields-inbox-filter.png",
    fullPage: true,
  });

  // "is empty" finds the other one instead.
  await filters.locator("summary").click();
  await filters.getByLabel("Stage comparison").selectOption("empty");
  await expect(rows).toHaveCount(1);
  await expect(inbox.getByText("Write the brief")).toBeVisible();
});

test("the eleventh field is refused with a clear error", async ({ page }) => {
  await signUp(page);
  await page.getByRole("link", { name: "Workspace settings", exact: true }).click();
  await page.getByRole("link", { name: "Manage fields" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Custom fields" }),
  ).toBeVisible();

  for (let index = 1; index <= 10; index += 1) {
    await defineField(page, `Field ${index}`, "Text");
  }

  await expect(
    page.getByText("All 10 fields are in use. Delete one to define another."),
  ).toBeVisible();
  const form = page.getByRole("form", { name: "Define a field" });
  await expect(form.getByRole("button", { name: "Create field" })).toBeDisabled();
  await expect(form.getByLabel("Field name")).toBeDisabled();
});

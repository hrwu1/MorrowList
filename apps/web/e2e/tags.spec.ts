import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Tags end to end (GAP-03, spec 12.1): create a tag from the task detail, see it on the
 * card, filter a list by it, rename it in settings, and see the chip follow.
 */

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page) {
  const email = `tags-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Tag Tester");
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

async function addReadyTask(page: Page, title: string) {
  await page.getByRole("button", { name: "+ Add to Ready" }).click();
  const capture = page.getByPlaceholder("Add to Ready and press Enter");
  await capture.fill(title);
  await capture.press("Enter");
  await expect(
    page.getByRole("region", { name: "Ready" }).getByRole("link", { name: title }),
  ).toBeVisible();
}

/** Type a tag name into the detail panel's picker and submit it. */
async function addTag(panel: Locator, name: string, shownAs = name) {
  const field = panel.getByLabel("Add tag");
  await field.fill(name);
  await field.press("Enter");
  await expect(
    panel.getByRole("list", { name: "Tags" }).getByText(shownAs, { exact: true }),
  ).toBeVisible();
}

test("tags travel from the detail to the card, the filter, and settings", async ({
  page,
}) => {
  await signUp(page);
  await createProject(page);
  await addReadyTask(page, "Draft research brief");

  // Create a tag from the detail and see it on the card.
  const ready = page.getByRole("region", { name: "Ready" });
  const card = ready.getByRole("listitem").filter({ hasText: "Draft research brief" });
  await card.getByRole("link", { name: "Draft research brief" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await addTag(panel, "Deep Work");
  await expect(card.getByRole("list", { name: "Tags" })).toContainText("Deep Work");

  // Five tags: the card shows three plus "+2"; the detail shows all five.
  for (const name of ["Writing", "Research", "Later", "Urgent-ish"]) {
    await addTag(panel, name);
  }
  const panelTags = panel.getByRole("list", { name: "Tags" }).getByRole("listitem");
  await expect(panelTags).toHaveCount(5);
  await expect(panelTags).toContainText([
    "Deep Work",
    "Later",
    "Research",
    "Urgent-ish",
    "Writing",
  ]);
  const cardTags = card.getByRole("list", { name: "Tags" }).getByRole("listitem");
  await expect(cardTags).toHaveCount(4);
  await expect(cardTags.nth(3)).toContainText("+2");
  await expect(cardTags.nth(3)).toContainText("2 more: Urgent-ish, Writing");
  await page.screenshot({ path: "test-results/tags-board-light.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "test-results/tags-board-dark.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });

  // Removing a tag from the detail takes it off the card too.
  await panel.getByRole("button", { name: "Remove tag Later" }).click();
  await expect(panelTags).toHaveCount(4);
  await expect(cardTags.nth(3)).toContainText("+1");

  // The same tag attaches to an Inbox task, and the Inbox list filters by it.
  await page.getByRole("link", { name: "Open full Inbox" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  const capture = page.getByPlaceholder("Add a task and press Enter");
  const inbox = page.getByRole("list", { name: "Inbox tasks" });
  for (const title of ["Buy milk", "Write essay"]) {
    await capture.fill(title);
    await capture.press("Enter");
    await expect(inbox.getByRole("link", { name: title })).toBeVisible();
  }
  // Rows only: a tagged row nests a list of chips, which are list items too.
  const rows = inbox.locator(":scope > li");
  await expect(rows).toHaveCount(2);

  await inbox.getByRole("link", { name: "Write essay" }).click();
  const inboxPanel = page.getByRole("complementary", { name: /Task details for/ });
  // Matching is case-insensitive: this attaches the existing "Deep Work".
  await addTag(inboxPanel, "deep work", "Deep Work");
  await expect(
    inbox
      .getByRole("listitem")
      .filter({ hasText: "Write essay" })
      .getByRole("list", { name: "Tags" }),
  ).toContainText("Deep Work");
  await inboxPanel.getByRole("button", { name: "Close task details" }).click();

  const filters = page.getByRole("region", { name: "Filter and sort" });
  await filters.locator("summary").click();
  await filters.getByLabel("Tag").selectOption({ label: "Deep Work" });
  await expect(page).toHaveURL(/tag=/);
  await expect(rows).toHaveCount(1);
  await expect(inbox.getByText("Write essay")).toBeVisible();
  await page.reload();
  await expect(rows).toHaveCount(1);
  await expect(page.getByText("Tag: Deep Work")).toBeVisible();
  await page.screenshot({ path: "test-results/tags-inbox-filter.png", fullPage: true });

  // Settings: a case-insensitive duplicate is refused; a rename reaches every chip.
  await page.getByRole("link", { name: "Manage tags" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tags" })).toBeVisible();
  const createForm = page.getByRole("form", { name: "Create a tag" });
  await createForm.getByLabel("Tag name").fill("deep work");
  await createForm.getByRole("button", { name: "Create tag" }).click();
  await expect(createForm.getByRole("alert")).toContainText(
    'A tag named "Deep Work" already exists',
  );

  const editForm = page.getByRole("form", { name: "Edit tag Deep Work" });
  await expect(editForm).toContainText("2 tasks");
  await editForm.getByLabel("Name").fill("Deep Focus");
  await editForm.getByLabel("Colour").selectOption("teal");
  await editForm.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("form", { name: "Edit tag Deep Focus" })).toBeVisible();

  await page.getByRole("button", { name: "Delete Research" }).click();
  await page.getByRole("button", { name: "Confirm deleting Research" }).click();
  await expect(page.getByRole("form", { name: "Edit tag Research" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/tags-settings.png", fullPage: true });

  await page.getByRole("link", { name: "Open full Inbox" }).click();
  const renamedChip = page
    .getByRole("list", { name: "Inbox tasks" })
    .getByRole("listitem")
    .filter({ hasText: "Write essay" })
    .getByRole("list", { name: "Tags" })
    .getByText("Deep Focus");
  await expect(renamedChip).toBeVisible();
  await expect(renamedChip.locator("..")).toHaveAttribute("data-color", "teal");

  await page.getByRole("link", { name: "Research Launch", exact: true }).click();
  const boardCard = page
    .getByRole("region", { name: "Ready" })
    .getByRole("listitem")
    .filter({ hasText: "Draft research brief" });
  await expect(
    boardCard.getByRole("list", { name: "Tags" }).getByRole("listitem"),
  ).toContainText(["Deep Focus", "Urgent-ish", "Writing"]);
});

import { expect, test, type Page } from "@playwright/test";

/**
 * Search and saved views end to end (GAP-02, spec 9.8): find a task by key, by a word
 * in its description, and by a tag; save the Inbox filters as a view; reload and open
 * it from the sidebar; and do the search entirely from the keyboard.
 */

const PASSWORD = "correct-horse-battery-staple";

// Each journey crosses several routes that a cold dev server compiles on first use.
test.describe.configure({ timeout: 90_000 });

async function signUp(page: Page) {
  const email = `search-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Search Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  // The first Inbox render on a cold dev server compiles the shell; allow for it.
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible({
    timeout: 20_000,
  });
}

/** Open the filter disclosure unless it is already open. */
async function openFilters(page: Page) {
  const filters = page.getByRole("region", { name: "Filter and sort" });
  if (!(await filters.getByLabel("Priority").isVisible())) {
    await filters.locator("summary").click();
  }
  return filters;
}

async function capture(page: Page, title: string) {
  const field = page.getByPlaceholder("Add a task and press Enter");
  await field.fill(title);
  await field.press("Enter");
  await expect(
    page.getByRole("list", { name: "Inbox tasks" }).getByRole("link", { name: title }),
  ).toBeVisible();
}

test("search finds tasks by key, description word, and tag, from the keyboard", async ({
  page,
}) => {
  await signUp(page);
  await capture(page, "Prepare slides");
  await capture(page, "Water the plants");
  await capture(page, "Call the bank");

  // Give the first task a description and a tag through its detail.
  await page.getByRole("link", { name: "Prepare slides" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await panel.locator("summary").filter({ hasText: "Description" }).click();
  await panel.getByLabel("Markdown").fill("Quarterly budget review for the board");
  await panel.getByLabel("Markdown").blur();
  await expect(panel.getByText("Saved")).toBeVisible();
  const tagField = panel.getByLabel("Add tag");
  await tagField.fill("Finance");
  await tagField.press("Enter");
  await expect(panel.getByRole("list", { name: "Tags" })).toContainText("Finance");
  await panel.getByRole("button", { name: "Close task details" }).click();

  // `/` opens the dialog; a key goes straight to the task with Enter. The workspace
  // prefix comes from the account name, so the key is read off the row.
  const bankKey = await page
    .getByRole("list", { name: "Inbox tasks" })
    .getByRole("listitem")
    .filter({ hasText: "Call the bank" })
    .locator(".task-row__key")
    .innerText();
  await page.keyboard.press("/");
  const search = page.getByRole("combobox", { name: "Search tasks and projects" });
  await expect(search).toBeFocused();
  await search.fill(bankKey.toLowerCase());
  const results = page.getByRole("listbox", { name: "Search results" });
  await expect(results.getByRole("option").first()).toContainText("Call the bank");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/tasks/${bankKey}$`));
  await expect(page.getByRole("heading", { name: `Task ${bankKey}` })).toBeVisible();

  // A description word: the hit shows the excerpt with the match marked.
  await page.keyboard.press("/");
  await search.fill("budget");
  const budgetHit = results.getByRole("option").filter({ hasText: "Prepare slides" });
  await expect(budgetHit).toBeVisible();
  await expect(budgetHit.locator("mark")).toHaveText("budget");
  await page.screenshot({ path: "test-results/search-dialog.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "test-results/search-dialog-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });

  // Opened from its button, arrow keys move the active option; Escape closes and
  // returns focus to that button.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Search tasks and projects" }).click();
  await search.fill("plan");
  await expect(results.getByRole("option")).toHaveCount(2);
  await expect(results.getByRole("option").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("ArrowDown");
  await expect(results.getByRole("option").nth(1)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("ArrowUp");
  await expect(results.getByRole("option").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(results).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Search tasks and projects" }),
  ).toBeFocused();

  // By tag name, then an operator and an invalid operator value on the search page.
  await page.getByRole("button", { name: "Search tasks and projects" }).click();
  await search.fill("finance");
  await expect(results.getByRole("option").first()).toContainText("Prepare slides");
  await search.fill("tag:finance");
  await expect(results.getByRole("option").first()).toContainText("Prepare slides");
  // The results of the new query are in once the page link carries it.
  await expect(
    results.getByRole("link", { name: /page with filters/ }),
  ).toHaveAttribute("href", "/search?q=tag%3Afinance");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/search\?q=tag%3Afinance$/);
  await expect(page.getByRole("heading", { level: 1, name: "Search" })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Search results" }).getByRole("link"),
  ).toHaveCount(1);

  const query = page.getByRole("searchbox", { name: "Search query" });
  await query.fill("due:soon");
  await query.press("Enter");
  await expect(
    page.getByRole("alert").filter({ hasText: "Search failed" }),
  ).toContainText("Unknown due: value");
  await query.fill("the");
  await query.press("Enter");
  const filters = await openFilters(page);
  await filters.getByLabel("Tag").selectOption({ label: "Finance" });
  await expect(page).toHaveURL(/q=the.*tag=|tag=.*q=the/);
  await expect(
    page.getByRole("list", { name: "Search results" }).getByRole("link"),
  ).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole("list", { name: "Search results" }).getByRole("link"),
  ).toHaveCount(1);
  await page.screenshot({ path: "test-results/search-page.png", fullPage: true });
});

test("a filter set saves as a personal view that survives a reload and reorders", async ({
  page,
}) => {
  await signUp(page);
  await capture(page, "Urgent thing");
  await capture(page, "Calm thing");
  await page.getByRole("link", { name: "Urgent thing" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await panel.getByLabel("Priority").selectOption("urgent");
  await expect(panel.getByText("Saved")).toBeVisible();
  await panel.getByRole("button", { name: "Close task details" }).click();

  const inbox = page.getByRole("list", { name: "Inbox tasks" });
  const filters = await openFilters(page);
  await filters.getByLabel("Priority").selectOption("urgent");
  await expect(inbox.getByRole("listitem")).toHaveCount(1);

  const saveForm = page.getByRole("form", { name: "Save as view" });
  await saveForm.getByLabel("Save as view").fill("Urgent inbox");
  await saveForm.getByRole("button", { name: "Save view" }).click();
  await expect(page).toHaveURL(/\/views\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Urgent inbox" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Urgent inbox tasks" }).getByRole("listitem"),
  ).toHaveCount(1);
  await expect(page.getByText("As saved")).toBeVisible();
  const viewUrl = page.url();

  // A second view, then reorder from the sidebar and reload.
  await page.getByRole("link", { name: "Open full Inbox" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  await openFilters(page);
  await page
    .getByRole("form", { name: "Save as view" })
    .getByLabel("Save as view")
    .fill("Everything");
  await page
    .getByRole("form", { name: "Save as view" })
    .getByRole("button", { name: "Save view" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Everything" }),
  ).toBeVisible();

  const views = page.getByRole("list", { name: "Saved views" });
  await expect(views.getByRole("link")).toHaveText(["Urgent inbox", "Everything"]);
  await page.getByRole("button", { name: "Move Everything up" }).click();
  await expect(views.getByRole("link")).toHaveText(["Everything", "Urgent inbox"]);
  await page.reload();
  await expect(views.getByRole("link")).toHaveText(["Everything", "Urgent inbox"]);
  await page.screenshot({
    path: "test-results/saved-views-sidebar.png",
    fullPage: true,
  });

  // Open from the sidebar, adjust a filter, update the view, rename it, and delete it.
  await views.getByRole("link", { name: "Urgent inbox" }).click();
  await expect(page).toHaveURL(viewUrl);
  await expect(
    page.getByRole("list", { name: "Urgent inbox tasks" }).getByRole("listitem"),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  await openFilters(page);
  await filters.getByLabel("Priority").selectOption("any");
  await expect(
    page.getByRole("list", { name: "Urgent inbox tasks" }).getByRole("listitem"),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Update filters" }).click();
  await expect(page).toHaveURL(viewUrl);
  await expect(page.getByText("As saved")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Urgent inbox tasks" }).getByRole("listitem"),
  ).toHaveCount(2);

  const manage = page.getByRole("form", { name: "Manage view Urgent inbox" });
  await manage.getByLabel("View name").fill("Whole inbox");
  await manage.getByRole("button", { name: "Rename" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Whole inbox" }),
  ).toBeVisible();
  await expect(views.getByRole("link")).toHaveText(["Everything", "Whole inbox"]);

  await page.getByRole("button", { name: "Delete view Whole inbox" }).click();
  await page.getByRole("button", { name: "Confirm deleting view Whole inbox" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  await expect(views.getByRole("link")).toHaveText(["Everything"]);
});

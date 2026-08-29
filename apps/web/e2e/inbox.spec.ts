import { expect, test, type Page } from "@playwright/test";

/**
 * The capture-to-completion journey (US-001, US-006). This is the path that must never
 * break: if a user cannot capture a thought and later tick it off, nothing else matters.
 */

function uniqueEmail() {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page) {
  const email = uniqueEmail();
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("E2E Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Inbox", exact: true }),
  ).toBeVisible();
  return email;
}

async function capture(page: Page, title: string) {
  const field = page.getByPlaceholder("Add a task and press Enter");
  await field.fill(title);
  await field.press("Enter");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
}

test("a new account lands in an empty Inbox", async ({ page }) => {
  await signUp(page);

  await expect(
    page.getByRole("heading", { name: "Your Inbox is clear" }),
  ).toBeVisible();
});

test("captures a task, completes it, and reopens it", async ({ page }) => {
  await signUp(page);

  const field = page.getByPlaceholder("Add a task and press Enter");
  await field.fill("Prepare research presentation");
  await field.press("Enter");

  const list = page.getByRole("list", { name: "Inbox tasks" });
  await expect(list.getByText("Prepare research presentation")).toBeVisible();
  // The first task in a fresh workspace is number 1, not 2.
  await expect(list.getByText(/-1$/)).toBeVisible();

  // Capture keeps focus so several thoughts can be recorded in a row (spec 10.1).
  await expect(field).toBeFocused();
  await field.fill("Review the quarterly budget");
  await field.press("Enter");
  await expect(list.getByRole("listitem")).toHaveCount(2);

  await page
    .getByRole("button", { name: "Complete Prepare research presentation" })
    .click();

  await expect(list.getByRole("listitem")).toHaveCount(1);

  await page.getByRole("link", { name: "Completed" }).click();
  const completed = page.getByRole("list", { name: "Completed tasks" });
  await expect(completed.getByText("Prepare research presentation")).toBeVisible();

  await completed
    .getByRole("button", { name: "Reopen Prepare research presentation" })
    .click();
  await expect(completed.getByRole("listitem")).toHaveCount(0);

  await page.getByRole("link", { name: "Inbox" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
});

test("a captured task survives a reload", async ({ page }) => {
  await signUp(page);
  await capture(page, "Persisted across a reload");

  await page.reload();

  await expect(page.getByText("Persisted across a reload")).toBeVisible();
});

test("edits priority, due date, and description, and they survive a reload", async ({
  page,
}) => {
  await signUp(page);
  await capture(page, "Write the summary");

  await page.getByRole("link", { name: "Write the summary" }).click();
  const panel = page.getByRole("complementary");
  await expect(panel).toBeVisible();

  await panel.getByLabel("Priority").selectOption("urgent");
  await panel.getByLabel("Due date").fill("2026-09-15");
  await panel
    .getByLabel("Markdown")
    .fill("## Notes\n- **one** thing\n- <b>literal</b> html");
  await panel.getByLabel("Markdown").blur();
  await expect(panel.getByText("Saved")).toBeVisible();

  // The preview renders Markdown and shows HTML as text, never as markup (spec 8.1).
  const preview = panel.getByRole("list").last();
  await expect(panel.getByRole("heading", { name: "Notes" })).toBeVisible();
  await expect(preview.getByText("<b>literal</b> html")).toBeVisible();
  await expect(preview.locator("b")).toHaveCount(0);

  await page.reload();
  await expect(panel.getByLabel("Priority")).toHaveValue("urgent");
  await expect(panel.getByLabel("Due date")).toHaveValue("2026-09-15");
  await expect(panel.getByLabel("Markdown")).toHaveValue(/\*\*one\*\* thing/);
});

test("a concurrent edit is reported as a conflict instead of overwriting", async ({
  page,
}) => {
  await signUp(page);
  await capture(page, "Contended task");
  await page.getByRole("link", { name: "Contended task" }).click();

  const panel = page.getByRole("complementary");
  await expect(panel.getByLabel("Title")).toHaveValue("Contended task");

  // Change the task behind the open panel, exactly as another device would.
  await page.evaluate(async () => {
    const list = await (
      await fetch("/api/v1/tasks?inbox=true", { credentials: "include" })
    ).json();
    const task = list.data[0];
    await fetch(`/api/v1/tasks/${task.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Changed elsewhere",
        expectedVersion: task.version,
      }),
    });
  });

  await panel.getByLabel("Title").fill("My local edit");
  await panel.getByLabel("Title").blur();

  await expect(panel.getByText("This task changed somewhere else")).toBeVisible();
  // The draft is preserved rather than discarded (spec 10.2).
  await expect(panel.getByLabel("Title")).toHaveValue("My local edit");
});

test("deleting moves a task to Trash and restoring returns it to the Inbox", async ({
  page,
}) => {
  await signUp(page);
  await capture(page, "Deleted by mistake");

  await page.getByRole("button", { name: "Edit Deleted by mistake" }).click();
  await page.getByRole("button", { name: "Delete Deleted by mistake" }).click();
  await expect(
    page.getByRole("heading", { name: "Your Inbox is clear" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Trash" }).click();
  const trash = page.getByRole("list", { name: "Trash tasks" });
  await expect(trash.getByText("Deleted by mistake")).toBeVisible();

  await trash.getByRole("button", { name: "Restore Deleted by mistake" }).click();
  await expect(page.getByRole("heading", { name: "The Trash is empty" })).toBeVisible();

  await page.getByRole("link", { name: "Inbox" }).click();
  await expect(page.getByText("Deleted by mistake")).toBeVisible();
});

test("a filtered view can be copied from the URL and reopened", async ({ page }) => {
  await signUp(page);
  await capture(page, "Urgent thing");
  await capture(page, "Ordinary thing");

  await page.getByRole("button", { name: "Edit Urgent thing" }).click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Urgent thing" })
    .getByLabel("Priority")
    .selectOption("urgent");

  const filters = page.getByRole("region", { name: "Filter and sort" });
  await filters.getByLabel("Priority").selectOption("urgent");
  await expect(page).toHaveURL(/priority=urgent/);

  const url = page.url();
  await page.goto("/inbox");
  await page.goto(url);

  const list = page.getByRole("list", { name: "Inbox tasks" });
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByText("Urgent thing")).toBeVisible();
});

test("the task detail route renders on its own", async ({ page }) => {
  await signUp(page);
  await capture(page, "Reachable by link");

  await page.getByRole("link", { name: "Reachable by link" }).click();
  await page.getByRole("link", { name: "Open this task on its own page" }).click();

  await expect(page).toHaveURL(/\/tasks\/[A-Z]+-1$/);
  await expect(page.getByLabel("Title")).toHaveValue("Reachable by link");
});

test("an unauthenticated visitor is redirected to sign in", async ({ page }) => {
  await page.goto("/inbox");

  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("the quick add field is reachable by keyboard shortcut", async ({ page }) => {
  await signUp(page);

  await page.getByRole("heading", { level: 1, name: "Inbox", exact: true }).click();
  await page.keyboard.press("n");

  await expect(page.getByPlaceholder("Add a task and press Enter")).toBeFocused();
});

test("quick add can capture a priority and a due date in one go", async ({ page }) => {
  await signUp(page);

  const quickAdd = page.getByRole("form", { name: "Quick add" });
  await quickAdd.getByRole("button", { name: "Details" }).click();
  await quickAdd.getByLabel("Priority").selectOption("high");
  await quickAdd.getByLabel("Due date").fill("2026-10-01");
  const field = page.getByPlaceholder("Add a task and press Enter");
  await field.fill("Scheduled on capture");
  await field.press("Enter");

  const row = page.getByRole("listitem").filter({ hasText: "Scheduled on capture" });
  await expect(row.getByText("High")).toBeVisible();
  await expect(row.getByText(/2026-10-01/)).toBeVisible();
});

test("sign-up rejects a short password before submitting", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Short Password");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
  await expect(page).toHaveURL(/\/sign-up$/);
});

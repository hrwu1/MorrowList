import { expect, test, type Page } from "@playwright/test";

/**
 * Keyboard shortcuts, the command palette and the cheat sheet end to end (GAP-10,
 * spec 14): capture with `c`, complete the focused row with `e`, navigate with `g t`,
 * run a command from `Ctrl+K`, and — the part that matters most — prove that none of it
 * fires while somebody is typing or while a dialog is open.
 */

const PASSWORD = "correct-horse-battery-staple";

// The journeys cross several routes that a cold dev server compiles on first use.
test.describe.configure({ timeout: 90_000 });

async function signUp(page: Page) {
  const email = `keys-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Keyboard Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Inbox", exact: true }),
  ).toBeVisible({ timeout: 20_000 });
}

async function capture(page: Page, title: string) {
  const field = page.getByPlaceholder("Add a task and press Enter");
  await field.fill(title);
  await field.press("Enter");
  await expect(
    page.getByRole("list", { name: "Inbox tasks" }).getByRole("link", { name: title }),
  ).toBeVisible();
}

/** Move focus onto a row's title link, which is where the board's roving focus lands too. */
async function focusRow(page: Page, title: string) {
  await page.getByRole("link", { name: title, exact: true }).first().focus();
}

/** The open tasks in the Inbox list; a completed one leaves it. */
function openRow(page: Page, title: string) {
  return page.getByRole("list", { name: "Inbox tasks" }).getByRole("link", {
    name: title,
    exact: true,
  });
}

test("single keys capture, complete and navigate", async ({ page }) => {
  await signUp(page);
  await capture(page, "Water the plants");

  // `c` opens capture. On the Inbox page a quick add is already on screen, so the key
  // only moves focus into it; nothing about the capture form itself changes.
  await page.getByRole("heading", { level: 1, name: "Inbox", exact: true }).click();
  await page.keyboard.press("c");
  await expect(page.getByPlaceholder("Add a task and press Enter")).toBeFocused();
  await page.getByRole("heading", { level: 1, name: "Inbox", exact: true }).click();

  // `e` completes whichever task has focus, and says so out loud.
  await focusRow(page, "Water the plants");
  await page.keyboard.press("e");
  await expect(
    page.getByRole("status", { name: "Keyboard shortcut result" }),
  ).toContainText("Completed Water the plants.");
  // The Inbox shows open tasks, so a completed one leaves it.
  await expect(openRow(page, "Water the plants")).toHaveCount(0);

  // `g t` is a sequence, and its second key is also a task shortcut; the sequence wins.
  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();

  await page.keyboard.press("g");
  await page.keyboard.press("u");
  await expect(page.getByRole("heading", { level: 1, name: "Upcoming" })).toBeVisible();

  await page.keyboard.press("g");
  await page.keyboard.press("i");
  await expect(
    page.getByRole("heading", { level: 1, name: "Inbox", exact: true }),
  ).toBeVisible();
});

test("a shortcut never fires inside a field or over a dialog", async ({ page }) => {
  await signUp(page);
  await capture(page, "Draft the report");

  // Typing the shortcut letters into the capture field must produce a task, not actions.
  const field = page.getByPlaceholder("Add a task and press Enter");
  await field.click();
  await field.pressSequentially("edit gtc notes");
  await expect(field).toHaveValue("edit gtc notes");
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  await field.press("Enter");
  await expect(
    page.getByRole("list", { name: "Inbox tasks" }).getByRole("link", {
      name: "edit gtc notes",
    }),
  ).toBeVisible();

  // With the search dialog open, `e` types into the search box rather than completing.
  await page.getByRole("heading", { level: 1, name: "Inbox", exact: true }).click();
  await page.keyboard.press("/");
  const search = page.getByRole("combobox", { name: "Search tasks and projects" });
  await expect(search).toBeFocused();
  await search.press("e");
  await expect(search).toHaveValue("e");
  await page.keyboard.press("Escape");

  // And the task is still open: nothing completed it behind the dialog.
  await expect(
    page.getByRole("button", { name: "Complete Draft the report" }),
  ).toBeVisible();
});

test("the palette runs a command on the task the user was standing on", async ({
  page,
}) => {
  await signUp(page);
  await capture(page, "Book the venue");
  await focusRow(page, "Book the venue");

  // Words that match no command search the workspace instead, through the same results
  // the search dialog shows.
  await page.keyboard.press("ControlOrMeta+k");
  const palette = page.getByRole("combobox", { name: "Run a command or search" });
  await expect(palette).toBeFocused();
  await palette.fill("venue");
  await expect(
    page.getByRole("listbox", { name: "Search results" }).getByRole("option").first(),
  ).toContainText("Book the venue");
  await palette.press("Escape");
  await expect(page.getByRole("link", { name: "Book the venue" })).toBeFocused();

  // And a command runs against the row the palette was opened from, even though opening
  // the palette took focus away from it.
  await page.keyboard.press("ControlOrMeta+k");
  const reopened = page.getByRole("combobox", { name: "Run a command or search" });
  await reopened.fill("complete");
  await expect(
    page
      .getByRole("listbox", { name: "Commands" })
      .getByRole("option", { name: /Complete or reopen the focused task/ }),
  ).toBeVisible();
  await reopened.press("Enter");

  await expect(
    page.getByRole("status", { name: "Keyboard shortcut result" }),
  ).toContainText("Completed Book the venue.");
  await expect(openRow(page, "Book the venue")).toHaveCount(0);
});

test("the cheat sheet lists the registry and can switch single keys off", async ({
  page,
}) => {
  await signUp(page);
  await capture(page, "Renew the licence");

  await page.getByRole("heading", { level: 1, name: "Inbox", exact: true }).click();
  await page.keyboard.press("?");
  const sheet = page.getByRole("dialog");
  await expect(
    sheet.getByRole("heading", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  await expect(sheet.getByText("Go to Today")).toBeVisible();
  await expect(sheet.getByText("Complete or reopen the focused task")).toBeVisible();
  await expect(sheet.getByText("Capture a new task")).toBeVisible();

  await sheet.getByLabel(/Single-key shortcuts/).uncheck();
  await sheet.getByRole("button", { name: "Close keyboard shortcuts" }).click();

  // With single keys off, `e` on a focused row does nothing at all.
  await focusRow(page, "Renew the licence");
  await page.keyboard.press("e");
  await expect(
    page.getByRole("button", { name: "Complete Renew the licence" }),
  ).toBeVisible();
  await expect(openRow(page, "Renew the licence")).toHaveCount(1);

  // The two ways back are still live, and the setting survives a reload.
  await page.reload();
  await page.getByRole("heading", { level: 1, name: "Inbox", exact: true }).click();
  await page.keyboard.press("?");
  const afterReload = page.getByRole("dialog");
  await expect(afterReload.getByLabel(/Single-key shortcuts/)).not.toBeChecked();
  await afterReload.getByLabel(/Single-key shortcuts/).check();
  await afterReload.getByRole("button", { name: "Close keyboard shortcuts" }).click();

  await focusRow(page, "Renew the licence");
  await page.keyboard.press("e");
  await expect(openRow(page, "Renew the licence")).toHaveCount(0);
});

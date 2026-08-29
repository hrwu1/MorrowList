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
  const completed = page.getByRole("list", { name: "Completed tasks" });
  await expect(completed.getByText("Prepare research presentation")).toBeVisible();

  await completed.getByRole("button", { name: "Reopen" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
});

test("a captured task survives a reload", async ({ page }) => {
  await signUp(page);

  const field = page.getByPlaceholder("Add a task and press Enter");
  await field.fill("Persisted across a reload");
  await field.press("Enter");
  await expect(page.getByText("Persisted across a reload")).toBeVisible();

  await page.reload();

  await expect(page.getByText("Persisted across a reload")).toBeVisible();
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

test("sign-up rejects a short password before submitting", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Short Password");
  await page.getByLabel("Email").fill(uniqueEmail());
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Use at least 12 characters.")).toBeVisible();
  await expect(page).toHaveURL(/\/sign-up$/);
});

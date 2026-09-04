import { expect, test, type Page } from "@playwright/test";

/**
 * Reminders end to end (GAP-13): a task due in a minute gets a reminder at its due time,
 * the worker embedded in the server delivers it, the bell and the inbox show it, and the
 * preferences page persists a change. Real clock: the server's worker polls every two
 * seconds in this suite (playwright.config.ts), so the wait is bounded by the minute.
 */

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page) {
  const email = `remind-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Reminder Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
}

/** New accounts get a UTC workspace, so the due date and time are given in UTC. */
function utcDateAndTime(instant: Date): { date: string; time: string } {
  const iso = instant.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

test.setTimeout(240_000);

test("a task due in a minute reminds at its due time, and settings persist", async ({
  page,
}) => {
  await signUp(page);

  const capture = page.getByPlaceholder("Add a task and press Enter");
  await capture.fill("Call the bank");
  await capture.press("Enter");
  await page.getByRole("link", { name: "Call the bank" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });

  // Due 60–120 seconds from now, on the minute; "At the due time" fires at that minute.
  const due = utcDateAndTime(new Date(Date.now() + 120_000));
  await panel.getByLabel("Due date").fill(due.date);
  await panel.getByLabel("Due time").fill(due.time);
  const reminder = panel.getByLabel("Reminder");
  await expect(reminder).toBeVisible();
  // The default arrives with the save; then it is changed to fire at the due time.
  await expect(reminder).toHaveValue("30");
  await reminder.selectOption("0");
  await expect(panel.getByText("Saved")).toBeVisible();
  await page.screenshot({ path: "test-results/reminders-detail.png", fullPage: true });

  // The bell fills in when the worker delivers; the page is reloaded so the wait does
  // not depend on the client's poll interval.
  const bell = page.getByRole("link", { name: "Notifications", exact: true });
  await expect(async () => {
    await page.reload();
    await expect(bell).toContainText("1", { timeout: 5_000 });
  }).toPass({ timeout: 150_000, intervals: [3_000] });

  await bell.click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Notifications" }),
  ).toBeVisible();
  const list = page.getByRole("list", { name: "Notifications" });
  const row = list.getByRole("listitem").filter({ hasText: "Reminder: Call the bank" });
  await expect(row).toContainText(`is due ${due.date} at ${due.time} (UTC)`);
  await expect(row.getByLabel("Unread")).toBeVisible();
  await page.screenshot({ path: "test-results/reminders-inbox.png", fullPage: true });

  await row.getByRole("button", { name: "Mark Reminder: Call the bank read" }).click();
  await expect(row.getByLabel("Unread")).toHaveCount(0);
  await expect(bell).not.toContainText("1");

  // The task's history records the delivery as the system.
  await row.getByRole("link", { name: "Reminder: Call the bank" }).click();
  await expect(page.getByLabel("Title")).toHaveValue("Call the bank");
  await expect(page.getByText("Sent reminder for")).toBeVisible();

  // Preferences live behind the inbox, not in the sidebar, which stays short enough for
  // a laptop viewport: turn email on and set a digest time; both survive a reload.
  await page.getByRole("link", { name: "Notifications", exact: true }).first().click();
  await page.getByRole("link", { name: "Change what you receive" }).click();
  const form = page.getByRole("form", { name: "Notification settings" });
  await form.getByLabel("Email").check();
  await form.getByLabel("Send a summary of Today each morning").check();
  await form.getByLabel("Digest time").fill("07:30");
  await form.getByLabel("Default reminder for new timed tasks").selectOption("60");
  await form.getByRole("button", { name: "Save settings" }).click();
  await expect(form.getByText("Saved")).toBeVisible();
  await page.reload();
  await expect(form.getByLabel("Email")).toBeChecked();
  await expect(form.getByLabel("Digest time")).toHaveValue("07:30");
  await expect(form.getByLabel("Default reminder for new timed tasks")).toHaveValue(
    "60",
  );
  await page.screenshot({
    path: "test-results/reminders-settings.png",
    fullPage: true,
  });
});

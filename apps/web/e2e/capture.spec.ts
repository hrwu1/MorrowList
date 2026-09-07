import { expect, test, type Page } from "@playwright/test";

import { openSection } from "./disclosures";

/**
 * Natural-language quick add end to end (GAP-15, ADR pending-natural-language-capture):
 * type one line, see chips saying what was read, create the tag it named, take a chip
 * back off, submit, and find the fields on the task itself. Then the two escape hatches:
 * a backslash for one word, and the settings toggle for all of it.
 */

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page) {
  const email = `capture-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Capture Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
}

/** The workspace's calendar date, as the server evaluates it (spec 12.3). */
async function workspaceToday(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const view = await (
      await fetch("/api/v1/views/today", { credentials: "include" })
    ).json();
    return view.data.date as string;
  });
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

test("quick add reads a typed line, shows what it read, and builds the task from it", async ({
  page,
}) => {
  await signUp(page);
  const tomorrow = addDays(await workspaceToday(page), 1);

  // A project for `#Launch` to resolve to.
  await openSection(page, "Settings");
  await page.getByRole("link", { name: "Manage projects" }).click();
  await page.getByLabel("Project name").fill("Launch");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Launch" })).toBeVisible();

  await page.getByRole("link", { name: "Open full Inbox" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();

  const quickAdd = page.getByRole("form", { name: "Quick add" });
  const field = page.getByPlaceholder("Add a task and press Enter");
  await field.fill("Call Sam tomorrow 5pm p1 #Launch @phone");

  // Every match is a chip that says what it resolved to; nothing is silent.
  const chips = quickAdd.getByRole("list", { name: "Read from what you typed" });
  await expect(chips).toContainText(`Planned ${tomorrow} at 17:00`);
  await expect(chips).toContainText("Urgent");
  await expect(chips).toContainText("Project Launch");
  // The tag does not exist yet, so it is offered rather than applied.
  await expect(chips).toContainText('No tag "phone"');
  await chips.getByRole("button", { name: "Create" }).click();
  await expect(chips).toContainText("Tag phone");

  await expect(quickAdd.getByText(`Call Sam · Planned ${tomorrow}`)).toBeVisible();
  await page.screenshot({ path: "test-results/capture-chips.png", fullPage: true });

  // A chip takes its own words back out of the field.
  await chips.getByRole("button", { name: "Remove Urgent" }).click();
  await expect(field).toHaveValue("Call Sam tomorrow 5pm #Launch @phone");
  await expect(chips).not.toContainText("Urgent");
  await field.fill("Call Sam tomorrow 5pm p1 #Launch @phone");
  await expect(chips).toContainText("Urgent");

  await field.press("Enter");
  await expect(field).toHaveValue("");

  // The task went to Launch with every field the line named.
  await page.getByRole("link", { name: "Launch", exact: true }).first().click();
  await page.getByRole("link", { name: "Call Sam" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await expect(panel.getByLabel("Title")).toHaveValue("Call Sam");
  await expect(panel.getByLabel("Priority")).toHaveValue("urgent");
  await expect(panel.getByLabel("Planned", { exact: true })).toHaveValue(tomorrow);
  await expect(panel.getByLabel("Planned time")).toHaveValue("17:00");
  await expect(panel.getByRole("list", { name: "Tags" })).toContainText("phone");
});

test("a backslash keeps one word, and the settings toggle turns reading off", async ({
  page,
}) => {
  await signUp(page);

  const quickAdd = page.getByRole("form", { name: "Quick add" });
  const field = page.getByPlaceholder("Add a task and press Enter");

  // The escape: the date word stays, and nothing is read from the line.
  await field.fill("Ship \\tomorrow the release");
  await expect(
    quickAdd.getByRole("list", { name: "Read from what you typed" }),
  ).toHaveCount(0);
  await field.press("Enter");
  await expect(
    page.getByRole("link", { name: "Ship tomorrow the release" }),
  ).toBeVisible();

  // The toggle: this device stops reading anything out of the line.
  await openSection(page, "Settings");
  await page.getByRole("link", { name: "Workspace settings", exact: true }).click();
  const toggle = page.getByLabel(
    "Read dates, priority, projects and tags out of what I type",
  );
  await expect(toggle).toBeChecked();
  await toggle.uncheck();

  await page.getByRole("link", { name: "Open full Inbox" }).first().click();
  await field.fill("Standup tomorrow p1");
  await expect(
    quickAdd.getByRole("list", { name: "Read from what you typed" }),
  ).toHaveCount(0);
  await field.press("Enter");
  await expect(page.getByRole("link", { name: "Standup tomorrow p1" })).toBeVisible();
});

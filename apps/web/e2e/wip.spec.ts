import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page) {
  const email = `wip-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("WIP Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
}

async function createProject(page: Page, name: string) {
  await page.getByRole("link", { name: "Manage projects" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

async function startTask(page: Page, title: string) {
  await page.getByRole("button", { name: "+ Add to Ready" }).click();
  const capture = page.getByPlaceholder("Add to Ready and press Enter");
  await capture.fill(title);
  await capture.press("Enter");
  await expect(
    page.getByRole("region", { name: "Ready" }).getByRole("link", { name: title }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByLabel(`Move ${title}`).selectOption({ label: "In Progress" });
  await expect(
    page
      .getByRole("region", { name: "In Progress" })
      .getByRole("link", { name: title }),
  ).toBeVisible();
}

function counter(page: Page) {
  return page.getByRole("navigation", { name: "Primary" }).locator(".workspace-wip");
}

test("warns across projects when the in-progress limit is exceeded, never blocking", async ({
  page,
}) => {
  await signUp(page);

  // The limit belongs to the workspace, so it lives in the workspace settings.
  await page.getByRole("link", { name: "Workspace settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Workspace" }),
  ).toBeVisible();
  const form = page.getByRole("form", { name: "In-progress limit" });
  await form.getByLabel("In-progress limit").fill("1");
  await form.getByRole("button", { name: "Save limit" }).click();
  await expect(form.getByRole("status")).toHaveText("Saved");
  await expect(counter(page)).toHaveText("0 of 1 in progress");

  // One started task fills the limit; the counter changes tone but nothing warns.
  await createProject(page, "Alpha");
  await startTask(page, "Alpha work");
  await expect(counter(page)).toHaveText("1 of 1 in progress");
  await expect(counter(page)).toHaveAttribute("data-tone", "at");
  await expect(page.locator(".ml-alert--warning")).toHaveCount(0);

  // Starting work in another project crosses the workspace limit: the move succeeds
  // and the warning names every task in progress, across both projects.
  await createProject(page, "Beta");
  await startTask(page, "Beta work");
  const warning = page.locator(".ml-alert--warning");
  await expect(warning).toContainText("Over your in-progress limit");
  await expect(warning).toContainText(
    "2 tasks are in progress across your projects; the limit is 1.",
  );
  const started = warning.getByRole("list", { name: "Tasks in progress" });
  await expect(started.getByRole("listitem")).toHaveText([/Alpha work/, /Beta work/]);
  await expect(counter(page)).toHaveText("2 of 1 in progress");
  await expect(counter(page)).toHaveAttribute("data-tone", "over");
  await page.screenshot({ path: "test-results/wip-warning.png", fullPage: true });

  // One click puts the other project's task back to Ready and the counter follows.
  await warning.getByRole("button", { name: "Move Alpha work to Ready" }).click();
  await expect(started.getByRole("listitem")).toHaveText([/Beta work/]);
  await expect(counter(page)).toHaveText("1 of 1 in progress");
  await warning.getByRole("button", { name: "Dismiss" }).click();
  await expect(warning).toHaveCount(0);

  // The count survives a reload because it is served, not remembered.
  await page.reload();
  await expect(counter(page)).toHaveText("1 of 1 in progress");
});

test("writes a column policy from the header menu and reads it back", async ({
  page,
}) => {
  await signUp(page);
  await createProject(page, "Policies");

  const ready = page.getByRole("region", { name: "Ready" });
  await expect(
    ready.getByRole("button", { name: "Show policy for Ready" }),
  ).toHaveCount(0);

  await page.getByLabel("Options for Ready").click();
  const policyForm = page.getByRole("form", { name: "Edit policy for Ready" });
  await policyForm
    .getByLabel("Policy")
    .fill("**Small** and reviewed.\n\n- Estimate agreed\n- Owner named");
  await policyForm.getByRole("button", { name: "Save policy" }).click();

  const toggle = ready.getByRole("button", { name: "Show policy for Ready" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  const policy = ready.locator(".kanban-column__policy");
  await expect(policy).toContainText("Small and reviewed.");
  await expect(policy.locator("strong")).toHaveText("Small");
  await expect(policy.getByRole("listitem")).toHaveText([
    "Estimate agreed",
    "Owner named",
  ]);
  await page.screenshot({ path: "test-results/wip-policy.png", fullPage: true });

  // The policy is part of the column, so it is there after a reload and in settings.
  await page.reload();
  await expect(
    ready.getByRole("button", { name: "Show policy for Ready" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Project settings" }).click();
  await expect(
    page.getByRole("listitem", { name: "Ready" }).getByLabel("Policy"),
  ).toHaveValue("**Small** and reviewed.\n\n- Estimate agreed\n- Owner named");
});

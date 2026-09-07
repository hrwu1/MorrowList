import { expect, test, type Page } from "@playwright/test";

import { openProjectBoard, openSection } from "./disclosures";

/**
 * Dependencies as relations with a reason (GAP-06, spec 8.4): a blocks relation added
 * from the detail shows on the target's card and clears when the source completes; a
 * task flagged with a reason stays in its stage, shows why, and warns before completion.
 */

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page) {
  const email = `relations-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Relation Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
}

async function createProject(page: Page) {
  await openSection(page, "Settings");
  await page.getByRole("link", { name: "Manage projects" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await page.getByLabel("Project name").fill("Research Launch");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Research Launch" }),
  ).toBeVisible();
}

async function addReadyTask(page: Page, title: string) {
  const capture = page.getByPlaceholder("Add to Ready and press Enter");
  // The quick-add stays open after a capture, so only open it when it is closed.
  if (!(await capture.isVisible())) {
    await openProjectBoard(page);
    await page.getByRole("button", { name: "+ Add a task" }).click();
  }
  await capture.fill(title);
  await capture.press("Enter");
  await expect(
    page.getByRole("region", { name: "Ready" }).getByRole("link", { name: title }),
  ).toBeVisible();
}

test("a blocks relation marks the target until the source completes", async ({
  page,
}) => {
  await signUp(page);
  await createProject(page);
  await openProjectBoard(page);
  await addReadyTask(page, "Collect sources");
  await addReadyTask(page, "Make slides");

  const ready = page.getByRole("region", { name: "Ready" });
  const sources = ready.getByRole("listitem").filter({ hasText: "Collect sources" });
  const slides = ready.getByRole("listitem").filter({ hasText: "Make slides" });
  // Keys carry the workspace prefix, derived from the user's name at sign-up.
  const sourcesKey = await sources.locator(".task-row__key").innerText();
  const slidesKey = await slides.locator(".task-row__key").innerText();
  await slides.getByRole("link", { name: "Make slides" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });

  await openSection(panel, "Relationships");

  // "Blocked by" is the default kind; the other task is named by key.
  await expect(panel.getByLabel("Relation type")).toHaveValue("blocked_by");
  const key = panel.getByLabel("Related task key");
  await key.fill(sourcesKey);
  await key.press("Enter");
  await expect(
    panel.getByRole("list", { name: "Blocked by" }).getByRole("link", {
      name: "Collect sources",
    }),
  ).toBeVisible();
  await expect(key).toHaveValue("");

  // The target's card carries the indicator with the reason in its name.
  await expect(
    slides.getByLabel(`Blocked: Waiting on ${sourcesKey} Collect sources`),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/relations-blocked-card.png" });

  // A reverse relation would be a cycle and is refused with the server's message.
  await sources.getByRole("link", { name: "Collect sources" }).click();
  await expect(panel.getByLabel("Title", { exact: true })).toHaveValue(
    "Collect sources",
  );
  await openSection(panel, "Relationships");
  await expect(
    panel.getByRole("list", { name: "Blocks" }).getByRole("link", {
      name: "Make slides",
    }),
  ).toBeVisible();
  const sourceKey = panel.getByLabel("Related task key");
  await sourceKey.fill(slidesKey);
  await sourceKey.press("Enter");
  await expect(panel.getByRole("alert")).toContainText(/cycle/);

  // Completing the source frees the target.
  await panel.getByRole("button", { name: "Mark complete" }).click();
  await expect(panel.getByRole("button", { name: "Reopen task" })).toBeVisible();
  // The Move menu also lists a "Blocked" stage, so the badge is found by its name.
  await expect(slides.getByLabel(/^Blocked:/)).toHaveCount(0);
  await page.screenshot({ path: "test-results/relations-unblocked-card.png" });
});

test("a flagged task keeps its stage, shows the reason, and warns before completion", async ({
  page,
}) => {
  await signUp(page);
  await createProject(page);
  await openProjectBoard(page);
  await addReadyTask(page, "Book venue");

  const ready = page.getByRole("region", { name: "Ready" });
  const card = ready.getByRole("listitem").filter({ hasText: "Book venue" });
  await card.getByRole("link", { name: "Book venue" }).click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });

  await openSection(panel, "Relationships");
  await panel.getByRole("button", { name: "Mark blocked" }).click();
  const reason = panel.getByLabel("Why is this task blocked?");
  await reason.fill("waiting on vendor");
  await reason.press("Enter");
  await expect(panel.getByTestId("blocked-reason")).toContainText("waiting on vendor");

  // Still in Ready, with the reason on the card's indicator.
  await expect(card.getByLabel("Blocked: waiting on vendor")).toBeVisible();
  await expect(card.getByLabel("Blocked: waiting on vendor")).toHaveAttribute(
    "title",
    "waiting on vendor",
  );
  await page.screenshot({ path: "test-results/relations-flagged-card.png" });

  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Ready" })
      .getByRole("listitem")
      .filter({ hasText: "Book venue" })
      .getByLabel("Blocked: waiting on vendor"),
  ).toBeVisible();

  // Completing warns first and then goes through with the acknowledgement.
  await panel.getByRole("button", { name: "Mark complete" }).click();
  await expect(panel.getByText("This task is blocked")).toBeVisible();
  await panel.getByRole("button", { name: "Keep it open" }).click();
  await expect(panel.getByRole("button", { name: "Mark complete" })).toBeVisible();
  await panel.getByRole("button", { name: "Mark complete" }).click();
  await panel.getByRole("button", { name: "Complete anyway" }).click();
  await expect(panel.getByRole("button", { name: "Reopen task" })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Done" })
      .getByRole("link", { name: "Book venue" }),
  ).toBeVisible();

  // Clearing the flag from the detail, once the reopen has landed on the server.
  await panel.getByRole("button", { name: "Reopen task" }).click();
  await expect(
    page
      .getByRole("region", { name: "Ready" })
      .getByRole("link", { name: "Book venue" }),
  ).toBeVisible();
  await openSection(panel, "Relationships");
  await panel.getByRole("button", { name: "Clear blocked" }).click();
  await expect(panel.getByText("Not flagged.")).toBeVisible();
  await page.screenshot({ path: "test-results/relations-cleared.png" });
});

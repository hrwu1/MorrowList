import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Swimlanes and the board that spans projects (spec 9.5, GAP-19). The board is still a
 * view over the one task model: pivoting it changes nothing, and dragging across a lane
 * is the same command as changing the field on the card.
 */

// Five priority lanes stack taller than a laptop viewport, and a pointer drag can only
// reach what is on screen, so this suite gets a tall window.
test.use({ viewport: { width: 1440, height: 1600 } });

const PASSWORD = "correct-horse-battery-staple";

async function signUp(page: Page) {
  const email = `lanes-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Lane Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
}

/** dnd-kit activates after a few pointer moves, so a drag is a stepped mouse path. */
async function drag(source: Locator, target: Locator, page: Page) {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  expect(from).not.toBeNull();
  expect(to).not.toBeNull();
  if (!from || !to) return;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12);
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function createProject(page: Page, name: string): Promise<string> {
  await page.goto("/projects");
  await page.getByLabel("Project name").fill(name);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const url = new URL(page.url());
  return url.pathname.split("/")[2] as string;
}

test("a board pivots into priority lanes and a cross-lane drag re-prioritises", async ({
  page,
}) => {
  await signUp(page);
  const projectId = await createProject(page, "Lane Launch");

  await page.getByRole("button", { name: "+ Add to Ready" }).click();
  const capture = page.getByPlaceholder("Add to Ready and press Enter");
  await capture.fill("Rewrite the brief");
  await capture.press("Enter");
  await expect(page.getByRole("link", { name: "Rewrite the brief" })).toBeVisible();

  // Pivot the board; the card starts in the lane its own priority puts it in.
  await page.locator(".board-toolbar__view summary").click();
  await page.getByLabel("Swimlanes").selectOption("priority");
  await expect(page).toHaveURL(new RegExp(`swimlane=priority`));

  const urgentLane = page.getByRole("region", { name: "Urgent" });
  const noPriorityLane = page.getByRole("region", { name: "No priority" });
  await expect(noPriorityLane.getByRole("link", { name: "Rewrite the brief" })).toBeVisible();
  await expect(urgentLane).toBeVisible();

  const handle = noPriorityLane.getByRole("button", { name: /Drag Rewrite the brief/ });
  await drag(handle, urgentLane.getByRole("list", { name: /Urgent, Ready tasks/ }), page);

  await expect(
    urgentLane.getByRole("link", { name: "Rewrite the brief" }),
  ).toBeVisible();

  // The card really changed: the priority is on the task, not on the board.
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Urgent" })
      .getByRole("link", { name: "Rewrite the brief" }),
  ).toBeVisible();
  await page.goto(`/projects/${projectId}/board`);
  await expect(page.locator(".board-card__meta").getByText("Urgent")).toBeVisible();
});

test("Today opens as a board across projects and a card can be finished there", async ({
  page,
}) => {
  await signUp(page);
  await createProject(page, "Cross Project");

  await page.getByRole("button", { name: "+ Add to Ready" }).click();
  const capture = page.getByPlaceholder("Add to Ready and press Enter");
  await capture.fill("Finish on the board");
  await capture.press("Enter");
  await expect(page.getByRole("link", { name: "Finish on the board" })).toBeVisible();

  // Choose it for today from the card, then read Today as a board.
  await page.getByRole("button", { name: "Add Finish on the board to My Day" }).click();
  await page.goto("/today");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(page).toHaveURL(/layout=board/);

  const ready = page.getByRole("list", { name: "Ready tasks" });
  await expect(ready.getByRole("link", { name: "Finish on the board" })).toBeVisible();

  // The columns are the shared stages; a drop into Done resolves this card's own
  // project status and completes it (spec 11.5).
  await drag(
    page.getByRole("button", { name: /Drag Finish on the board/ }),
    page.getByRole("list", { name: "Done tasks" }),
    page,
  );

  // Completing it takes it out of Today, exactly as finishing it in the list does
  // (spec 9.2); the completion itself is canonical and shows up in History.
  await expect(page.getByText("Nothing on this board")).toBeVisible();
  await page.goto("/completed");
  await expect(page.getByRole("link", { name: "Finish on the board" })).toBeVisible();
});

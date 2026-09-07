import { devices, expect, test, type Page } from "@playwright/test";

/**
 * The representative mobile viewport (spec 7.3, 9.5, 28.2): every view fits the screen
 * without horizontal scrolling, the controls a thumb needs are large enough, the board
 * runs one lane at a time, and the task detail opens as a sheet rather than pushing the
 * list off screen.
 */

test.use({ ...devices["iPhone 13"], browserName: "chromium" });

const PASSWORD = "correct-horse-battery-staple";
const MIN_TARGET = 44;

async function signUp(page: Page) {
  const email = `mobile-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Mobile Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Inbox", exact: true }),
  ).toBeVisible();
}

async function capture(page: Page, title: string) {
  const field = page.getByPlaceholder("Add a task and press Enter");
  await field.fill(title);
  await field.press("Enter");
  await expect(page.getByRole("link", { name: title })).toBeVisible();
}

async function createProject(page: Page, name: string): Promise<string> {
  return page.evaluate(async (projectName) => {
    const response = await fetch("/api/v1/projects", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: projectName }),
    });
    const body = await response.json();
    return (body.data.project?.id ?? body.data.id) as string;
  }, name);
}

async function createSavedView(page: Page, name: string): Promise<string> {
  return page.evaluate(async (viewName) => {
    const response = await fetch("/api/v1/views/saved", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: viewName, filters: { inbox: true } }),
    });
    const body = await response.json();
    return body.data.id as string;
  }, name);
}

function overflowsHorizontally(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

test("every view fits the phone width and the main controls are thumb-sized", async ({
  page,
}) => {
  // This one walks every view in the app rather than a single screen, so it needs more
  // than the per-test budget the rest of the suite lives within.
  test.slow();
  await signUp(page);
  await capture(page, "Fits on a phone");
  const projectId = await createProject(page, "A project with a rather long name");
  const viewId = await createSavedView(page, "A saved view with a rather long name");

  const views = [
    "/today",
    "/upcoming",
    "/inbox",
    `/projects/${projectId}/board`,
    `/projects/${projectId}/board?canvas=board`,
    `/projects/${projectId}/settings`,
    `/projects/${projectId}/flow`,
    "/projects",
    "/settings/tags",
    "/settings/workspace",
    "/notifications",
    "/settings/notifications",
    "/search?q=phone",
    `/views/${viewId}`,
    "/completed",
    "/trash",
  ];
  for (const view of views) {
    await page.goto(view);
    await expect(page.locator("h1").first()).toBeVisible();
    expect(await overflowsHorizontally(page), `${view} scrolls horizontally`).toBe(
      false,
    );
  }

  await page.goto("/inbox");
  for (const control of [
    page.getByRole("button", { name: "Capture a new Inbox task" }).first(),
    page.locator('summary[aria-label="Open workspace navigation"]'),
    page.getByRole("button", { name: "Edit Fits on a phone" }),
    page.getByRole("button", { name: "Details" }),
  ]) {
    const box = await control.boundingBox();
    expect(box, "control is rendered").not.toBeNull();
    expect(box!.height, "target height").toBeGreaterThanOrEqual(MIN_TARGET);
    expect(box!.width, "target width").toBeGreaterThanOrEqual(MIN_TARGET);
  }

  // The search dialog's field and results are thumb-sized too.
  await page.locator("body").press("/");
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("combobox").fill("phone");
  const result = dialog.getByRole("link", { name: /Fits on a phone/ });
  await expect(result).toBeVisible();
  for (const control of [dialog.getByRole("combobox"), result]) {
    const box = (await control.boundingBox())!;
    expect(box.height, "search target height").toBeGreaterThanOrEqual(MIN_TARGET);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // The completion circle stays small on screen but answers to a thumb-sized area.
  const check = page.getByRole("button", { name: "Complete Fits on a phone" });
  const circle = (await check.boundingBox())!;
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("aria-label") ?? null,
    { x: circle.x - 10, y: circle.y + circle.height + 10 },
  );
  expect(hit).toBe("Complete Fits on a phone");
});

test("the board runs one lane at a time and the task detail opens as a sheet", async ({
  page,
}) => {
  await signUp(page);
  const projectId = await createProject(page, "Phone board");
  await page.goto(`/projects/${projectId}/board?canvas=board`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Phone board" }),
  ).toBeVisible();

  const lane = page.getByLabel("Board stage");
  await expect(lane).toBeVisible();
  const visibleColumns = page.locator(".kanban-column:visible");
  await expect(visibleColumns).toHaveCount(1);
  const firstLane = await visibleColumns.first().getAttribute("aria-labelledby");
  const otherLane = await lane.evaluate((select: HTMLSelectElement) => {
    const other = [...select.options].find((option) => option.value !== select.value);
    return other?.value ?? "";
  });
  await lane.selectOption(otherLane);
  await expect(visibleColumns).toHaveCount(1);
  expect(await visibleColumns.first().getAttribute("aria-labelledby")).not.toBe(
    firstLane,
  );
  expect(await overflowsHorizontally(page)).toBe(false);

  await page.goto("/inbox?sort=created");
  await capture(page, "Open me on a phone");
  const listTop = (await page.getByRole("list", { name: "Inbox tasks" }).boundingBox())!
    .y;
  // The sheet is client state backed by the task API. Opening it must not depend on
  // another server-rendered Inbox response, even if that request cannot complete.
  let renderRequests = 0;
  await page.route("**/inbox?**", async (route) => {
    if (route.request().headers()["rsc"] === "1") {
      renderRequests++;
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole("link", { name: "Open me on a phone" }).click();

  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("Title")).toHaveValue("Open me on a phone");
  await expect(page).toHaveURL(/\/inbox\?sort=created&task=MOBI-1$/);
  await page.goBack();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open me on a phone" })).toBeFocused();
  await expect(page).toHaveURL(/\/inbox\?sort=created$/);
  await page.goForward();
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/\/inbox\?sort=created&task=MOBI-1$/);
  const box = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  // A sheet: anchored to the bottom edge, full width, and the list still starts where it did.
  expect(Math.round(box.y + box.height)).toBe(viewport.height);
  expect(Math.round(box.width)).toBe(viewport.width);
  expect((await page.getByRole("list", { name: "Inbox tasks" }).boundingBox())!.y).toBe(
    listTop,
  );

  await panel.getByRole("button", { name: "Close task details" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open me on a phone" })).toBeFocused();
  await expect(page).toHaveURL(/\/inbox\?sort=created$/);
  expect(renderRequests).toBe(0);
});

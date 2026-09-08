import { openSection } from "./disclosures";
import { expect, test } from "./fixtures";

test("incoming tasks and background edits appear without reloading the workspace", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Background Sync Tester");
  await page.getByLabel("Email").fill(`background-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Create account" }).click();
  const heading = page.getByRole("heading", { name: "Inbox", exact: true });
  await expect(heading).toBeVisible();
  await heading.click();

  // A provider/worker writes through the same API, outside the browser's query cache.
  const response = await page.request.post("/api/v1/tasks", {
    data: { title: "Task received while the Inbox stays open" },
  });
  expect(response.ok()).toBeTruthy();
  const { data: task } = await response.json();
  const title = page.getByRole("link", { name: task.title, exact: true });
  await expect(title).toBeVisible({ timeout: 15_000 });
  await title.click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  await openSection(panel, "Scheduling & priority");
  await expect(panel.getByLabel("Priority")).toHaveValue("none");
  const update = await page.request.patch(`/api/v1/tasks/${task.id}`, {
    data: { priority: "urgent", expectedVersion: task.version },
  });
  expect(update.ok()).toBeTruthy();
  await expect(panel.getByLabel("Priority")).toHaveValue("urgent", { timeout: 15_000 });
});

test("quick capture flows through a rule into the calendar and a revocable feed", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Roadmap Journey Tester");
  await page.getByLabel("Email").fill(`roadmap-journey-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Inbox", exact: true })).toBeVisible();

  const ruleResponse = await page.request.post("/api/v1/rules", {
    data: {
      name: "Prioritize captures",
      trigger: { type: "task.created" },
      actions: [{ type: "set_priority", priority: "urgent" }],
    },
  });
  expect(ruleResponse.status()).toBe(201);
  const { data: rule } = await ruleResponse.json();
  await page.goto("/capture?text=Unified%20release%20review%20tomorrow");
  await page.getByRole("button", { name: "Add to Inbox" }).click();
  await expect(page).toHaveURL(/\/tasks\//);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "Unified release review",
  );
  await openSection(page, "Scheduling & priority");
  // The worker writes after capture's transaction; the open detail refreshes itself.
  await expect(page.getByLabel("Priority", { exact: true })).toHaveValue("urgent", {
    timeout: 15_000,
  });
  const key = new URL(page.url()).pathname.split("/").at(-1)!;
  const taskResponse = await page.request.get(`/api/v1/tasks/${key}`);
  const { data: task } = await taskResponse.json();
  expect(task.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const runs = await page.request.get(`/api/v1/rules/${rule.id}/runs`);
  expect((await runs.json()).data).toEqual([
    expect.objectContaining({ taskId: task.id, status: "succeeded" }),
  ]);

  await page.goto(`/calendar?date=${task.dueDate}`);
  await expect(
    page.getByRole("heading", { name: "Calendar", exact: true }),
  ).toBeVisible();
  await expect(page.locator(`[data-date="${task.dueDate}"]`)).toContainText(task.title);
  const feedResponse = await page.request.post("/api/v1/me/calendar-feed");
  expect(feedResponse.status()).toBe(201);
  const { data: feed } = await feedResponse.json();
  const subscription = await page.request.get(feed.url);
  expect(subscription.status()).toBe(200);
  expect(await subscription.text()).toContain(`SUMMARY:${task.title}`);
  expect((await page.request.delete("/api/v1/me/calendar-feed")).status()).toBe(204);
  expect((await page.request.get(feed.url)).status()).toBe(404);
});

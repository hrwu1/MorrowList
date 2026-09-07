import { expect, test } from "@playwright/test";

import { openSection } from "./disclosures";

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

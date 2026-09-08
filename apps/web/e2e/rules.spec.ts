import { openSection } from "./disclosures";
import { expect, test } from "./fixtures";

test("create a tag-to-priority rule, trigger it, preview and inspect attributed runs", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Rules Tester");
  await page.getByLabel("Email").fill(`rules-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  const tagResponse = await page.request.post("/api/v1/tags", {
    data: { name: "urgent", colorToken: "red" },
  });
  expect(tagResponse.ok()).toBe(true);
  await page.goto("/settings/rules");
  const form = page.getByRole("form", { name: "Create automation rule" });
  await form.getByLabel("Rule name").fill("Urgent tag raises priority");
  await form.getByLabel("When", { exact: true }).selectOption("task.tag_added");
  await form.getByLabel("Trigger tag").selectOption({ label: "urgent" });
  await form.getByLabel("Action 1", { exact: true }).selectOption("set_priority");
  await form.getByLabel("Priority 1", { exact: true }).selectOption("urgent");
  await form.getByRole("button", { name: "Create rule", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Urgent tag raises priority", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open full Inbox", exact: true }).click();
  const capture = page.getByPlaceholder("Add a task and press Enter");
  await capture.fill("Prepare release");
  await capture.press("Enter");
  await page
    .getByRole("list", { name: "Inbox tasks" })
    .getByRole("link", { name: "Prepare release" })
    .click();
  const panel = page.getByRole("complementary", { name: /Task details for/ });
  const tagInput = panel.getByLabel("Add tag");
  await tagInput.fill("urgent");
  await tagInput.press("Enter");
  await expect(panel.getByRole("list", { name: "Tags" })).toContainText("urgent");
  await expect
    .poll(
      async () => {
        const response = await page.request.get("/api/v1/tasks");
        const body = await response.json();
        return body.data.find(
          (task: { title: string }) => task.title === "Prepare release",
        )?.priority;
      },
      { timeout: 15_000 },
    )
    .toBe("urgent");
  await page.reload();
  await openSection(
    page.getByRole("complementary", { name: /Task details for/ }),
    "Scheduling & priority",
  );
  await expect(
    page
      .getByRole("complementary", { name: /Task details for/ })
      .getByLabel("Priority", { exact: true }),
  ).toHaveValue("urgent");
  await openSection(
    page.getByRole("complementary", { name: /Task details for/ }),
    "Activity",
  );
  await expect(
    page.getByText("Rule: Urgent tag raises priority", { exact: true }),
  ).toBeVisible();
  await page.goto("/settings/rules");
  await page
    .getByRole("button", { name: "Runs and test for Urgent tag raises priority" })
    .click();
  await expect(page.getByRole("list", { name: "Run log" })).toContainText("succeeded");
  await page
    .getByLabel("Test task", { exact: true })
    .selectOption({ label: "Prepare release" });
  await page.getByRole("button", { name: "Test on this task" }).click();
  await expect(
    page.getByText("Would run: Set priority.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/automation-rules.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Disable Urgent tag raises priority" })
    .click();
  await expect(
    page.getByRole("button", { name: "Enable Urgent tag raises priority" }),
  ).toBeVisible();
});

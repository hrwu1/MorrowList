import { expect, test } from "./fixtures";
import { INBOUND_TEST_SECRET } from "./inbound-config";

test("oversized shares stay copyable and large captured content remains editable", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const text = "漢".repeat(3000);
  const response = await page.request.post("/capture/share", {
    multipart: { title: "Large share", text, url: "https://example.com/source" },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(413);
  expect(response.headers().location).toBeUndefined();
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers()["content-type"]).toContain("text/plain");
  expect(await response.text()).toContain(text);
  expect(await response.text()).toContain("https://example.com/source");

  // This request fits a normal header, but nesting it in returnTo exceeds the budget.
  const smallerText = "漢".repeat(600);
  await page.goto(`/capture?text=${encodeURIComponent(smallerText)}`);
  await expect(
    page.getByRole("heading", { name: "Share needs a shorter selection" }),
  ).toBeVisible();
  await expect(page.getByText(smallerText, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/capture\?text=/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Capture Limits");
  await page.getByLabel("Email").fill(`capture-limits-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  const native = await page.request.post("/capture/share", {
    multipart: { title: "Large share", text },
    maxRedirects: 0,
  });
  expect(native.status()).toBe(303);
  expect(native.headers().location).toContain("/tasks/");
  await page.goto(native.headers().location!);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Large share");
  await page.locator("summary").filter({ hasText: "Description" }).click();
  await expect(page.getByLabel("Markdown", { exact: true })).toHaveValue(text);

  await page.goto("/settings/workspace");
  await page.getByRole("button", { name: "Create capture address" }).click();
  const address = page.getByLabel("Your capture email address");
  await expect(address).toHaveValue(/^[a-f0-9]{64}@inbox.example.com$/);
  const received = await page.request.post("/inbound/email", {
    headers: { Authorization: `Bearer ${INBOUND_TEST_SECRET}` },
    data: {
      messageId: "large-email",
      recipient: await address.inputValue(),
      subject: "Large email",
      text: "a".repeat(60_000),
      attachmentCount: 2,
    },
  });
  expect(received.status()).toBe(201);
  await page.goto("/inbox");
  await page.getByRole("link", { name: "Large email", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Description" }).click();
  const markdown = page.getByLabel("Markdown", { exact: true });
  const description = await markdown.inputValue();
  expect(description).toHaveLength(50_000);
  expect(description).toContain("[Email body truncated to fit the task description.]");
  expect(description).toContain("[2 attachment(s) omitted.]");
  const edited = `Edited: ${description.slice(8)}`;
  await markdown.fill(edited);
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" && response.url().includes("/tasks/"),
  );
  await markdown.blur();
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await page.locator("summary").filter({ hasText: "Description" }).click();
  await expect(page.getByLabel("Markdown", { exact: true })).toHaveValue(edited);
});

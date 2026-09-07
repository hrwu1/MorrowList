import { expect, test, type Page } from "@playwright/test";

import { INBOUND_TEST_SECRET } from "./inbound-config";

const PASSWORD = "correct-horse-battery-staple";
async function signUp(page: Page) {
  const email = `channels-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Capture Channels");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
  return email;
}
test("settings rotates email addresses, bookmarklet captures, and shortcut opens the capture page", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await signUp(page);
  await page.goto("/settings/workspace");
  await page.getByRole("button", { name: "Create capture address" }).click();
  const address = page.getByLabel("Your capture email address");
  await expect(address).toHaveValue(/^[a-f0-9]{64}@inbox.example.com$/);
  const old = await address.inputValue();
  const response = await page.request.post("/inbound/email", {
    headers: { Authorization: `Bearer ${INBOUND_TEST_SECRET}` },
    data: {
      messageId: "e2e-mail",
      recipient: old,
      subject: "Email from browser test tomorrow",
      text: "Body from email",
    },
  });
  expect(response.status()).toBe(201);
  await page.getByRole("button", { name: "Rotate address", exact: true }).click();
  await expect(address).not.toHaveValue(old);
  const revoked = await page.request.post("/inbound/email", {
    headers: { Authorization: `Bearer ${INBOUND_TEST_SECRET}` },
    data: { messageId: "e2e-old", recipient: old, subject: "Revoked" },
  });
  expect(revoked.status()).toBe(403);
  await expect(page.getByLabel("Bookmarklet code")).toHaveValue(
    /javascript:.*encodeURIComponent/,
  );
  await page.goto("/inbox");
  // Navigation can finish before the shortcut listener hydrates. This row is loaded
  // by the client, so its appearance establishes readiness for keyboard interaction.
  await expect(
    page.getByRole("link", { name: "Email from browser test", exact: true }),
  ).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await page.keyboard.press("Control+Shift+Space");
  const popup = await popupPromise;
  await expect(
    popup.getByRole("heading", { level: 1, name: "Quick capture" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/inbox$/);
  await popup.getByLabel("Task", { exact: true }).fill("Phone capture tomorrow");
  await expect(popup.locator("#capture-preview")).toContainText("Planned");
  await popup.setViewportSize({ width: 390, height: 844 });
  await popup.screenshot({ path: "test-results/capture-mobile.png", fullPage: true });
  await Promise.all([
    popup.waitForEvent("close"),
    popup.getByRole("button", { name: "Add to Inbox" }).click(),
  ]);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Phone capture", exact: true }),
  ).toBeVisible();
});
test("native POST shares create tasks and signed-out shares survive login", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const email = await signUp(page);
  const native = await page.request.post("/capture/share", {
    multipart: {
      title: "Shared page",
      text: "Selected text",
      url: "https://example.com/shared",
    },
    maxRedirects: 0,
  });
  expect(native.status()).toBe(303);
  expect(native.headers().location).toContain("/tasks/");
  await page.goto(native.headers().location!);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Shared page");
  await context.clearCookies();
  const signedOut = await page.request.post("/capture/share", {
    multipart: {
      title: "Saved after login",
      text: "Text & more",
      url: "https://example.com/later",
    },
    maxRedirects: 0,
  });
  expect(signedOut.status()).toBe(303);
  await page.goto(signedOut.headers().location!);
  await expect(page).toHaveURL(/sign-in\?returnTo=/);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Task", { exact: true })).toHaveValue(
    "Saved after login",
  );
  await expect(page.getByText("Text & more", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Add to Inbox" }).click();
  await expect(page).toHaveURL(/\/tasks\//);
  const crossSite = await page.request.post("/capture/share", {
    headers: { origin: "https://untrusted.example" },
    multipart: { title: "Needs review" },
    maxRedirects: 0,
  });
  expect(crossSite.headers().location).toContain("/capture?");
});

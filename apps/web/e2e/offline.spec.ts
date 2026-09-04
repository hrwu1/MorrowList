import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * PWA and offline behaviour (spec 25, US-012, spec 28.1 step 11).
 *
 * Chromium's own installability check stands in for Lighthouse. "Offline" is both the
 * browser's own flag (`setOffline`, which is what the page and the indicator see) and an
 * abort of every request, the worker's included, so a page that renders offline really
 * came from the cache.
 */

const PASSWORD = "correct-horse-battery-staple";
const WORKER_FILE = fileURLToPath(new URL("../public/sw.js", import.meta.url));

async function signUp(page: Page, label: string) {
  const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(label);
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

/** The worker controls the page and has stored these entries (by URL prefix) in a partition. */
async function waitForCachedViews(page: Page, paths: readonly string[] = ["/inbox"]) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect
    .poll(() =>
      page.evaluate(async (wanted) => {
        const partition = (await caches.keys()).find((name) => name.includes("-data-"));
        if (!partition) return [];
        const keys = (await (await caches.open(partition)).keys()).map((r) => r.url);
        return wanted.filter((path) =>
          keys.some((key) => key.startsWith(`${location.origin}${path}`)),
        );
      }, paths),
    )
    .toEqual(paths);
}

/** Every script and stylesheet the stored document for `path` needs is in the shell cache. */
async function waitForShellAssets(page: Page, path: string) {
  await expect
    .poll(() =>
      page.evaluate(async (wanted) => {
        const names = await caches.keys();
        const shell = names.find((name) => name.includes("-shell-"));
        const partition = names.find((name) => name.includes("-data-"));
        if (!shell || !partition) return ["caches missing"];
        const document = await (
          await caches.open(partition)
        ).match(`${location.origin}${wanted}`, { ignoreVary: true });
        if (!document) return ["document missing"];
        const stored = new Set(
          (await (await caches.open(shell)).keys()).map((r) => r.url.split("?")[0]),
        );
        const html = await document.text();
        return [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)]
          .map((match) => `${location.origin}${match[1]!.split("?")[0]}`)
          .filter((url) => !url.includes("not-found") && !stored.has(url));
      }, path),
    )
    .toEqual([]);
}

function partitionCaches(page: Page) {
  return page.evaluate(async () =>
    (await caches.keys()).filter((name) => name.includes("-data-")),
  );
}

async function goOffline(context: BrowserContext) {
  await context.route("**/*", (route) => route.abort("internetdisconnected"));
  await context.setOffline(true);
}

async function goOnline(context: BrowserContext) {
  await context.setOffline(false);
  await context.unroute("**/*");
}

async function signOut(page: Page) {
  await page.locator("details.workspace-account summary").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
}

test("the app is installable", async ({ page, context }) => {
  const manifest = await page.request.get("/manifest.webmanifest");
  expect(manifest.headers()["content-type"]).toContain("manifest+json");
  const body = await manifest.json();
  expect(body.name).toBe("MorrowList");
  expect(body.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );
  for (const icon of body.icons as { src: string }[]) {
    expect((await page.request.get(icon.src)).ok()).toBe(true);
  }

  await signUp(page, "Install");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors).toEqual([]);
});

test("recently opened views render offline with the indicator, and an unsent task is kept as a draft", async ({
  page,
  context,
}) => {
  await signUp(page, "Offline");
  await capture(page, "Read me offline");
  // Client-side navigation, as a user does it: no document is requested, so the views
  // are stored because the shell announced them, not because the browser fetched them.
  const primary = page.getByRole("navigation", { name: "Primary" });
  await primary.getByRole("link", { name: /^Today/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await page.getByRole("link", { name: "Open full Inbox" }).click();
  await expect(page.getByRole("link", { name: "Read me offline" })).toBeVisible();
  await waitForCachedViews(page, [
    "/inbox",
    "/today",
    "/api/v1/tasks?inbox=true",
    "/api/v1/views/today",
  ]);
  await waitForShellAssets(page, "/inbox");

  await goOffline(context);
  try {
    await page.reload();
    await expect(page.getByRole("link", { name: "Read me offline" })).toBeVisible();
    await expect(page.getByTestId("offline-banner")).toContainText("You're offline");

    await page.goto("/today");
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await expect(page.getByTestId("offline-banner")).toBeVisible();

    // A page never opened online is explained rather than shown as a browser error.
    await page.goto("/completed");
    await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();

    // The write is refused and the text survives a reload (spec 25.1).
    await page.goto("/inbox");
    await expect(page.getByTestId("offline-banner")).toBeVisible();
    const field = page.getByPlaceholder("Add a task and press Enter");
    // Hydration of the stored document may client-render once; wait for it to settle.
    await expect(field).toHaveCount(1);
    await field.fill("Written while offline");
    await field.press("Enter");
    await expect(
      page.getByRole("form", { name: "Quick add" }).getByRole("alert"),
    ).toContainText("You're offline");
    await expect(page.getByText("Saved on this device")).toBeVisible();
    await expect(page.getByRole("link", { name: "Written while offline" })).toHaveCount(
      0,
    );

    await page.reload();
    await expect(page.getByPlaceholder("Add a task and press Enter")).toHaveValue(
      "Written while offline",
    );
    await expect(page.getByText("Saved on this device")).toBeVisible();
  } finally {
    await goOnline(context);
  }

  await expect(page.getByTestId("offline-banner")).toHaveCount(0);
  await page.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByRole("link", { name: "Written while offline" })).toBeVisible();
  await expect(page.getByText("Saved on this device")).toHaveCount(0);
  await page.reload();
  await expect(page.getByPlaceholder("Add a task and press Enter")).toHaveValue("");
});

test("signing out removes every partitioned cache and a second user cannot read the first user's Inbox", async ({
  page,
  context,
}) => {
  await signUp(page, "Alice");
  await capture(page, "Alice's private task");
  await waitForCachedViews(page);
  expect(await partitionCaches(page)).toHaveLength(1);

  await signOut(page);
  expect(await partitionCaches(page)).toEqual([]);

  await signUp(page, "Bob");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await goOffline(context);
  try {
    await page.goto("/inbox");
    // Bob gets his own (empty) Inbox or the fallback page — never anything of Alice's.
    await expect(
      page
        .getByRole("heading", { name: "Your Inbox is clear" })
        .or(page.getByRole("heading", { name: "You're offline" })),
    ).toBeVisible();
    await expect(page.getByText("Alice's private task")).toHaveCount(0);
  } finally {
    await goOnline(context);
  }
});

test("a new worker version prompts to reload and replaces the old caches", async ({
  page,
}) => {
  await signUp(page, "Upgrade");
  await capture(page, "Survives the upgrade");
  await waitForCachedViews(page);
  const before = await page.evaluate(() => caches.keys());
  const version = before
    .find((name) => name.includes("-shell-"))
    ?.split("-")
    .at(-1);
  expect(version).toBeDefined();

  // Ship a "new version": the same worker under a different version string.
  const original = readFileSync(WORKER_FILE, "utf8");
  try {
    writeFileSync(WORKER_FILE, original.replaceAll(`"${version}"`, '"e2eupgrade00"'));
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });

    await expect(page.getByText("A new version of MorrowList is ready.")).toBeVisible();
    const reloaded = page.waitForEvent("load");
    await page.getByRole("button", { name: "Reload" }).click();
    await reloaded;
    await expect(
      page.getByRole("link", { name: "Survives the upgrade" }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => caches.keys()))
      .toEqual(
        expect.arrayContaining(["morrowlist-shell-e2eupgrade00", "morrowlist-meta"]),
      );
    const after = await page.evaluate(() => caches.keys());
    expect(after.some((name) => name.includes(version!))).toBe(false);
    expect(after.some((name) => name.startsWith("morrowlist-data-e2eupgrade00-"))).toBe(
      true,
    );
  } finally {
    writeFileSync(WORKER_FILE, original);
  }
});

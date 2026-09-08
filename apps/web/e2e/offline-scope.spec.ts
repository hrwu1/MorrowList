import { expect, test, type Page } from "./fixtures";

async function signedIn(page: Page) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Cache scope");
  await page
    .getByLabel("Email")
    .fill(`scope-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Inbox", exact: true }),
  ).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect.poll(() => partitions(page)).toHaveLength(1);
  expect(
    (
      await page.request.post("/api/v1/tasks", {
        data: { title: "Private scope task" },
      })
    ).ok(),
  ).toBe(true);
}
function partitions(page: Page) {
  return page.evaluate(async () =>
    (await caches.keys()).filter((name) => name.includes("-data-")),
  );
}
function tellWorker(page: Page, message: unknown) {
  return page.evaluate(
    (value) =>
      new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve();
        navigator.serviceWorker.controller!.postMessage(value, [channel.port2]);
      }),
    message,
  );
}
function deferred() {
  let finish!: () => void;
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}

for (const change of ["logout", "new user"] as const) {
  test(`a late service-worker read cannot recreate an old partition after ${change}`, async ({
    page,
    context,
  }) => {
    test.setTimeout(60_000);
    await signedIn(page);
    const old = await partitions(page);
    const arrived = deferred();
    const release = deferred();
    const fulfilled = deferred();
    await context.route("**/api/v1/tasks?scope-race=held", async (route) => {
      const response = await route.fetch();
      arrived.finish();
      await release.promise;
      await route.fulfill({ response });
      fulfilled.finish();
    });
    await page.evaluate(() => {
      void fetch("/api/v1/tasks?scope-race=held").catch(() => {});
    });
    await arrived.promise;
    if (change === "logout") {
      await page.locator("details.workspace-account summary").click();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL(/\/sign-in$/);
    } else {
      await tellWorker(page, {
        type: "SET_SCOPE",
        scope: { userId: "new-user", workspaceId: "new-workspace" },
      });
    }
    const afterChange = await partitions(page);
    expect(afterChange.some((name) => old.includes(name))).toBe(false);
    release.finish();
    await fulfilled.promise;
    // FetchEvent.waitUntil stores asynchronously after delivering the page response.
    await page.waitForTimeout(300);
    expect((await partitions(page)).some((name) => old.includes(name))).toBe(false);
    await context.unroute("**/api/v1/tasks?scope-race=held");
  });
}

test("logout acknowledgement does not wait for an earlier warm response", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await signedIn(page);
  const arrived = deferred();
  const release = deferred();
  await context.route("**/completed", async (route) => {
    const response = await route.fetch();
    arrived.finish();
    await release.promise;
    await route.fulfill({ response });
  });
  const warming = tellWorker(page, {
    type: "WARM",
    url: new URL("/completed", page.url()).href,
  });
  await arrived.promise;
  await tellWorker(page, { type: "CLEAR_SCOPE" });
  expect(await partitions(page)).toEqual([]);
  release.finish();
  await warming;
  expect(await partitions(page)).toEqual([]);
  await context.unroute("**/completed");
});

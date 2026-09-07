import { expect, test, type Page } from "@playwright/test";

// These tests exercise the Today UI and API state, including controlled request
// failures. Offline/cache behavior is covered separately in the offline suites.
test.use({ serviceWorkers: "block" });

async function signUp(page: Page) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Studio Tester");
  await page
    .getByLabel("Email")
    .fill(`studio-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`);
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
}

async function chooseTask(page: Page, title: string) {
  const input = page.getByPlaceholder("Add a task and press Enter");
  await input.fill(title);
  await input.press("Enter");
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Edit ${title}`, exact: true }).click();
  await page
    .getByRole("button", { name: `Add ${title} to My Day`, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: `Remove ${title} from My Day`, exact: true }),
  ).toBeVisible();
}

test("chooses a real focus task and restores keyboard focus after Escape", async ({
  page,
}) => {
  await signUp(page);
  await chooseTask(page, "Read the research notes");
  await chooseTask(page, "Write one clear paragraph");
  await page.goto("/today");

  const focusCard = page.getByRole("region", { name: "One thing at a time" });
  await focusCard
    .getByLabel("Or focus on")
    .selectOption({ label: "Write one clear paragraph" });
  await expect(
    focusCard.getByRole("heading", { name: "Write one clear paragraph" }),
  ).toBeVisible();

  const start = focusCard.getByRole("button", { name: "Start focusing" });
  await start.click();
  const dialog = page.getByRole("dialog", { name: "Write one clear paragraph" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Mark as complete" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(start).toBeFocused();

  // Refocusing a button must not internally scroll its decorative, clipped card.
  await page.setViewportSize({ width: 390, height: 844 });
  const cardBounds = await focusCard.boundingBox();
  const eyebrowBounds = await focusCard
    .locator(".studio-focus-card__eyebrow")
    .boundingBox();
  expect(cardBounds).not.toBeNull();
  expect(eyebrowBounds).not.toBeNull();
  expect(eyebrowBounds!.y).toBeGreaterThanOrEqual(cardBounds!.y);

  // The focus lens does not remove other work or rewrite the daily plan.
  const plan = page.getByRole("list", { name: "My Day tasks" });
  await expect(
    plan.getByRole("link", { name: "Read the research notes", exact: true }),
  ).toBeVisible();
  await expect(
    plan.getByRole("link", { name: "Write one clear paragraph", exact: true }),
  ).toBeVisible();
});

test("populated Today stays readable in dark reduced-motion mode", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await signUp(page);
  await chooseTask(page, "Make the next step feel manageable");
  await chooseTask(page, "Leave a clear handoff note");
  await page.goto("/today");
  const card = page.getByRole("region", { name: "One thing at a time" });
  await expect(card).toBeVisible();
  await expect(page.getByRole("list", { name: "My Day tasks" })).toContainText(
    "Leave a clear handoff note",
  );

  // Check the pixels' computed colors rather than merely checking token names. Canvas
  // resolves CSS colors to sRGB; ancestor surfaces are alpha-composited for transparent
  // labels. This covers visible text in the shell, hero, focus card, guide, and task rows.
  const contrast = await page.locator(".app-shell").evaluate((root) => {
    type Rgb = [number, number, number];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    function rgba(color: string): [number, number, number, number] {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]! / 255];
    }
    function over(foreground: readonly number[], background: Rgb, opacity = 1): Rgb {
      const alpha = (foreground[3] ?? 1) * opacity;
      return [0, 1, 2].map(
        (channel) => foreground[channel]! * alpha + background[channel]! * (1 - alpha),
      ) as Rgb;
    }
    function luminance(color: Rgb): number {
      const linear = color.map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
    }

    const failures: {
      text: string;
      ratio: number;
      required: number;
      element: string;
    }[] = [];
    let measured = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const element = node.parentElement;
      const text = node.textContent?.trim();
      if (
        !element ||
        !text ||
        element.closest(
          '[aria-hidden="true"], .ml-visually-hidden, option, svg, script, style, button:disabled',
        )
      )
        continue;
      const style = getComputedStyle(element);
      if (style.visibility !== "visible" || element.getClientRects().length === 0)
        continue;
      const range = document.createRange();
      range.selectNode(node);
      const bounds = range.getBoundingClientRect();
      if (bounds.width < 2 || bounds.height < 2) continue;

      const ancestors: Element[] = [];
      for (
        let ancestor: Element | null = element;
        ancestor;
        ancestor = ancestor.parentElement
      )
        ancestors.unshift(ancestor);
      let background: Rgb = [255, 255, 255];
      let opacity = 1;
      let unsupportedBackground = false;
      for (const ancestor of ancestors) {
        const ancestorStyle = getComputedStyle(ancestor);
        unsupportedBackground ||= ancestorStyle.backgroundImage !== "none";
        background = over(rgba(ancestorStyle.backgroundColor), background);
        opacity *= Number(ancestorStyle.opacity);
      }
      if (opacity === 0 || unsupportedBackground) continue;
      const foreground = over(rgba(style.color), background, opacity);
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      const ratio =
        (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
      const size = parseFloat(style.fontSize);
      const required =
        size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700)
          ? 3
          : 4.5;
      measured += 1;
      if (ratio < required)
        failures.push({
          text: text.slice(0, 80),
          ratio,
          required,
          element: `${element.tagName}.${element.className}`,
        });
    }
    return { measured, failures };
  });
  expect(contrast.measured).toBeGreaterThan(25);
  expect(contrast.failures).toEqual([]);
  await page.screenshot({ path: "test-results/studio-today-dark.png", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  const start = card.getByRole("button", { name: "Start focusing" });
  expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(
    await start.evaluate((button) =>
      parseFloat(getComputedStyle(button).transitionDuration),
    ),
  ).toBeLessThanOrEqual(0.001);
  await start.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(start).toBeFocused();
});

test("completes from focus, offers Undo inside the dialog, and persists the reversal", async ({
  page,
}) => {
  await signUp(page);
  await chooseTask(page, "Finish the outline");
  await page.goto("/today");
  await page.getByRole("button", { name: "Start focusing" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mark as complete" })
    .click();

  const success = page.getByRole("dialog", { name: "A little lighter." });
  await expect(success).toBeVisible();
  await expect(
    success.getByRole("heading", { name: "A little lighter." }),
  ).toBeFocused();
  await expect(success).toContainText("Finish the outline is done.");
  await success.getByRole("button", { name: "Undo completion", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Complete Finish the outline", exact: true }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByRole("list", { name: "My Day tasks" })).toContainText(
    "Finish the outline",
  );

  // A second completion really persists too; the view is not only optimistic.
  await page.getByRole("button", { name: "Start focusing" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Mark as complete" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Return to my day" })
    .click();
  await expect(
    page.getByRole("button", { name: "Find your first focus" }),
  ).toBeFocused();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Nothing needs you today" }),
  ).toBeVisible();
  await page.goto("/completed");
  await expect(
    page.getByRole("link", { name: "Finish the outline", exact: true }),
  ).toBeVisible();
});

test("an empty day offers a useful starting point on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signUp(page);
  await page.goto("/today");
  await expect(
    page.getByRole("heading", { name: "Nothing needs you today" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Find your first focus" }).click();
  const chooser = page.getByRole("region", { name: "Choose tasks for today" });
  await expect(chooser).toBeVisible();
  await expect(
    chooser.getByRole("heading", { name: "Make room for what matters" }),
  ).toBeFocused();
  await expect(chooser).toContainText("You have chosen all available tasks.");
  await chooser.getByRole("button", { name: "Done choosing" }).click();
  await expect(
    page.getByRole("button", { name: "Choose tasks for today", exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});

test("leaving a pending completion cannot replace the next focus with old success", async ({
  page,
}) => {
  await signUp(page);
  await chooseTask(page, "Finish the first thought");
  await chooseTask(page, "Make space for the next thought");
  await page.goto("/today");
  await page
    .getByLabel("Or focus on")
    .selectOption({ label: "Finish the first thought" });

  let releaseCompletion = () => {};
  const release = new Promise<void>((resolve) => {
    releaseCompletion = resolve;
  });
  let completionWasHeld = false;
  await page.context().route("**/api/v1/tasks/*/complete", async (route) => {
    completionWasHeld = true;
    await release;
    await route.continue();
  });

  try {
    await page.getByRole("button", { name: "Start focusing" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Mark as complete" })
      .click();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Finishing…" }),
    ).toBeDisabled();
    await expect.poll(() => completionWasHeld).toBe(true);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Start focusing" }).click();
    const next = page.getByRole("dialog", { name: "Make space for the next thought" });
    await expect(next).toBeVisible();

    const completed = page.waitForResponse(
      (response) =>
        response.url().includes("/complete") && response.request().method() === "POST",
    );
    releaseCompletion();
    await completed;
    await expect(next).toBeVisible();
    await expect(page.getByRole("dialog", { name: "A little lighter." })).toHaveCount(
      0,
    );
    await expect(next.getByRole("button", { name: "Mark as complete" })).toBeEnabled();
  } finally {
    releaseCompletion();
  }
});

test("a failed daily plan stays an error and can be retried", async ({ page }) => {
  await signUp(page);
  let failedRequests = 0;
  await page.context().route("**/api/v1/views/today**", (route) => {
    failedRequests += 1;
    return route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "UNAVAILABLE",
          message: "The daily plan is temporarily unavailable.",
        },
      }),
    });
  });
  await page.goto("/today");
  await expect(page.locator(".studio-today").getByRole("alert")).toContainText(
    "Today could not be loaded",
    { timeout: 10_000 },
  );
  expect(failedRequests).toBeGreaterThanOrEqual(1);
  await expect(page.getByRole("region", { name: "One thing at a time" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Nothing needs you today" }),
  ).toHaveCount(0);
  await page.context().unroute("**/api/v1/views/today**");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("region", { name: "One thing at a time" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Nothing needs you today" }),
  ).toBeVisible();
});

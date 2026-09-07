import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";

import { expect, test, type Page } from "@playwright/test";

import { openProjectBoard, openSection } from "./disclosures";

/**
 * Webhooks end to end (GAP-18).
 *
 * A real HTTP receiver runs beside the browser, an endpoint is registered through the
 * settings page, a card is moved, and the delivery the worker sends is verified with the
 * secret the page showed once — using nothing but `node:crypto`, exactly as the snippet
 * in `docs/api/webhooks.md` tells a subscriber to.
 */

const PASSWORD = "correct-horse-battery-staple";

interface Delivery {
  readonly headers: Record<string, string>;
  readonly body: string;
}

interface Receiver {
  readonly url: string;
  readonly deliveries: Delivery[];
  close(): Promise<void>;
}

/** A subscriber, listening on the host the server can reach it at. */
async function startReceiver(): Promise<Receiver> {
  const deliveries: Delivery[] = [];

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      deliveries.push({
        headers: Object.fromEntries(
          Object.entries(request.headers).map(([key, value]) => [
            key,
            Array.isArray(value) ? (value[0] ?? "") : (value ?? ""),
          ]),
        ),
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(204).end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no port");

  return {
    url: `http://127.0.0.1:${address.port}/hook`,
    deliveries,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * The verification a subscriber performs, written from `docs/api/webhooks.md` rather
 * than imported: if the published instructions stop working, this test fails.
 */
function verify(secret: string, delivery: Delivery): boolean {
  const header = delivery.headers["morrow-signature"] ?? "";
  const fields = Object.fromEntries(
    header.split(",").map((part) => part.trim().split("=")),
  ) as Record<string, string>;
  const timestamp = Number(fields.t);
  if (!Number.isFinite(timestamp) || !fields.v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) return false;

  const key = createHash("sha256").update(secret, "utf8").digest();
  const expected = createHmac("sha256", key)
    .update(`${timestamp}.${delivery.body}`, "utf8")
    .digest();
  const received = Buffer.from(fields.v1, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Webhooks sit behind Workspace settings, not in the sidebar. */
async function openWebhookSettings(page: Page) {
  // The WIP counter links here too, so this picks the labelled utilities entry.
  await openSection(page, "Settings");
  await page.getByRole("link", { name: "Workspace settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Workspace" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Webhooks", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Webhooks" })).toBeVisible();
}

async function signUp(page: Page) {
  const email = `hook-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Webhook Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
}

/** Register the receiver and take the secret the page shows exactly once. */
async function subscribe(page: Page, url: string): Promise<string> {
  await openWebhookSettings(page);

  const form = page.getByRole("form", { name: "Add a webhook endpoint" });
  await form.getByLabel("Endpoint URL").fill(url);
  await form.getByLabel("Events").selectOption({ label: "All task events" });
  await form.getByLabel("Description").fill("Playwright receiver");
  await form.getByRole("button", { name: "Add endpoint" }).click();

  const banner = page
    .getByRole("status")
    .filter({ hasText: "copy the signing secret" });
  await expect(banner).toBeVisible();
  const secret = (await banner.locator("code").innerText()).trim();
  expect(secret).toMatch(/^whsec_/);
  await banner.getByRole("button", { name: "I have stored it" }).click();

  await expect(
    page.getByRole("list", { name: "Webhook endpoints" }).getByText(url),
  ).toBeVisible();
  return secret;
}

// The worker polls every two seconds here; the retry ladder starts at a minute.
test.setTimeout(180_000);

test("a moved card produces one signed delivery a subscriber can verify", async ({
  page,
}) => {
  const receiver = await startReceiver();
  try {
    await signUp(page);
    const secret = await subscribe(page, receiver.url);

    // A test delivery reports what the endpoint said, immediately and without retrying.
    const endpoint = page
      .getByRole("list", { name: "Webhook endpoints" })
      .getByRole("listitem")
      .first();
    await endpoint.getByRole("button", { name: "Send test" }).click();
    await expect(page.getByText(/Test delivery: Delivered/)).toBeVisible();
    expect(receiver.deliveries).toHaveLength(1);
    const tested = receiver.deliveries[0]!;
    expect(JSON.parse(tested.body).type).toBe("webhook.test");
    expect(verify(secret, tested)).toBe(true);
    // A test has no stored event behind it, so it carries no event id.
    expect(tested.headers["morrow-event"]).toBeUndefined();

    // Now the real thing: create a project, capture a card, and move it a column along.
    await page.getByRole("button", { name: "Add project" }).click();
    const projectForm = page.getByRole("form", { name: "Quick add project" });
    await projectForm.getByLabel("Project name").fill("Webhook Launch");
    await projectForm.getByLabel("Project name").press("Enter");
    await expect(
      page.getByRole("heading", { level: 1, name: "Webhook Launch" }),
    ).toBeVisible();

    await openProjectBoard(page);

    await page.getByRole("button", { name: "+ Add a task" }).click();
    const capture = page.getByPlaceholder("Add to Ready and press Enter");
    await capture.fill("Wire the receiver");
    await capture.press("Enter");
    await expect(
      page
        .getByRole("region", { name: "Ready" })
        .getByRole("link", { name: "Wire the receiver" }),
    ).toBeVisible();

    await page
      .getByLabel("Move Wire the receiver")
      .selectOption({ label: "In Progress" });
    await expect(
      page
        .getByRole("region", { name: "In Progress" })
        .getByRole("link", { name: "Wire the receiver" }),
    ).toBeVisible();

    // The worker delivers on its own tick, so this waits rather than acting.
    await expect(async () => {
      expect(
        receiver.deliveries.some(
          (delivery) => JSON.parse(delivery.body).type === "task.moved",
        ),
      ).toBe(true);
    }).toPass({ timeout: 60_000, intervals: [1_000] });

    const moved = receiver.deliveries.find(
      (delivery) => JSON.parse(delivery.body).type === "task.moved",
    )!;
    expect(verify(secret, moved)).toBe(true);

    const envelope = JSON.parse(moved.body);
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      type: "task.moved",
      aggregateType: "task",
      actor: { kind: "user" },
    });
    expect(envelope.delivery.attempt).toBe(1);
    expect(moved.headers["morrow-event"]).toBe(envelope.id);
    expect(moved.headers["morrow-event-type"]).toBe("task.moved");
    expect(moved.headers["morrow-delivery"]).toBe(envelope.delivery.id);

    // Only task events were subscribed to, so nothing else was sent.
    const types = receiver.deliveries.map((delivery) => JSON.parse(delivery.body).type);
    expect(
      types.every(
        (type: string) => type === "webhook.test" || type.startsWith("task."),
      ),
    ).toBe(true);
    // The card was created and moved once each, so neither was delivered twice.
    expect(types.filter((type: string) => type === "task.moved")).toHaveLength(1);

    // The delivery log shows the same attempts the receiver saw.
    await openWebhookSettings(page);
    await page
      .getByRole("list", { name: "Webhook endpoints" })
      .getByRole("listitem")
      .first()
      .getByRole("button", { name: "Deliveries" })
      .click();
    const log = page.getByRole("table", { name: /Recent deliveries/ });
    await expect(
      log.getByRole("row").filter({ hasText: "webhook.test" }),
    ).toContainText("Delivered");
    await expect(log.getByRole("row").filter({ hasText: "task.moved" })).toContainText(
      "Delivered",
    );
    await page.screenshot({
      path: "test-results/webhooks-delivery-log.png",
      fullPage: true,
    });
  } finally {
    await receiver.close();
  }
});

import { Command } from "commander";

import {
  formatWebhookDeliveryTable,
  formatWebhookTable,
  printJson,
} from "../formatters/output.js";

import { fail, globalsOf, idempotency, withClient } from "./shared.js";

/** `morrow webhook …` (GAP-18): manage endpoints and read the delivery log. */
export function webhookCommand(): Command {
  const webhook = new Command("webhook").description(
    "Subscribe endpoints to workspace events",
  );

  webhook
    .command("list")
    .description("List webhook endpoints")
    .option("--limit <n>", "page size, 1-200", "50")
    .action(async (options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const page = await withClient(globals, (client) =>
          client.listWebhooks({ limit: Number(options.limit) }),
        );
        if (json) printJson({ ok: true, data: page });
        else process.stdout.write(`${formatWebhookTable(page.data)}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  webhook
    .command("add")
    .description("Subscribe an endpoint; the signing secret is printed once")
    .argument("<url>", "https endpoint to POST to")
    .option(
      "--events <list>",
      "comma-separated event types, prefixes like task.*, or *",
      "*",
    )
    .option("--description <text>", "what this endpoint is for")
    .action(async (url: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const created = await withClient(globals, (client) =>
          client.createWebhook(
            {
              url,
              eventTypes: String(options.events)
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean),
              ...(options.description ? { description: options.description } : {}),
            },
            idempotency(),
          ),
        );
        if (json) printJson({ ok: true, data: created });
        else {
          // The secret goes to stdout once and is never recoverable, so it is spelled
          // out rather than tucked into a table.
          process.stdout.write(
            [
              `${created.id}  ${created.url}`,
              `signing secret: ${created.secret}`,
              "Store it now: it cannot be shown again.",
            ].join("\n") + "\n",
          );
        }
      } catch (error) {
        fail(error, json);
      }
    });

  webhook
    .command("update")
    .description("Change an endpoint's URL, events, description, or active flag")
    .argument("<id>", "webhook id")
    .option("--url <url>", "new endpoint URL")
    .option("--events <list>", "comma-separated event types")
    .option("--description <text>", "what this endpoint is for")
    .option("--enable", "resume delivery")
    .option("--disable", "pause delivery")
    .action(async (id: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const updated = await withClient(globals, (client) =>
          client.updateWebhook(
            id,
            {
              ...(options.url ? { url: options.url } : {}),
              ...(options.events
                ? {
                    eventTypes: String(options.events)
                      .split(",")
                      .map((entry) => entry.trim())
                      .filter(Boolean),
                  }
                : {}),
              ...(options.description ? { description: options.description } : {}),
              ...(options.enable ? { active: true } : {}),
              ...(options.disable ? { active: false } : {}),
            },
            idempotency(),
          ),
        );
        if (json) printJson({ ok: true, data: updated });
        else process.stdout.write(`${formatWebhookTable([updated])}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  webhook
    .command("remove")
    .description("Remove an endpoint and its delivery log")
    .argument("<id>", "webhook id")
    .action(async (id: string, _options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        await withClient(globals, (client) => client.deleteWebhook(id, idempotency()));
        if (json) printJson({ ok: true, data: { id } });
        else process.stdout.write(`Removed ${id}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  webhook
    .command("test")
    .description("Send one test delivery now and report what the endpoint said")
    .argument("<id>", "webhook id")
    .action(async (id: string, _options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const delivery = await withClient(globals, (client) =>
          client.testWebhook(id, idempotency()),
        );
        if (json) printJson({ ok: true, data: delivery });
        else process.stdout.write(`${formatWebhookDeliveryTable([delivery])}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  webhook
    .command("deliveries")
    .description("The endpoint's delivery log, newest first")
    .argument("<id>", "webhook id")
    .option("--limit <n>", "page size, 1-200", "20")
    .action(async (id: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const page = await withClient(globals, (client) =>
          client.listWebhookDeliveries(id, { limit: Number(options.limit) }),
        );
        if (json) printJson({ ok: true, data: page });
        else process.stdout.write(`${formatWebhookDeliveryTable(page.data)}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  webhook
    .command("retry")
    .description("Re-arm a dead-lettered delivery")
    .argument("<id>", "webhook id")
    .argument("<deliveryId>", "delivery id from `webhook deliveries`")
    .action(async (id: string, deliveryId: string, _options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const delivery = await withClient(globals, (client) =>
          client.retryWebhookDelivery(id, deliveryId, idempotency()),
        );
        if (json) printJson({ ok: true, data: delivery });
        else process.stdout.write(`${formatWebhookDeliveryTable([delivery])}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  return webhook;
}

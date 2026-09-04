import { Command } from "commander";

import { formatNotificationTable, printJson } from "../formatters/output.js";

import { fail, globalsOf, idempotency, withClient } from "./shared.js";

/** `morrow notifications …` (GAP-13): the in-app inbox from the terminal. */
export function notificationsCommand(): Command {
  const notifications = new Command("notifications").description(
    "Read reminders and digests",
  );

  notifications
    .command("list")
    .description("List notifications, newest first; * marks unread")
    .option("--unread", "unread only")
    .option("--limit <n>", "page size, 1-200", "50")
    .action(async (options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const page = await withClient(globals, (client) =>
          client.listNotifications({
            ...(options.unread ? { unread: true } : {}),
            limit: Number(options.limit),
          }),
        );
        if (json) printJson({ ok: true, data: page });
        else
          process.stdout.write(
            `${formatNotificationTable(page.data, page.unreadCount)}\n`,
          );
      } catch (error) {
        fail(error, json);
      }
    });

  for (const [name, describe, run, verb] of [
    ["read", "Mark a notification read", "markNotificationRead", "read"],
    ["snooze", "Remind again in an hour", "snoozeNotification", "snoozed for an hour"],
  ] as const) {
    notifications
      .command(name)
      .description(describe)
      .argument("<id>", "notification id")
      .action(async (id: string, _options, command: Command) => {
        const globals = globalsOf(command);
        const json = Boolean(globals.json);
        try {
          const result = await withClient(globals, (client) =>
            client[run](id, idempotency()),
          );
          if (json) printJson({ ok: true, data: result });
          else process.stdout.write(`${result.title}  ${verb}\n`);
        } catch (error) {
          fail(error, json);
        }
      });
  }

  notifications
    .command("preferences")
    .description("Show or change notification preferences for the workspace")
    .option("--email <on|off>", "email channel")
    .option("--in-app <on|off>", "in-app channel")
    .option("--digest <HH:mm>", "daily Today digest time")
    .option("--no-digest", "turn the daily digest off")
    .option("--timezone <iana>", "timezone for the digest time")
    .option("--default-remind <minutes>", "reminder offset for new timed tasks")
    .action(async (options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const preferences = await withClient(globals, async (client) => {
          const channels = {
            ...(options.email ? { email: options.email === "on" } : {}),
            ...(options.inApp ? { inApp: options.inApp === "on" } : {}),
          };
          const patch = {
            ...(Object.keys(channels).length > 0 ? { channels } : {}),
            ...(options.digest === false
              ? { digestTime: null }
              : typeof options.digest === "string"
                ? { digestTime: options.digest }
                : {}),
            ...(options.timezone ? { timezone: options.timezone } : {}),
            ...(options.defaultRemind
              ? { defaultOffsetMinutes: Number(options.defaultRemind) }
              : {}),
          };
          return Object.keys(patch).length === 0
            ? client.getNotificationPreferences()
            : client.updateNotificationPreferences(patch, idempotency());
        });
        if (json) printJson({ ok: true, data: preferences });
        else
          process.stdout.write(
            [
              `in-app: ${preferences.channels.inApp ? "on" : "off"}`,
              `email: ${preferences.channels.email ? "on" : "off"}`,
              `digest: ${preferences.digestTime ?? "off"}${preferences.timezone ? ` (${preferences.timezone})` : ""}`,
              `default reminder: ${preferences.defaultOffsetMinutes} minutes before`,
            ].join("\n") + "\n",
          );
      } catch (error) {
        fail(error, json);
      }
    });

  return notifications;
}

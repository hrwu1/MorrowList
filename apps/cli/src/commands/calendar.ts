import { Command } from "commander";

import { printJson } from "../formatters/output.js";

import { fail, globalsOf, withClient } from "./shared.js";

export function calendarCommand(): Command {
  const calendar = new Command("calendar").description(
    "Manage the read-only workspace calendar feed",
  );
  calendar
    .command("url")
    .description("Create a feed URL shown once; replaces the previous URL")
    .action(async (_options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const feed = await withClient(globals, (client) => client.createCalendarFeed());
        if (json) printJson({ ok: true, data: feed });
        else
          process.stdout.write(
            `${feed.url}\nStore this private URL now. Previous feed URLs are revoked.\n`,
          );
      } catch (error) {
        fail(error, json);
      }
    });
  calendar
    .command("revoke")
    .description("Revoke the current calendar feed URL")
    .action(async (_options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        await withClient(globals, (client) => client.revokeCalendarFeed());
        if (json) printJson({ ok: true });
        else process.stdout.write("Calendar feed revoked.\n");
      } catch (error) {
        fail(error, json);
      }
    });
  return calendar;
}

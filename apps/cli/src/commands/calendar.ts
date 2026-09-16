import { Command } from "commander";

import { readConfig, resolveProfile } from "../config/profile.js";
import { printJson } from "../formatters/output.js";

import { fail, globalsOf, withClient } from "./shared.js";

export function calendarCommand(): Command {
  const calendar = new Command("calendar").description(
    "Calendar feed URL and CalDAV account details",
  );
  calendar
    .command("caldav")
    .description("Show the CalDAV account details for Apple Calendar and other clients")
    .action(async (_options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const profile = resolveProfile(await readConfig(), globals);
        const server = new URL("/dav/", profile.baseUrl).href;
        const me = await withClient(globals, (client) => client.me());
        const details = {
          server,
          username: me.user.email,
          password:
            "an API token: the key from `morrow auth login`, or Settings → Calendar",
        };
        if (json) printJson({ ok: true, data: details });
        else
          process.stdout.write(
            `server    ${details.server}\nusername  ${details.username}\npassword  ${details.password}\n`,
          );
      } catch (error) {
        fail(error, json);
      }
    });
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

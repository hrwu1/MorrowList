import { Command } from "commander";

import { printJson } from "../formatters/output.js";

import { fail, globalsOf, withClient } from "./shared.js";

export function captureCommand(): Command {
  const capture = new Command("capture").description(
    "Manage your email capture address (use a signed-in user session token)",
  );
  for (const rotate of [false, true]) {
    capture
      .command(rotate ? "rotate-address" : "address")
      .description(
        rotate
          ? "Revoke the old email address and create a new one"
          : "Show your secret email capture address",
      )
      .action(async (_options, command: Command) => {
        const globals = globalsOf(command);
        try {
          const data = await withClient(globals, (client) =>
            rotate ? client.rotateInboundAddress() : client.getInboundAddress(),
          );
          if (globals.json) printJson({ ok: true, data });
          else
            process.stdout.write(
              `${data.address ?? (data.enabled ? "No address yet. Run capture rotate-address." : "Email capture is not configured.")}\n`,
            );
        } catch (error) {
          fail(error, Boolean(globals.json));
        }
      });
  }
  return capture;
}

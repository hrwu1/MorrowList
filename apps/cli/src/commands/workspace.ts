import type { UpdateWorkspaceRequest } from "@morrowlist/contracts";
import { Command } from "commander";

import { printJson } from "../formatters/output.js";

import { fail, globalsOf, idempotency, usageFailure, withClient } from "./shared.js";

/**
 * `morrow workspace …` (spec 20.3, GAP-20): the settings that belong to the person
 * rather than to a project, including the cross-project "in progress" limit.
 */
export function workspaceCommand(): Command {
  const workspace = new Command("workspace").description("Edit workspace settings");

  workspace
    .command("update")
    .description(
      "Rename the workspace, change its key prefix or timezone, or set the limit",
    )
    .argument("[id]", "workspace id; defaults to the profile's workspace")
    .option("--name <name>", "workspace name")
    .option("--prefix <prefix>", "task key prefix, for example ML")
    .option("--timezone <zone>", "IANA timezone, for example Europe/Berlin")
    .option(
      "--in-progress-limit <n>",
      "how many tasks may be in progress across every project",
    )
    .option("--clear-in-progress-limit", "remove the in-progress limit")
    .option(
      "--expected-version <n>",
      "fail unless the workspace is still at this version",
    )
    .action(async (id: string | undefined, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const body: UpdateWorkspaceRequest = {
          ...(options.name ? { name: options.name } : {}),
          ...(options.prefix ? { taskKeyPrefix: options.prefix } : {}),
          ...(options.timezone ? { timezone: options.timezone } : {}),
          ...(options.clearInProgressLimit
            ? { inProgressLimit: null }
            : options.inProgressLimit
              ? { inProgressLimit: Number(options.inProgressLimit) }
              : {}),
          ...(options.expectedVersion
            ? { expectedVersion: Number(options.expectedVersion) }
            : {}),
        };
        const updated = await withClient(globals, async (client) => {
          const workspaceId =
            id ?? globals.workspaceId ?? (await client.me()).defaultWorkspaceId;
          if (!workspaceId) usageFailure("no workspace id is configured", json);
          return client.updateWorkspace(workspaceId, body, idempotency());
        });
        if (json) printJson({ ok: true, data: updated });
        else
          process.stdout.write(
            `${updated.id}  ${updated.name}  in progress limit ${updated.inProgressLimit ?? "none"}\n`,
          );
      } catch (error) {
        fail(error, json);
      }
    });

  return workspace;
}

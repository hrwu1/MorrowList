import type { ApiClient } from "@morrowlist/api-client";
import type { SavedViewDto, SavedViewLayout } from "@morrowlist/contracts";
import { Command } from "commander";

import { formatSavedViewTable, printJson } from "../formatters/output.js";

import { fail, globalsOf, idempotency, usageFailure, withClient } from "./shared.js";
import { WHERE_HELP, resolveWhere } from "./where.js";

/** Find one of the caller's views by id or case-insensitive name. */
async function findView(
  client: ApiClient,
  nameOrId: string,
): Promise<SavedViewDto | null> {
  const key = nameOrId.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  const { data } = await client.listSavedViews();
  return (
    data.find(
      (view) => view.id === nameOrId || view.name.toLocaleLowerCase("en-US") === key,
    ) ?? null
  );
}

/** `morrow view …`: personal saved views, the same filter sets the web sidebar lists. */
export function viewCommand(): Command {
  const view = new Command("view").description(
    "List, save, and delete your saved views",
  );

  view
    .command("list")
    .description("List your saved views in sidebar order")
    .action(async (_options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const listed = await withClient(globals, (client) => client.listSavedViews());
        if (json) printJson({ ok: true, data: listed });
        else process.stdout.write(`${formatSavedViewTable(listed.data)}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  view
    .command("save")
    .description(`Save a filter set under a name; ${WHERE_HELP}`)
    .argument("<name>", "view name, unique among your views")
    .requiredOption("--where <query>", 'filters, e.g. "due:overdue tag:research"')
    .option("--sort <field>", "rank | createdAt | dueDate | priority | updatedAt")
    .option("--order <direction>", "asc | desc")
    .option("--layout <layout>", "list | board", "list")
    .action(async (name: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const saved = await withClient(globals, async (client) => {
          const where = await resolveWhere(client, options.where);
          if (where.error) usageFailure(where.error, json);
          if (where.noSuchTag) usageFailure(`No tag named in ${options.where}.`, json);
          return client.createSavedView(
            {
              name,
              filters: {
                ...where.query,
                ...(options.sort ? { sort: options.sort } : {}),
                ...(options.order ? { order: options.order } : {}),
              },
              layout: options.layout as SavedViewLayout,
            },
            idempotency(),
          );
        });
        if (json) printJson({ ok: true, data: saved });
        else process.stdout.write(`${saved.name}  saved (${saved.layout})\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  view
    .command("delete")
    .description("Delete one of your saved views")
    .argument("<nameOrId>")
    .action(async (nameOrId: string, _options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const removed = await withClient(globals, async (client) => {
          const current = await findView(client, nameOrId);
          if (!current) usageFailure(`No view named "${nameOrId}".`, json);
          await client.deleteSavedView(current.id, idempotency());
          return current;
        });
        if (json) printJson({ ok: true, data: removed });
        else process.stdout.write(`${removed.name}  deleted\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  return view;
}

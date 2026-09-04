import { readFile } from "node:fs/promises";

import type { StatusCategory, UpdateStatusRequest } from "@morrowlist/contracts";
import { Command } from "commander";

import { formatStatusTable, printJson } from "../formatters/output.js";

import { fail, globalsOf, idempotency, withClient } from "./shared.js";

/**
 * `morrow status …` (spec 21.3): edit a project's workflow columns. The same rules the
 * board enforces apply here, because both go through the one REST API (ADR-005).
 */
export function statusCommand(): Command {
  const status = new Command("status").description("Edit a project's workflow columns");

  status
    .command("list")
    .description("List a project's columns in workflow order")
    .requiredOption("--project <id>", "project id")
    .option("--archived", "include archived columns")
    .action(async (options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const statuses = await withClient(globals, (client) =>
          client.listStatuses(options.project, {
            includeArchived: Boolean(options.archived),
          }),
        );
        if (json) printJson({ ok: true, data: statuses });
        else process.stdout.write(`${formatStatusTable(statuses)}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  status
    .command("create")
    .description("Add a column at the end of the board")
    .argument("<name...>", "column name")
    .requiredOption("--project <id>", "project id")
    .requiredOption(
      "--category <category>",
      "backlog | ready | in_progress | blocked | review | done",
    )
    .option("--color <token>", "colour token")
    .option("--wip <n>", "WIP limit")
    .option("--policy <markdown>", "column policy")
    .action(async (nameParts: string[], options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const created = await withClient(globals, (client) =>
          client.createStatus(
            options.project,
            {
              name: nameParts.join(" "),
              category: options.category as StatusCategory,
              ...(options.color ? { colorToken: options.color } : {}),
              ...(options.wip ? { wipLimit: Number(options.wip) } : {}),
              ...(options.policy ? { policyMd: options.policy } : {}),
            },
            idempotency(),
          ),
        );
        if (json) printJson({ ok: true, data: created });
        else process.stdout.write(`${created.id}  ${created.name}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  status
    .command("update")
    .description("Rename, recolour, limit, or re-categorise a column")
    .argument("<id>")
    .option("--name <name>", "new name; never changes the category")
    .option("--category <category>", "change the semantic category")
    .option("--color <token>", "colour token")
    .option("--wip <n>", "WIP limit")
    .option("--clear-wip", "remove the WIP limit")
    .option("--default", "make this the default column for new tasks")
    .option("--policy <markdown>", "column policy")
    .option("--policy-file <path>", "read the column policy (Markdown) from a file")
    .option("--clear-policy", "remove the column policy")
    .option("--expected-version <n>", "fail unless the column is still at this version")
    .action(async (id: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const policy: string | undefined = options.policyFile
          ? await readFile(options.policyFile, "utf8")
          : options.policy;
        const body: UpdateStatusRequest = {
          ...(options.name ? { name: options.name } : {}),
          ...(options.category ? { category: options.category as StatusCategory } : {}),
          ...(options.color ? { colorToken: options.color } : {}),
          ...(options.clearWip
            ? { wipLimit: null }
            : options.wip
              ? { wipLimit: Number(options.wip) }
              : {}),
          ...(options.default ? { isDefault: true } : {}),
          ...(options.clearPolicy
            ? { policyMd: null }
            : policy !== undefined
              ? { policyMd: policy }
              : {}),
          ...(options.expectedVersion
            ? { expectedVersion: Number(options.expectedVersion) }
            : {}),
        };
        const updated = await withClient(globals, (client) =>
          client.updateStatus(id, body, idempotency()),
        );
        if (json) printJson({ ok: true, data: updated });
        else process.stdout.write(`${updated.id}  ${updated.name}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  status
    .command("reorder")
    .description("Move a column between two neighbours; omit both to move it last")
    .argument("<id>")
    .option("--before <id>", "the column that should come before this one")
    .option("--after <id>", "the column that should come after this one")
    .option("--expected-version <n>", "fail unless the column is still at this version")
    .action(async (id: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const moved = await withClient(globals, (client) =>
          client.reorderStatus(
            id,
            {
              ...(options.before ? { beforeStatusId: options.before } : {}),
              ...(options.after ? { afterStatusId: options.after } : {}),
              ...(options.expectedVersion
                ? { expectedVersion: Number(options.expectedVersion) }
                : {}),
            },
            idempotency(),
          ),
        );
        if (json) printJson({ ok: true, data: moved });
        else process.stdout.write(`${moved.id}  ${moved.name}  rank ${moved.rank}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  status
    .command("archive")
    .description("Move a column's tasks to another column and archive it, atomically")
    .argument("<id>")
    .option(
      "--destination <id>",
      "where the column's tasks go; required when it has any",
    )
    .option("--new-default <id>", "the new default column when archiving the default")
    .option("--expected-version <n>", "fail unless the column is still at this version")
    .action(async (id: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const archived = await withClient(globals, (client) =>
          client.archiveStatus(
            id,
            {
              ...(options.destination
                ? { destinationStatusId: options.destination }
                : {}),
              ...(options.newDefault ? { newDefaultStatusId: options.newDefault } : {}),
              ...(options.expectedVersion
                ? { expectedVersion: Number(options.expectedVersion) }
                : {}),
            },
            idempotency(),
          ),
        );
        if (json) printJson({ ok: true, data: archived });
        else process.stdout.write(`${archived.id}  ${archived.name}  archived\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  return status;
}

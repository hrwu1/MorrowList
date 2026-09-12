import { readFile, writeFile } from "node:fs/promises";

import {
  TASK_CSV_COLUMNS,
  type ExportActivityScope,
  type ImportSource,
} from "@morrowlist/contracts";
import { fieldColumnName, formatCsv } from "@morrowlist/domain";
import { Command } from "commander";

import { formatImportPreview, printJson } from "../formatters/output.js";

import { fail, globalsOf, idempotency, usageFailure, withClient } from "./shared.js";
import { WHERE_HELP, resolveWhere } from "./where.js";

/**
 * `morrow export` and `morrow import` (CLI-001, spec 21, 30).
 *
 * Data portability from a script: back a workspace up on a cron, or move a Trello board
 * in without opening a browser. `--out` writes a file; without it the archive goes to
 * stdout so it can be piped.
 */

const ACTIVITY_SCOPES: readonly ExportActivityScope[] = ["none", "tasks", "all"];

export function exportCommand(): Command {
  const command = new Command("export")
    .description("Download the workspace as a JSON archive, or its tasks as CSV")
    .option("--out <file>", "write to a file instead of stdout")
    .option("--csv", "export the task list as CSV instead of the whole workspace")
    .option(
      "--activity <scope>",
      `how much history the archive carries: ${ACTIVITY_SCOPES.join(" | ")}`,
      "all",
    )
    .option("--where <query>", `filter the CSV; ${WHERE_HELP}`)
    .action(async (options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        if (options.where && !options.csv) {
          usageFailure("--where filters the CSV export; add --csv.", json);
        }
        if (!ACTIVITY_SCOPES.includes(options.activity)) {
          usageFailure(
            `--activity must be one of ${ACTIVITY_SCOPES.join(", ")}.`,
            json,
          );
        }

        const body = await withClient(globals, async (client) => {
          if (!options.csv) {
            const archive = await client.exportWorkspace({
              activity: options.activity as ExportActivityScope,
            });
            return `${JSON.stringify(archive, null, 2)}\n`;
          }
          const where = options.where
            ? await resolveWhere(client, options.where)
            : null;
          if (where?.error) usageFailure(where.error, json);
          if (where?.noSuchTag) {
            // A missing tag selects nothing. Keep the normal CSV columns without
            // requesting an unfiltered export of the workspace's tasks.
            const { data: fields } = await client.listFields();
            return `${formatCsv([
              [
                ...TASK_CSV_COLUMNS,
                ...fields.map((field) => fieldColumnName(field.key)),
              ],
            ])}\r\n`;
          }
          return client.exportTasksCsv(where?.query ?? {});
        });

        if (options.out) {
          await writeFile(options.out, body, "utf8");
          if (json) printJson({ ok: true, data: { file: options.out } });
          else process.stderr.write(`wrote ${options.out}\n`);
          return;
        }
        process.stdout.write(body);
      } catch (error) {
        fail(error, json);
      }
    });

  return command;
}

export function importCommand(): Command {
  const command = new Command("import").description(
    "Import a Trello board export or a CSV as a new project",
  );

  for (const source of ["trello", "csv"] as const) {
    command
      .command(source)
      .description(
        source === "trello"
          ? "Import a Trello board's JSON export"
          : "Import a CSV with a title column",
      )
      .argument("<file>", "the file to read")
      .option("--project <name>", "name for the new project")
      .option("--dry-run", "report what would happen and write nothing")
      .action(async (file: string, options, subcommand: Command) => {
        const globals = globalsOf(subcommand);
        const json = Boolean(globals.json);
        try {
          const content = await readFile(file, "utf8").catch(() => {
            usageFailure(`Cannot read ${file}.`, json);
          });

          const result = await withClient(globals, (client) =>
            client.importData(
              source as ImportSource,
              {
                content,
                ...(options.project ? { projectName: options.project } : {}),
                ...(options.dryRun ? { dryRun: true } : {}),
              },
              idempotency(),
            ),
          );

          if (json) printJson({ ok: true, data: result });
          else process.stdout.write(`${formatImportPreview(result)}\n`);
        } catch (error) {
          fail(error, json);
        }
      });
  }

  return command;
}

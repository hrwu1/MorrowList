import type { ApiClient } from "@morrowlist/api-client";
import type {
  FieldDefinitionListItemDto,
  FieldType,
  FieldValuePatchDto,
} from "@morrowlist/contracts";
import { isFieldType, FIELD_TYPES } from "@morrowlist/domain";
import { Command } from "commander";

import { formatFieldTable, printJson } from "../formatters/output.js";

import { fail, globalsOf, idempotency, usageFailure, withClient } from "./shared.js";

/**
 * `morrow field …` (GAP-24). Fields are addressed by key, which is what every other
 * surface uses too; an id is accepted for scripts.
 */

export async function findField(
  client: ApiClient,
  keyOrId: string,
): Promise<FieldDefinitionListItemDto | null> {
  const key = keyOrId
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s-]+/g, "_");
  const { data } = await client.listFields();
  return data.find((field) => field.id === keyOrId || field.key === key) ?? null;
}

/**
 * `--field key=value` and `--clear-field key` to a value patch. Values are checked
 * against the workspace's definitions on the server, so this only shapes the request;
 * an unknown key is caught here because the CLI can name it better than a 422 can.
 */
export async function fieldPatchFrom(
  client: ApiClient,
  assignments: readonly string[],
  cleared: readonly string[],
  json: boolean,
): Promise<FieldValuePatchDto | undefined> {
  if (assignments.length === 0 && cleared.length === 0) return undefined;

  const { data } = await client.listFields();
  const byKey = new Map(data.map((field) => [field.key, field]));
  const resolve = (raw: string) => {
    const key = raw
      .trim()
      .toLocaleLowerCase("en-US")
      .replace(/[\s-]+/g, "_");
    const definition = byKey.get(key);
    if (!definition) {
      usageFailure(
        `No field with the key "${key}". Run \`morrow field list\` to see them.`,
        json,
      );
    }
    return definition;
  };

  const patch: Record<string, string | number | null> = {};
  for (const assignment of assignments) {
    const separator = assignment.indexOf("=");
    if (separator <= 0) {
      usageFailure(`--field takes key=value, not "${assignment}".`, json);
    }
    const definition = resolve(assignment.slice(0, separator));
    const value = assignment.slice(separator + 1);
    patch[definition.key] = definition.type === "number" ? Number(value) : value;
  }
  for (const key of cleared) patch[resolve(key).key] = null;
  return patch;
}

export function fieldCommand(): Command {
  const field = new Command("field").description(
    "Define and manage the workspace's typed custom fields",
  );

  field
    .command("list")
    .description("List the workspace's fields with how many tasks carry a value")
    .action(async (_options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const listed = await withClient(globals, (client) => client.listFields());
        if (json) printJson({ ok: true, data: listed });
        else process.stdout.write(`${formatFieldTable(listed.data)}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  field
    .command("create")
    .description(
      `Define a field. A workspace may have at most ten; types: ${FIELD_TYPES.join(" | ")}.`,
    )
    .argument("<name...>", "field name")
    .requiredOption("-t, --type <type>", FIELD_TYPES.join(" | "))
    .option("-k, --key <key>", "identifier used in filters and the API; from the name")
    .option(
      "-o, --option <value...>",
      "an allowed value; select fields only, repeatable",
    )
    .option("--on-card", "show the value on board cards and list rows")
    .action(async (nameParts: string[], options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      if (!isFieldType(options.type)) {
        usageFailure(
          `Unknown field type "${options.type}". Use ${FIELD_TYPES.join(", ")}.`,
          json,
        );
      }
      try {
        const created = await withClient(globals, (client) =>
          client.createField(
            {
              name: nameParts.join(" "),
              type: options.type as FieldType,
              ...(options.key ? { key: options.key as string } : {}),
              ...(options.option ? { options: options.option as string[] } : {}),
              ...(options.onCard ? { showOnCard: true } : {}),
            },
            idempotency(),
          ),
        );
        if (json) printJson({ ok: true, data: created });
        else
          process.stdout.write(`${created.key}  ${created.name}  (${created.type})\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  field
    .command("update")
    .description("Rename a field, recut a select's options, or change its card flag")
    .argument("<keyOrId>")
    .option("--name <name>", "new name")
    .option("-o, --option <value...>", "replace the select's options")
    .option("--on-card", "show the value on cards")
    .option("--no-on-card", "stop showing the value on cards")
    .action(async (keyOrId: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const updated = await withClient(globals, async (client) => {
          const current = await findField(client, keyOrId);
          if (!current) usageFailure(`No field with the key "${keyOrId}".`, json);
          return client.updateField(
            current.id,
            {
              ...(options.name ? { name: options.name as string } : {}),
              ...(options.option ? { options: options.option as string[] } : {}),
              ...(options.onCard === undefined
                ? {}
                : { showOnCard: Boolean(options.onCard) }),
            },
            idempotency(),
          );
        });
        if (json) printJson({ ok: true, data: updated });
        else
          process.stdout.write(`${updated.key}  ${updated.name}  (${updated.type})\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  field
    .command("delete")
    .description(
      "Delete a field and its value on every task. The tasks themselves stay.",
    )
    .argument("<keyOrId>")
    .action(async (keyOrId: string, _options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const removed = await withClient(globals, async (client) => {
          const current = await findField(client, keyOrId);
          if (!current) usageFailure(`No field with the key "${keyOrId}".`, json);
          await client.deleteField(current.id, idempotency());
          return current;
        });
        if (json) printJson({ ok: true, data: removed });
        else
          process.stdout.write(
            `${removed.key}  deleted (cleared from ${removed.taskCount} task${removed.taskCount === 1 ? "" : "s"})\n`,
          );
      } catch (error) {
        fail(error, json);
      }
    });

  return field;
}

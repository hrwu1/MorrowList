import type { ApiClient } from "@morrowlist/api-client";
import type { TagColorToken, TagListItemDto } from "@morrowlist/contracts";
import { Command } from "commander";

import { formatTagTable, printJson } from "../formatters/output.js";

import { fail, globalsOf, idempotency, usageFailure, withClient } from "./shared.js";

/**
 * `morrow tag …` (CLI-005, spec 12.1). Tags are addressed by name, case-insensitively,
 * because that is how people think of them; an id is accepted too for scripts.
 */

/** Find a tag by id or by case-insensitive name; null when the workspace has none. */
export async function findTag(
  client: ApiClient,
  nameOrId: string,
): Promise<TagListItemDto | null> {
  const key = nameOrId.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  const { data } = await client.listTags();
  return (
    data.find(
      (tag) => tag.id === nameOrId || tag.name.toLocaleLowerCase("en-US") === key,
    ) ?? null
  );
}

/**
 * Resolve every requested tag before touching a task, creating the missing ones only when
 * asked, so a typo never half-tags a task.
 */
export async function resolveTags(
  client: ApiClient,
  names: readonly string[],
  createMissing: boolean,
  json: boolean,
): Promise<TagListItemDto[]> {
  const { data } = await client.listTags();
  const byName = new Map(data.map((tag) => [tag.name.toLocaleLowerCase("en-US"), tag]));
  const resolved: TagListItemDto[] = [];
  for (const name of names) {
    const key = name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    const existing = byName.get(key) ?? data.find((tag) => tag.id === name);
    if (existing) {
      resolved.push(existing);
      continue;
    }
    if (!createMissing) {
      usageFailure(
        `No tag named "${name}". Pass --create-tags to create it, or run \`morrow tag list\`.`,
        json,
      );
    }
    const created = await client.createTag({ name }, idempotency());
    const item = { ...created, taskCount: 0 };
    byName.set(created.name.toLocaleLowerCase("en-US"), item);
    resolved.push(item);
  }
  return resolved;
}

export function tagCommand(): Command {
  const tag = new Command("tag").description("Create and manage workspace tags");

  tag
    .command("list")
    .description("List the workspace's tags with how many tasks carry each")
    .action(async (_options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const listed = await withClient(globals, (client) => client.listTags());
        if (json) printJson({ ok: true, data: listed });
        else process.stdout.write(`${formatTagTable(listed.data)}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  tag
    .command("create")
    .description("Create a tag")
    .argument("<name...>", "tag name")
    .option(
      "-c, --color <token>",
      "neutral | red | orange | amber | green | teal | blue | violet | pink",
    )
    .option("-d, --description <text>", "what the tag is for")
    .action(async (nameParts: string[], options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const created = await withClient(globals, (client) =>
          client.createTag(
            {
              name: nameParts.join(" "),
              ...(options.color ? { colorToken: options.color as TagColorToken } : {}),
              ...(options.description ? { description: options.description } : {}),
            },
            idempotency(),
          ),
        );
        if (json) printJson({ ok: true, data: created });
        else process.stdout.write(`${created.name}  (${created.colorToken})\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  tag
    .command("update")
    .description("Rename, recolour, or describe a tag")
    .argument("<nameOrId>")
    .option("--name <name>", "new name")
    .option("-c, --color <token>", "new colour token")
    .option("-d, --description <text>", "new description")
    .option("--clear-description", "remove the description")
    .action(async (nameOrId: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const updated = await withClient(globals, async (client) => {
          const current = await findTag(client, nameOrId);
          if (!current) usageFailure(`No tag named "${nameOrId}".`, json);
          return client.updateTag(
            current.id,
            {
              ...(options.name ? { name: options.name } : {}),
              ...(options.color ? { colorToken: options.color as TagColorToken } : {}),
              ...(options.clearDescription
                ? { description: null }
                : options.description
                  ? { description: options.description }
                  : {}),
            },
            idempotency(),
          );
        });
        if (json) printJson({ ok: true, data: updated });
        else process.stdout.write(`${updated.name}  (${updated.colorToken})\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  tag
    .command("delete")
    .description("Delete a tag. Tasks keep everything else; only the label goes.")
    .argument("<nameOrId>")
    .action(async (nameOrId: string, _options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const removed = await withClient(globals, async (client) => {
          const current = await findTag(client, nameOrId);
          if (!current) usageFailure(`No tag named "${nameOrId}".`, json);
          await client.deleteTag(current.id, idempotency());
          return current;
        });
        if (json) printJson({ ok: true, data: removed });
        else
          process.stdout.write(
            `${removed.name}  deleted (removed from ${removed.taskCount} task${removed.taskCount === 1 ? "" : "s"})\n`,
          );
      } catch (error) {
        fail(error, json);
      }
    });

  for (const [name, describe, run] of [
    ["add", "Add a tag to a task", "addTaskTag"],
    ["remove", "Remove a tag from a task", "removeTaskTag"],
  ] as const) {
    tag
      .command(name)
      .description(describe)
      .argument("<idOrKey>", "task id or key, e.g. ML-000142")
      .argument("<tag>", "tag name or id")
      .option("--create-tags", "create the tag if it does not exist (add only)")
      .action(async (idOrKey: string, tagName: string, options, command: Command) => {
        const globals = globalsOf(command);
        const json = Boolean(globals.json);
        try {
          const result = await withClient(globals, async (client) => {
            const task = await client.getTask(idOrKey);
            const [target] = await resolveTags(
              client,
              [tagName],
              name === "add" && Boolean(options.createTags),
              json,
            );
            if (!target) usageFailure(`No tag named "${tagName}".`, json);
            return client[run](task.id, target.id, idempotency());
          });
          if (json) printJson({ ok: true, data: result });
          else
            process.stdout.write(
              `${result.key}  tags: ${result.tags.map((t) => t.name).join(", ") || "none"}\n`,
            );
        } catch (error) {
          fail(error, json);
        }
      });
  }

  return tag;
}

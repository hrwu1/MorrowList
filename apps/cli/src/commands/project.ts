import type { ApiClient } from "@morrowlist/api-client";
import type { ProjectDto, UpdateProjectRequest } from "@morrowlist/contracts";
import { Command } from "commander";

import { formatFlowSummary, formatProjectTable, printJson } from "../formatters/output.js";

import { fail, globalsOf, idempotency, usageFailure, withClient } from "./shared.js";

/**
 * `morrow project …` (spec 21.3, GAP-17): the project edit, archive, and restore surface,
 * plus the flow metrics. `flow` addresses a project by id, slug or case-insensitive name,
 * because a person types the name and a script has the id.
 */

async function findProject(client: ApiClient, ref: string): Promise<ProjectDto | null> {
  const key = ref.trim().toLocaleLowerCase("en-US");
  const { data } = await client.listProjects();
  return (
    data.find(
      (project) =>
        project.id === ref ||
        project.slug === key ||
        project.name.toLocaleLowerCase("en-US") === key,
    ) ?? null
  );
}

export function projectCommand(): Command {
  const project = new Command("project").description("Create and manage projects");

  project
    .command("list")
    .description("List projects")
    .option("--archived", "include archived projects")
    .action(async (options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const page = await withClient(globals, (client) =>
          client.listProjects({ includeArchived: Boolean(options.archived) }),
        );
        if (json) printJson({ ok: true, data: page });
        else process.stdout.write(`${formatProjectTable(page.data)}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  project
    .command("show")
    .description("Show a project and its workflow")
    .argument("<id>")
    .action(async (id: string, _options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const detail = await withClient(globals, (client) => client.getProject(id));
        if (json) printJson({ ok: true, data: detail });
        else
          process.stdout.write(
            `${detail.project.id}  ${detail.project.name}\n${detail.statuses
              .map((status) => `  ${status.id}  ${status.name}`)
              .join("\n")}\n`,
          );
      } catch (error) {
        fail(error, json);
      }
    });

  project
    .command("create")
    .description("Create a project with the default workflow")
    .argument("<name...>", "project name")
    .option("--color <token>", "colour token")
    .action(async (nameParts: string[], options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const detail = await withClient(globals, (client) =>
          client.createProject(
            {
              name: nameParts.join(" "),
              ...(options.color ? { colorToken: options.color } : {}),
            },
            idempotency(),
          ),
        );
        if (json) printJson({ ok: true, data: detail });
        else process.stdout.write(`${detail.project.id}  ${detail.project.name}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  project
    .command("update")
    .description("Rename or restyle a project")
    .argument("<id>")
    .option("--name <name>", "new name")
    .option("--description <markdown>", "new description")
    .option("--clear-description", "remove the description")
    .option("--color <token>", "colour token")
    .option("--icon <name>", "icon identifier")
    .option("--clear-icon", "remove the icon")
    .option(
      "--expected-version <n>",
      "fail unless the project is still at this version",
    )
    .action(async (id: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const body: UpdateProjectRequest = {
          ...(options.name ? { name: options.name } : {}),
          ...(options.clearDescription
            ? { descriptionMd: null }
            : options.description
              ? { descriptionMd: options.description }
              : {}),
          ...(options.color ? { colorToken: options.color } : {}),
          ...(options.clearIcon
            ? { icon: null }
            : options.icon
              ? { icon: options.icon }
              : {}),
          ...(options.expectedVersion
            ? { expectedVersion: Number(options.expectedVersion) }
            : {}),
        };
        const updated = await withClient(globals, (client) =>
          client.updateProject(id, body, idempotency()),
        );
        if (json) printJson({ ok: true, data: updated });
        else process.stdout.write(`${updated.id}  ${updated.name}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  for (const [name, describe, run, verb] of [
    ["archive", "Archive a project; its tasks are kept", "archiveProject", "archived"],
    ["restore", "Restore an archived project", "restoreProject", "restored"],
  ] as const) {
    project
      .command(name)
      .description(describe)
      .argument("<id>")
      .option(
        "--expected-version <n>",
        "fail unless the project is still at this version",
      )
      .action(async (id: string, options, command: Command) => {
        const globals = globalsOf(command);
        const json = Boolean(globals.json);
        try {
          const result = await withClient(globals, (client) =>
            client[run](
              id,
              options.expectedVersion ? Number(options.expectedVersion) : undefined,
              idempotency(),
            ),
          );
          if (json) printJson({ ok: true, data: result });
          else process.stdout.write(`${result.id}  ${result.name}  ${verb}\n`);
        } catch (error) {
          fail(error, json);
        }
      });
  }

  project
    .command("flow")
    .description(
      "Cycle time, lead time, throughput, WIP and aging work for a project's board",
    )
    .argument("<project>", "project id, slug or name")
    .option("--range <days>", "30, 90 or 365 days of history", "90")
    .action(async (ref: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const flow = await withClient(globals, async (client) => {
          const found = await findProject(client, ref);
          if (!found) usageFailure(`No project matching "${ref}".`, json);
          return client.getProjectFlow(found.id, { range: options.range });
        });

        if (json) printJson({ ok: true, data: flow });
        else process.stdout.write(`${formatFlowSummary(flow)}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  return project;
}

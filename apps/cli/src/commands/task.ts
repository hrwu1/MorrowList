import { randomUUID } from "node:crypto";

import { ApiClient, ApiClientError } from "@morrowlist/api-client";
import type { CreateTaskRequest } from "@morrowlist/contracts";
import { Command } from "commander";

import { readConfig, resolveProfile, type ResolveOptions } from "../config/profile.js";
import {
  EXIT,
  exitCodeFor,
  formatActivity,
  formatTaskDetail,
  formatTaskTable,
  printError,
  printJson,
} from "../formatters/output.js";

/**
 * `morrow task …` (CLI-002, CLI-003).
 *
 * The CLI is a product interface, not a debugging aid (ADR-005): it goes through the same
 * public REST API the web app uses and never touches the database.
 */

interface GlobalOptions extends ResolveOptions {
  readonly json?: boolean;
}

/**
 * Global flags live on the root command, two levels above a subcommand action. Commander
 * types `parent` loosely, so the cast is confined to this one helper.
 */
function globalsOf(command: Command): GlobalOptions {
  return ((command.parent?.parent ?? command.parent)?.opts() ?? {}) as GlobalOptions;
}

async function withClient<T>(
  options: GlobalOptions,
  fn: (client: ApiClient) => Promise<T>,
): Promise<T> {
  const config = await readConfig();
  const profile = resolveProfile(config, options);
  const client = new ApiClient({
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    workspaceId: profile.workspaceId,
  });
  return fn(client);
}

/** Every mutating command carries an idempotency key so a retry cannot duplicate it. */
function idempotency() {
  return { idempotencyKey: randomUUID() };
}

function fail(error: unknown, json: boolean): never {
  if (error instanceof ApiClientError) {
    if (json) {
      printJson({
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    } else {
      printError(`error: ${error.message}`);
      if (error.code === "TASK_VERSION_CONFLICT") {
        printError("The task changed since you loaded it. Re-read it and try again.");
      }
      if (error.requestId) printError(`request: ${error.requestId}`);
    }
    process.exit(exitCodeFor(error.code));
  }

  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    printJson({ ok: false, error: { code: "NETWORK_ERROR", message } });
  } else {
    printError(`error: ${message}`);
  }
  process.exit(EXIT.network);
}

export function taskCommand(): Command {
  const task = new Command("task").description("Create and manage tasks");

  task
    .command("add")
    .description("Capture a task. With no project it lands in your Inbox.")
    .argument("<title...>", "task title")
    .option("-d, --description <markdown>", "Markdown description")
    .option("-p, --priority <priority>", "none | low | medium | high | urgent")
    .option("--due <date>", "due date as YYYY-MM-DD")
    .option("--due-time <time>", "due time as HH:mm; requires --due")
    .option("--project <id>", "project id; omit for the Inbox")
    .option("--status <id>", "workflow status id; requires --project")
    .action(async (titleParts: string[], options, command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const body: CreateTaskRequest = {
          title: titleParts.join(" "),
          ...(options.description ? { descriptionMd: options.description } : {}),
          ...(options.priority ? { priority: options.priority } : {}),
          ...(options.due ? { dueDate: options.due } : {}),
          ...(options.dueTime ? { dueTime: options.dueTime } : {}),
          ...(options.project ? { projectId: options.project } : {}),
          ...(options.status ? { statusId: options.status } : {}),
        };
        const created = await withClient(globals, (client) =>
          client.createTask(body, idempotency()),
        );

        if (json) printJson({ ok: true, data: created });
        else process.stdout.write(`${created.key}  ${created.title}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  task
    .command("list")
    .description("List tasks")
    .option("--inbox", "Inbox tasks only")
    .option("--completed", "completed tasks only")
    .option("--project <id>", "restrict to a project")
    .option("--priority <priority>", "restrict to a priority")
    .option("--limit <n>", "page size, 1-200", "50")
    .action(async (options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const page = await withClient(globals, (client) =>
          client.listTasks({
            ...(options.inbox ? { inbox: true } : {}),
            isCompleted: Boolean(options.completed),
            ...(options.project ? { projectId: options.project } : {}),
            ...(options.priority ? { priority: options.priority } : {}),
            limit: Number(options.limit),
          } as never),
        );

        if (json) printJson({ ok: true, data: page });
        else process.stdout.write(`${formatTaskTable(page.data)}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  task
    .command("show")
    .description("Show one task by id or workspace key, e.g. ML-142")
    .argument("<idOrKey>")
    .action(async (idOrKey: string, _options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const found = await withClient(globals, (client) => client.getTask(idOrKey));
        if (json) printJson({ ok: true, data: found });
        else process.stdout.write(`${formatTaskDetail(found)}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  task
    .command("history")
    .description("Show a task's history, newest first")
    .argument("<idOrKey>")
    .option("--limit <n>", "page size, 1-200", "50")
    .option("--cursor <cursor>", "continue from a previous page's nextCursor")
    .action(async (idOrKey: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const page = await withClient(globals, (client) =>
          client.listTaskActivity(idOrKey, {
            limit: Number(options.limit),
            ...(options.cursor ? { cursor: options.cursor } : {}),
          }),
        );

        if (json) printJson({ ok: true, data: page });
        else {
          process.stdout.write(`${formatActivity(page.data)}\n`);
          if (page.page.nextCursor) {
            printError(`more: --cursor ${page.page.nextCursor}`);
          }
        }
      } catch (error) {
        fail(error, json);
      }
    });

  task
    .command("update")
    .description("Update task fields")
    .argument("<idOrKey>")
    .option("--title <title>", "new title")
    .option("--description <markdown>", "new description")
    .option("--clear-description", "remove the description")
    .option("-p, --priority <priority>", "none | low | medium | high | urgent")
    .option("--due <date>", "due date as YYYY-MM-DD")
    .option("--clear-due", "remove the due date")
    .option("--expected-version <n>", "fail unless the task is still at this version")
    .action(async (idOrKey: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const updated = await withClient(globals, async (client) => {
          const current = await client.getTask(idOrKey);
          return client.updateTask(
            current.id,
            {
              ...(options.title ? { title: options.title } : {}),
              // An explicit clear flag is how the CLI expresses null, which the API
              // distinguishes from an omitted field (spec 20.4).
              ...(options.clearDescription
                ? { descriptionMd: null }
                : options.description
                  ? { descriptionMd: options.description }
                  : {}),
              ...(options.priority ? { priority: options.priority } : {}),
              ...(options.clearDue
                ? { dueDate: null }
                : options.due
                  ? { dueDate: options.due }
                  : {}),
              ...(options.expectedVersion
                ? { expectedVersion: Number(options.expectedVersion) }
                : {}),
            },
            idempotency(),
          );
        });

        if (json) printJson({ ok: true, data: updated });
        else process.stdout.write(`${updated.key}  ${updated.title}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  for (const [name, describe, run] of [
    ["complete", "Complete a task", "completeTask"],
    ["reopen", "Reopen a completed task", "reopenTask"],
  ] as const) {
    task
      .command(name)
      .description(describe)
      .argument("<idOrKey>")
      .option("--expected-version <n>", "fail unless the task is still at this version")
      .action(async (idOrKey: string, options, command: Command) => {
        const globals = globalsOf(command);
        const json = Boolean(globals.json);
        try {
          const result = await withClient(globals, async (client) => {
            const current = await client.getTask(idOrKey);
            const expected = options.expectedVersion
              ? Number(options.expectedVersion)
              : current.version;
            return client[run](current.id, expected, idempotency());
          });

          if (json) printJson({ ok: true, data: result });
          else
            process.stdout.write(
              `${result.key}  ${result.isCompleted ? "completed" : "reopened"}\n`,
            );
        } catch (error) {
          fail(error, json);
        }
      });
  }

  task
    .command("delete")
    .description("Move a task to Trash")
    .argument("<idOrKey>")
    .action(async (idOrKey: string, _options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const deleted = await withClient(globals, async (client) => {
          const current = await client.getTask(idOrKey);
          return client.deleteTask(current.id, idempotency());
        });

        if (json) printJson({ ok: true, data: deleted });
        else process.stdout.write(`${deleted.key}  moved to Trash\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  return task;
}

import { ApiClientError } from "@morrowlist/api-client";
import type { CreateTaskRequest, UpdateTaskRequest } from "@morrowlist/contracts";
import { Command } from "commander";

import {
  formatActivity,
  formatTaskDetail,
  formatTaskTable,
  printError,
  printJson,
} from "../formatters/output.js";

import {
  fail,
  globalsOf,
  idempotency,
  recurrenceFromPhrase,
  withClient,
} from "./shared.js";
import { findTag, resolveTags } from "./tag.js";

/**
 * `morrow task …` (CLI-002, CLI-003).
 *
 * The CLI is a product interface, not a debugging aid (ADR-005): it goes through the same
 * public REST API the web app uses and never touches the database.
 */

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
    .option(
      "--parent <idOrKey>",
      "make it a subtask of this task; it joins the parent's project unless --project is given",
    )
    .option(
      "-t, --tag <name>",
      "tag to apply; repeatable",
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option("--create-tags", "create any --tag that does not exist yet")
    .option(
      "--every <phrase>",
      'repeat, e.g. "day", "2 weeks on mon,thu", "month on 31", "year"; a bare "week" or "month" uses the due date',
    )
    .option(
      "--after-completion",
      "count the next occurrence from the completion date rather than the due date",
    )
    .action(async (titleParts: string[], options, command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const recurrence = options.every
          ? recurrenceFromPhrase(
              options.every,
              options.due,
              Boolean(options.afterCompletion),
              json,
            )
          : null;
        const created = await withClient(globals, async (client) => {
          // Tags are resolved before the task exists so an unknown name fails cleanly.
          const tags = await resolveTags(
            client,
            options.tag as string[],
            Boolean(options.createTags),
            json,
          );
          const body: CreateTaskRequest = {
            title: titleParts.join(" "),
            ...(options.description ? { descriptionMd: options.description } : {}),
            ...(options.priority ? { priority: options.priority } : {}),
            ...(options.due ? { dueDate: options.due } : {}),
            ...(options.dueTime ? { dueTime: options.dueTime } : {}),
            ...(options.project ? { projectId: options.project } : {}),
            ...(options.status ? { statusId: options.status } : {}),
            ...(options.parent
              ? { parentTaskId: (await client.getTask(options.parent)).id }
              : {}),
            ...(recurrence ? { recurrence } : {}),
          };
          let task = await client.createTask(body, idempotency());
          for (const tag of tags) {
            task = await client.addTaskTag(task.id, tag.id, idempotency());
          }
          return task;
        });

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
    .option("--due <filter>", "overdue | today | future | none")
    .option("--tag <name>", "restrict to tasks carrying a tag")
    .option("--blocked", "blocked tasks only: flagged, or waiting on an open blocker")
    .option("--limit <n>", "page size, 1-200", "50")
    .action(async (options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const page = await withClient(globals, async (client) => {
          const tag = options.tag ? await findTag(client, options.tag) : null;
          if (options.tag && !tag) {
            return { data: [], page: { nextCursor: null, hasMore: false } };
          }
          return client.listTasks({
            ...(options.inbox ? { inbox: true } : {}),
            isCompleted: Boolean(options.completed),
            ...(options.project ? { projectId: options.project } : {}),
            ...(options.priority ? { priority: options.priority } : {}),
            ...(options.due ? { due: options.due } : {}),
            ...(tag ? { tagId: tag.id } : {}),
            ...(options.blocked ? { isBlocked: true } : {}),
            limit: Number(options.limit),
          } as never);
        });

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
        const { found, children } = await withClient(globals, async (client) => {
          const task = await client.getTask(idOrKey);
          // Subtasks are ordinary tasks filtered by parent (spec 8.3).
          const page = task.subtaskProgress
            ? await client.listTasks({ parentTaskId: task.id, limit: 200 })
            : { data: [] };
          return { found: task, children: page.data };
        });
        if (json) printJson({ ok: true, data: { ...found, subtasks: children } });
        else process.stdout.write(`${formatTaskDetail(found, children)}\n`);
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
    .option("--parent <idOrKey>", "make it a subtask of this task")
    .option("--no-parent", "detach it from its parent")
    .option(
      "--every <phrase>",
      'repeat, e.g. "day", "2 weeks on mon,thu", "month on 31"',
    )
    .option("--after-completion", "count from the completion date; used with --every")
    .option("--no-repeat", "stop repeating; this occurrence stays as it is")
    .option("--expected-version <n>", "fail unless the task is still at this version")
    .action(async (idOrKey: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const updated = await withClient(globals, async (client) => {
          const current = await client.getTask(idOrKey);
          const recurrence =
            options.repeat === false
              ? null
              : options.every
                ? recurrenceFromPhrase(
                    options.every,
                    options.due ?? current.dueDate,
                    Boolean(options.afterCompletion),
                    json,
                  )
                : undefined;
          const expectedVersion = options.expectedVersion
            ? Number(options.expectedVersion)
            : undefined;

          // Parent changes are their own command on the API; run them first so a field
          // patch in the same invocation sees the bumped version.
          let version = expectedVersion;
          if (options.parent === false) {
            version = (await client.clearTaskParent(current.id, version, idempotency()))
              .version;
          } else if (typeof options.parent === "string") {
            const parent = await client.getTask(options.parent);
            version = (
              await client.setTaskParent(
                current.id,
                {
                  parentTaskId: parent.id,
                  ...(version ? { expectedVersion: version } : {}),
                },
                idempotency(),
              )
            ).version;
          }

          const fields: UpdateTaskRequest = {
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
            ...(recurrence !== undefined ? { recurrence } : {}),
          };
          if (Object.keys(fields).length === 0) return client.getTask(current.id);
          return client.updateTask(
            current.id,
            { ...fields, ...(version ? { expectedVersion: version } : {}) },
            idempotency(),
          );
        });

        if (json) printJson({ ok: true, data: updated });
        else process.stdout.write(`${updated.key}  ${updated.title}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  task
    .command("complete")
    .description("Complete a task")
    .argument("<idOrKey>")
    .option("--expected-version <n>", "fail unless the task is still at this version")
    .option(
      "--acknowledge-blocked",
      "complete even though the task is blocked (spec 8.4 warns, never forbids)",
    )
    .action(async (idOrKey: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const result = await withClient(globals, async (client) => {
          const current = await client.getTask(idOrKey);
          const expectedVersion = options.expectedVersion
            ? Number(options.expectedVersion)
            : current.version;
          return client.completeTask(
            current.id,
            {
              expectedVersion,
              ...(options.acknowledgeBlocked ? { acknowledgeBlocked: true } : {}),
            },
            idempotency(),
          );
        });

        if (json) printJson({ ok: true, data: result });
        else process.stdout.write(`${result.key}  completed\n`);
      } catch (error) {
        if (error instanceof ApiClientError && error.code === "TASK_BLOCKED" && !json) {
          printError(
            "The task is blocked. Pass --acknowledge-blocked to complete it anyway.",
          );
        }
        fail(error, json);
      }
    });

  task
    .command("reopen")
    .description("Reopen a completed task")
    .argument("<idOrKey>")
    .option("--expected-version <n>", "fail unless the task is still at this version")
    .action(async (idOrKey: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const { task: result, warnings } = await withClient(globals, async (client) => {
          const current = await client.getTask(idOrKey);
          const expected = options.expectedVersion
            ? Number(options.expectedVersion)
            : current.version;
          return client.reopenTask(current.id, expected, idempotency());
        });

        if (json) printJson({ ok: true, data: result, warnings });
        else {
          process.stdout.write(`${result.key}  reopened\n`);
          // Warnings go to stderr so `--json` and piped stdout stay clean (spec 21.5).
          for (const warning of warnings) printError(`warning: ${warning.message}`);
        }
      } catch (error) {
        fail(error, json);
      }
    });

  task
    .command("block")
    .description("Flag a task as blocked; it stays in its stage and says why")
    .argument("<idOrKey>")
    .requiredOption("--reason <text>", "why the task cannot move")
    .option("--expected-version <n>", "fail unless the task is still at this version")
    .action(async (idOrKey: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const result = await withClient(globals, async (client) => {
          const current = await client.getTask(idOrKey);
          return client.setTaskBlocked(
            current.id,
            {
              reason: options.reason,
              ...(options.expectedVersion
                ? { expectedVersion: Number(options.expectedVersion) }
                : {}),
            },
            idempotency(),
          );
        });

        if (json) printJson({ ok: true, data: result });
        else
          process.stdout.write(`${result.key}  blocked: ${result.blocked?.reason}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  task
    .command("unblock")
    .description("Clear a task's blocked flag")
    .argument("<idOrKey>")
    .option("--expected-version <n>", "fail unless the task is still at this version")
    .action(async (idOrKey: string, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const result = await withClient(globals, async (client) => {
          const current = await client.getTask(idOrKey);
          return client.clearTaskBlocked(
            current.id,
            options.expectedVersion ? Number(options.expectedVersion) : undefined,
            idempotency(),
          );
        });

        if (json) printJson({ ok: true, data: result });
        else process.stdout.write(`${result.key}  unblocked\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  task
    .command("skip")
    .description("Skip the current occurrence of a repeating task")
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
          return client.skipOccurrence(current.id, expected, idempotency());
        });

        if (json) printJson({ ok: true, data: result });
        else process.stdout.write(`${result.key}  next due ${result.dueDate}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

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

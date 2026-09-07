import type { ApiClient } from "@morrowlist/api-client";
import { ApiClientError } from "@morrowlist/api-client";
import type {
  BatchOperation,
  BatchTasksResult,
  CreateTaskRequest,
  UpdateTaskRequest,
} from "@morrowlist/contracts";
import { parseFieldFilter } from "@morrowlist/domain";
import { Command } from "commander";

import {
  formatActivity,
  formatTaskDetail,
  formatTaskTable,
  printError,
  printJson,
} from "../formatters/output.js";

import {
  capture,
  captureContext,
  captureFields,
  captureReport,
  projectIdFor,
} from "./capture.js";
import { fieldPatchFrom } from "./field.js";
import {
  BULK_LIMIT,
  assertBulkConfirmed,
  fail,
  formatBulkPlan,
  formatBulkResult,
  globalsOf,
  idempotency,
  recurrenceFromPhrase,
  usageFailure,
  withClient,
  type BulkOptions,
} from "./shared.js";
import { findTag, resolveTags } from "./tag.js";
import { WHERE_HELP, bulkTargets, resolveWhere } from "./where.js";

/**
 * `morrow task …` (CLI-002, CLI-003).
 *
 * The CLI is a product interface, not a debugging aid (ADR-005): it goes through the same
 * public REST API the web app uses and never touches the database.
 */

/**
 * Commander maps `--remind 60` to "60", `--no-remind` to false, and neither to undefined
 * (which leaves the reminder alone, or applies the default when a due time is first set).
 */
function reminderOption(
  remind: string | boolean | undefined,
): Pick<UpdateTaskRequest, "reminderOffsetMinutes"> {
  if (remind === undefined || remind === true) return {};
  if (remind === false) return { reminderOffsetMinutes: null };
  return { reminderOffsetMinutes: Number(remind) };
}

/**
 * `--where` bulk plumbing (GAP-08). The selection is resolved, confirmed, and then sent
 * as one batch: the server applies it in a single transaction, so a partial result is not
 * a thing the CLI ever has to explain (spec 10.4).
 */
type BulkOutcome =
  | { readonly kind: "plan"; readonly text: string }
  | { readonly kind: "applied"; readonly result: BatchTasksResult };

async function runBulk(
  client: ApiClient,
  options: BulkOptions,
  json: boolean,
  verb: string,
  toOperation: (taskId: string, version: number) => BatchOperation,
): Promise<BulkOutcome> {
  const { tasks, error } = await bulkTargets(client, options.where ?? "", BULK_LIMIT);
  if (error) usageFailure(error, json);
  assertBulkConfirmed(tasks, options, json);
  if (options.dryRun) return { kind: "plan", text: formatBulkPlan(verb, tasks) };

  return {
    kind: "applied",
    result: await client.batchTasks(
      { operations: tasks.map((task) => toOperation(task.id, task.version)) },
      idempotency(),
    ),
  };
}

/** Print a bulk outcome, or fall through to the single-task path when there was none. */
function reportBulk(outcome: BulkOutcome, verb: string, json: boolean): void {
  if (outcome.kind === "plan") {
    if (json) printJson({ ok: true, data: { dryRun: true, plan: outcome.text } });
    else process.stdout.write(`${outcome.text}\n`);
    return;
  }
  if (json) {
    printJson({
      ok: true,
      data: outcome.result.data,
      warnings: outcome.result.warnings,
    });
  } else {
    process.stdout.write(`${formatBulkResult(verb, outcome.result.data)}\n`);
    for (const warning of outcome.result.warnings) {
      printError(`warning: ${warning.message}`);
    }
  }
}

const BULK_WHERE_HELP = `apply to every task matching this query instead of one task; ${WHERE_HELP}`;

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
    .option(
      "--defer <date>",
      "hide it from Today, Upcoming, and the Inbox until YYYY-MM-DD",
    )
    .option("--deadline <date>", "hard deadline as YYYY-MM-DD")
    .option("--deadline-time <time>", "deadline time as HH:mm; requires --deadline")
    .option(
      "--remind <minutes>",
      "remind this many minutes before the due time (default 30 with --due-time)",
    )
    .option("--no-remind", "no reminder")
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
    .option(
      "--literal",
      'take the text exactly as typed, reading no "tomorrow 5pm p1 #project @tag" out of it',
    )
    .action(async (titleParts: string[], options, command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      const text = titleParts.join(" ");
      try {
        const recurrence = options.every
          ? recurrenceFromPhrase(
              options.every,
              options.due,
              Boolean(options.afterCompletion),
              json,
            )
          : null;
        const { created, parsed } = await withClient(globals, async (client) => {
          const createTags = Boolean(options.createTags);
          // Quick add's grammar, read here too so a phrase means one thing (GAP-15).
          const context = await captureContext(
            client,
            options.literal ? "" : text,
            createTags,
          );
          const parse = options.literal ? null : capture(text, context);
          const projectId = projectIdFor(context, parse?.projectName ?? null);
          // Tags are resolved before the task exists so an unknown name fails cleanly.
          const tags = await resolveTags(
            client,
            [...(options.tag as string[]), ...(parse?.tagNames ?? [])],
            createTags,
            json,
          );
          const body: CreateTaskRequest = {
            title: parse ? parse.title : text,
            ...(parse ? captureFields(parse) : {}),
            ...(projectId ? { projectId } : {}),
            // An explicit flag is exact, so it wins over anything read from the text.
            ...(options.description ? { descriptionMd: options.description } : {}),
            ...(options.priority ? { priority: options.priority } : {}),
            ...(options.due ? { dueDate: options.due } : {}),
            ...(options.dueTime ? { dueTime: options.dueTime } : {}),
            ...(options.defer ? { deferUntil: options.defer } : {}),
            ...(options.deadline ? { deadline: options.deadline } : {}),
            ...(options.deadlineTime ? { deadlineTime: options.deadlineTime } : {}),
            ...reminderOption(options.remind),
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
          return { created: task, parsed: parse };
        });

        if (json) {
          printJson({
            ok: true,
            data: created,
            ...(parsed ? { parsed: captureReport(parsed) } : {}),
          });
        } else process.stdout.write(`${created.key}  ${created.title}\n`);
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
    .option("--deferred", "deferred tasks only: those hidden until a later day")
    .option("--deadline <filter>", "overdue | week | none")
    .option("--tag <name>", "restrict to tasks carrying a tag")
    .option("--blocked", "blocked tasks only: flagged, or waiting on an open blocker")
    .option(
      "--field <filter...>",
      "a typed custom field, as key:operator[:value], e.g. --field effort:gt:3",
    )
    .option("--where <query>", `filters in the search grammar; ${WHERE_HELP}`)
    .option("--limit <n>", "page size, 1-200", "50")
    .action(async (options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const page = await withClient(globals, async (client) => {
          const tag = options.tag ? await findTag(client, options.tag) : null;
          const where = options.where
            ? await resolveWhere(client, options.where)
            : { query: {}, noSuchTag: false, error: null };
          if (where.error) usageFailure(where.error, json);
          if ((options.tag && !tag) || where.noSuchTag) {
            return { data: [], page: { nextCursor: null, hasMore: false } };
          }
          // Flags first, then --where: an operator overrides the flag it duplicates,
          // the same precedence the search endpoint applies.
          return client.listTasks({
            ...(options.inbox ? { inbox: true } : {}),
            isCompleted: Boolean(options.completed),
            ...(options.project ? { projectId: options.project } : {}),
            ...(options.priority ? { priority: options.priority } : {}),
            ...(options.due ? { due: options.due } : {}),
            ...(options.deferred ? { deferred: true } : {}),
            ...(options.deadline ? { deadline: options.deadline } : {}),
            ...(tag ? { tagId: tag.id } : {}),
            ...(options.blocked ? { isBlocked: true } : {}),
            ...(options.field
              ? { fields: (options.field as string[]).map(parseFieldFilter) }
              : {}),
            ...where.query,
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
    .description("Show one task by id or workspace key, e.g. ML-000142")
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
    .option("--due-time <time>", "due time as HH:mm; requires a due date")
    .option("--clear-due", "remove the due date")
    .option("--defer <date>", "hide it until YYYY-MM-DD")
    .option("--clear-defer", "remove the defer date")
    .option("--deadline <date>", "hard deadline as YYYY-MM-DD")
    .option("--deadline-time <time>", "deadline time as HH:mm; requires a deadline")
    .option("--clear-deadline", "remove the deadline and its time")
    .option("--remind <minutes>", "remind this many minutes before the due time")
    .option("--no-remind", "remove the reminder")
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

          const customFields = await fieldPatchFrom(
            client,
            (options.field ?? []) as string[],
            (options.clearField ?? []) as string[],
            json,
          );

          const fields: UpdateTaskRequest = {
            ...(customFields ? { fields: customFields } : {}),
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
            ...(options.dueTime ? { dueTime: options.dueTime } : {}),
            ...reminderOption(options.remind),
            ...(recurrence !== undefined ? { recurrence } : {}),
            ...(options.clearDefer
              ? { deferUntil: null }
              : options.defer
                ? { deferUntil: options.defer }
                : {}),
            ...(options.clearDeadline
              ? { deadline: null }
              : {
                  ...(options.deadline ? { deadline: options.deadline } : {}),
                  ...(options.deadlineTime
                    ? { deadlineTime: options.deadlineTime }
                    : {}),
                }),
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
    .description("Complete a task, or every task matching --where")
    .argument("[idOrKey]")
    .option("--expected-version <n>", "fail unless the task is still at this version")
    .option(
      "--acknowledge-blocked",
      "complete even though the task is blocked (spec 8.4 warns, never forbids)",
    )
    .option("--where <query>", BULK_WHERE_HELP)
    .option("--yes", "confirm a --where bulk change")
    .option("--dry-run", "list what --where would change and stop")
    .action(async (idOrKey: string | undefined, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        if (options.where) {
          const outcome = await withClient(globals, (client) =>
            runBulk(client, options, json, "completed", (taskId, version) => ({
              op: "complete",
              taskId,
              expectedVersion: version,
              ...(options.acknowledgeBlocked ? { acknowledgeBlocked: true } : {}),
            })),
          );
          reportBulk(outcome, "completed", json);
          return;
        }
        if (!idOrKey) usageFailure("Name a task, or select some with --where.", json);

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
    .description("Move a task to Trash, or every task matching --where")
    .argument("[idOrKey]")
    .option("--where <query>", BULK_WHERE_HELP)
    .option("--yes", "confirm a --where bulk change")
    .option("--dry-run", "list what --where would change and stop")
    .action(async (idOrKey: string | undefined, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        if (options.where) {
          const outcome = await withClient(globals, (client) =>
            runBulk(client, options, json, "trashed", (taskId, version) => ({
              op: "delete",
              taskId,
              expectedVersion: version,
            })),
          );
          reportBulk(outcome, "trashed", json);
          return;
        }
        if (!idOrKey) usageFailure("Name a task, or select some with --where.", json);

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

  task
    .command("move")
    .description("Move a task, or every task matching --where, to a project status")
    .argument("[idOrKey]")
    .option("--project <id>", "destination project id")
    .option("--status <id>", "destination workflow status id; requires --project")
    .option("--inbox", "move back to the Inbox instead of a project")
    .option("--expected-version <n>", "fail unless the task is still at this version")
    .option("--where <query>", BULK_WHERE_HELP)
    .option("--yes", "confirm a --where bulk change")
    .option("--dry-run", "list what --where would change and stop")
    .action(async (idOrKey: string | undefined, options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      // Null is the Inbox (spec 11.5), which is not the same as "no destination given".
      if (!options.inbox && !options.project) {
        usageFailure("Give a destination: --project <id>, or --inbox.", json);
      }
      if (options.inbox && (options.project || options.status)) {
        usageFailure("--inbox takes no --project or --status.", json);
      }
      const destination = {
        projectId: options.inbox ? null : (options.project as string),
        ...(options.status ? { statusId: options.status as string } : {}),
      };

      try {
        if (options.where) {
          const outcome = await withClient(globals, (client) =>
            runBulk(client, options, json, "moved", (taskId, version) => ({
              op: "move",
              taskId,
              expectedVersion: version,
              ...destination,
            })),
          );
          reportBulk(outcome, "moved", json);
          return;
        }
        if (!idOrKey) usageFailure("Name a task, or select some with --where.", json);

        const { task: moved, warnings } = await withClient(globals, async (client) => {
          const current = await client.getTask(idOrKey);
          return client.moveTask(
            current.id,
            {
              ...destination,
              expectedVersion: options.expectedVersion
                ? Number(options.expectedVersion)
                : current.version,
            },
            idempotency(),
          );
        });

        if (json) printJson({ ok: true, data: moved, warnings });
        else {
          process.stdout.write(`${moved.key}  moved\n`);
          for (const warning of warnings) printError(`warning: ${warning.message}`);
        }
      } catch (error) {
        fail(error, json);
      }
    });

  return task;
}

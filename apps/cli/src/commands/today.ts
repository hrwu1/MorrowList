import { randomUUID } from "node:crypto";

import { ApiClient, ApiClientError } from "@morrowlist/api-client";
import { Command } from "commander";

import { readConfig, resolveProfile, type ResolveOptions } from "../config/profile.js";
import {
  EXIT,
  exitCodeFor,
  formatTodayView,
  printError,
  printJson,
} from "../formatters/output.js";

/**
 * `morrow today …` (spec 21.3): the daily loop from the terminal. `list` is the same
 * projection the web Today view renders; `add` and `remove` are the My Day commands.
 */

interface GlobalOptions extends ResolveOptions {
  readonly json?: boolean;
}

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

export function todayCommand(): Command {
  const today = new Command("today").description("Plan and review today's work");

  today
    .command("list")
    .description(
      "Show overdue, due-today, and My Day tasks, plus yesterday's leftovers",
    )
    .option("--date <date>", "show another day as YYYY-MM-DD")
    .action(async (options, command: Command) => {
      const globals = globalsOf(command);
      const json = Boolean(globals.json);
      try {
        const view = await withClient(globals, (client) =>
          client.getTodayView(options.date ? { date: options.date } : {}),
        );

        if (json) printJson({ ok: true, data: view.data });
        else process.stdout.write(`${formatTodayView(view.data)}\n`);
      } catch (error) {
        fail(error, json);
      }
    });

  for (const [name, describe, verb] of [
    ["add", "Add a task to My Day", "added to"],
    ["remove", "Remove a task from My Day", "removed from"],
  ] as const) {
    today
      .command(name)
      .description(describe)
      .argument("<idOrKey>", "task id or workspace key, e.g. ML-142")
      .option("--date <date>", "a day other than today, as YYYY-MM-DD")
      .action(async (idOrKey: string, options, command: Command) => {
        const globals = globalsOf(command);
        const json = Boolean(globals.json);
        try {
          const task = await withClient(globals, async (client) => {
            const current = await client.getTask(idOrKey);
            const request = { idempotencyKey: randomUUID() };
            if (name === "add") {
              return client.addTaskToDay(
                current.id,
                options.date ? { date: options.date } : {},
                request,
              );
            }
            // Without a date, remove today's selection: the first upcoming plan.
            const date: string | undefined = options.date ?? current.dayPlans[0];
            if (!date) return current;
            return client.removeTaskFromDay(current.id, date, request);
          });

          if (json) printJson({ ok: true, data: task });
          else process.stdout.write(`${task.key}  ${verb} My Day\n`);
        } catch (error) {
          fail(error, json);
        }
      });
  }

  return today;
}

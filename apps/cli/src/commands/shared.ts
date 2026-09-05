import { randomUUID } from "node:crypto";

import { ApiClient, ApiClientError } from "@morrowlist/api-client";
import type {
  BatchResultItemDto,
  RecurrenceRuleDto,
  TaskDto,
} from "@morrowlist/contracts";
import { MAX_BATCH_OPERATIONS } from "@morrowlist/contracts";
import { parseRecurrencePhrase, weekdayOf, type PlainDate } from "@morrowlist/domain";
import type { Command } from "commander";

import { readConfig, resolveProfile, type ResolveOptions } from "../config/profile.js";
import { EXIT, exitCodeFor, printError, printJson } from "../formatters/output.js";

/** Plumbing shared by the resource commands: profile resolution, output, and exit codes. */

export interface GlobalOptions extends ResolveOptions {
  readonly json?: boolean;
}

/**
 * Global flags live on the root command, two levels above a subcommand action. Commander
 * types `parent` loosely, so the cast is confined to this one helper.
 */
export function globalsOf(command: Command): GlobalOptions {
  return ((command.parent?.parent ?? command.parent)?.opts() ?? {}) as GlobalOptions;
}

export async function withClient<T>(
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
export function idempotency() {
  return { idempotencyKey: randomUUID() };
}

export function fail(error: unknown, json: boolean): never {
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

/**
 * `--every <phrase>` to a recurrence rule (GAP-12). A bare `week` or `month` falls on
 * the due date's weekday or day of month, or today's when there is no due date.
 */
export function recurrenceFromPhrase(
  phrase: string,
  dueDate: string | null | undefined,
  afterCompletion: boolean,
  json: boolean,
): RecurrenceRuleDto {
  const anchor = (dueDate ?? new Date().toISOString().slice(0, 10)) as PlainDate;
  const rule = parseRecurrencePhrase(phrase, {
    defaultWeekday: weekdayOf(anchor),
    defaultMonthDay: Number(anchor.slice(8, 10)),
    mode: afterCompletion ? "after_completion" : "schedule",
  });
  if (!rule) {
    usageFailure(
      `Cannot read "--every ${phrase}". Try "day", "2 weeks on mon,thu", "weekdays", "month on 31", "month on last fri", "year", "week until 2026-12-31", or "day for 10 times".`,
      json,
    );
  }
  return { ...rule, weekdays: rule.weekdays ? [...rule.weekdays] : null };
}

/** A usage-level failure the API was never asked about, such as an unknown tag name. */
export function usageFailure(message: string, json: boolean): never {
  if (json) printJson({ ok: false, error: { code: "USAGE", message } });
  else printError(`error: ${message}`);
  process.exit(EXIT.usage);
}

/**
 * Bulk commands (GAP-08, spec 10.4). `--where` picks the tasks with the same operator
 * grammar `task list` accepts, `--dry-run` prints what would change and touches nothing,
 * and `--yes` is the deliberate confirmation: a scripted bulk edit should never happen by
 * a typo in a query. The server applies the whole selection in one transaction, so the
 * answer is all of it or none of it.
 */
export interface BulkOptions {
  readonly where?: string | undefined;
  readonly yes?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
}

export const BULK_LIMIT = MAX_BATCH_OPERATIONS;

/**
 * Refuse to run unless the selection is non-empty, within the batch limit, and confirmed.
 * `--dry-run` skips the confirmation because it changes nothing.
 */
export function assertBulkConfirmed(
  tasks: readonly TaskDto[],
  options: BulkOptions,
  json: boolean,
): void {
  if (tasks.length === 0) {
    usageFailure("No task matches --where; nothing to do.", json);
  }
  if (tasks.length > BULK_LIMIT) {
    usageFailure(
      `--where matches ${tasks.length} tasks; one batch takes at most ${BULK_LIMIT}. Narrow the query.`,
      json,
    );
  }
  if (!options.dryRun && !options.yes) {
    usageFailure(
      `--where matches ${tasks.length} task${tasks.length === 1 ? "" : "s"}; pass --yes to apply, or --dry-run to list them.`,
      json,
    );
  }
}

/** What a `--dry-run` prints: the verb and the tasks it would have been applied to. */
export function formatBulkPlan(verb: string, tasks: readonly TaskDto[]): string {
  return [
    `Would ${verb} ${tasks.length} task${tasks.length === 1 ? "" : "s"}:`,
    ...tasks.map((task) => `  ${task.key}  ${task.title}`),
  ].join("\n");
}

/** What a completed batch prints: one line per entry, in the order it was applied. */
export function formatBulkResult(
  verb: string,
  items: readonly BatchResultItemDto[],
): string {
  return [
    ...items.map((item) => `${item.data.key}  ${verb}`),
    `${items.length} task${items.length === 1 ? "" : "s"} ${verb}.`,
  ].join("\n");
}

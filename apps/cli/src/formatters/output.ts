import type {
  ActivityEntryDto,
  TaskDto,
  TodayReason,
  TodayViewDto,
} from "@morrowlist/contracts";

/**
 * Output envelope and exit codes (spec 21.5, 21.6).
 *
 * Machine-readable output goes to stdout and stays parseable; human progress and errors
 * go to stderr, so `morrow task list --json | jq` works without filtering.
 */

export const EXIT = {
  success: 0,
  usage: 2,
  authentication: 3,
  notFound: 4,
  conflict: 5,
  validation: 6,
  server: 7,
  network: 8,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** Stable JSON envelope; consumers may ignore unknown fields (spec 20.1). */
export interface JsonEnvelope<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
}

export function printJson<T>(envelope: JsonEnvelope<T>): void {
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

export function printError(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** Map an API error code to a shell-meaningful exit code (spec 21.6). */
export function exitCodeFor(errorCode: string): ExitCode {
  switch (errorCode) {
    case "AUTH_REQUIRED":
    case "AUTH_FORBIDDEN":
      return EXIT.authentication;
    case "TASK_NOT_FOUND":
    case "PROJECT_NOT_FOUND":
    case "STATUS_NOT_FOUND":
    case "WORKSPACE_NOT_FOUND":
    case "NOT_FOUND":
      return EXIT.notFound;
    case "TASK_VERSION_CONFLICT":
    case "IDEMPOTENCY_KEY_REUSED":
    case "STATUS_ARCHIVE_REQUIRES_DESTINATION":
      return EXIT.conflict;
    case "VALIDATION_FAILED":
    case "TASK_INVALID_STATUS":
    case "TASK_NESTING_LIMIT_EXCEEDED":
    case "TASK_RELATION_CYCLE":
      return EXIT.validation;
    default:
      return EXIT.server;
  }
}

const PRIORITY_MARK: Record<string, string> = {
  none: "  ",
  low: "· ",
  medium: "◦ ",
  high: "▲ ",
  urgent: "! ",
};

/** Human-readable task table. Aligned on the task key, which is the stable handle. */
export function formatTaskTable(tasks: readonly TaskDto[]): string {
  if (tasks.length === 0) return "No tasks.";

  const keyWidth = Math.max(...tasks.map((task) => task.key.length));
  return tasks
    .map((task) => {
      const done = task.isCompleted ? "x" : " ";
      const key = task.key.padEnd(keyWidth);
      const mark = PRIORITY_MARK[task.priority] ?? "  ";
      const due = task.dueDate ? `  (due ${task.dueDate})` : "";
      return `[${done}] ${key}  ${mark}${task.title}${due}`;
    })
    .join("\n");
}

/**
 * Human-readable history, newest first: when, who, what, then the readable field diffs
 * indented beneath. Raw payloads never print here; `--json` carries them (spec 26.2).
 */
export function formatActivity(entries: readonly ActivityEntryDto[]): string {
  if (entries.length === 0) return "No activity.";

  return entries
    .map((entry) => {
      const actor =
        entry.actorDisplayName ??
        (entry.actorKind === "user" ? "user" : entry.actorKind.replace("_", " "));
      const lines = [`${entry.createdAt}  ${actor.padEnd(16)}  ${entry.summary}`];
      for (const change of entry.changes) {
        lines.push(
          `    ${change.field}: ${formatValue(change.from)} → ${formatValue(change.to)}`,
        );
      }
      return lines.join("\n");
    })
    .join("\n");
}

function formatValue(value: string | null): string {
  return value === null ? "(none)" : JSON.stringify(value);
}

const TODAY_SECTION_LABELS: Record<TodayReason, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  my_day: "My Day",
};

/** The Today projection: one heading per non-empty section, then yesterday's leftovers. */
export function formatTodayView(view: TodayViewDto): string {
  const blocks = view.sections
    .filter((section) => section.tasks.length > 0)
    .map((section) => {
      const rows = section.tasks.map((entry) => {
        const badges = entry.reasons
          .filter((reason) => reason !== section.id)
          .map((reason) => TODAY_SECTION_LABELS[reason]);
        const line = formatTaskTable([entry.task]);
        return badges.length > 0 ? `${line}  [${badges.join(", ")}]` : line;
      });
      return `${TODAY_SECTION_LABELS[section.id]}\n${rows.join("\n")}`;
    });

  if (view.review) {
    blocks.push(
      `Left over from ${view.review.date}\n${formatTaskTable(view.review.tasks)}`,
    );
  }

  return blocks.length === 0
    ? `Nothing planned for ${view.date}.`
    : `${view.date}\n\n${blocks.join("\n\n")}`;
}

export function formatTaskDetail(task: TaskDto): string {
  const lines = [
    `${task.key}  ${task.title}`,
    `  status      ${task.isCompleted ? "completed" : "open"}`,
    `  priority    ${task.priority}`,
    `  project     ${task.projectId ?? "Inbox"}`,
    `  due         ${task.dueDate ?? "none"}${task.dueTime ? ` ${task.dueTime}` : ""}`,
    `  my day      ${task.dayPlans.length > 0 ? task.dayPlans.join(", ") : "no"}`,
    `  version     ${task.version}`,
    `  created     ${task.createdAt}`,
  ];
  if (task.descriptionMd) {
    lines.push("", task.descriptionMd);
  }
  return lines.join("\n");
}

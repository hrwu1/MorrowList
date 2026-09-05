import type {
  ActivityEntryDto,
  FlowSummaryDto,
  DateWarning,
  ImportResultDto,
  SavedViewDto,
  SearchResponse,
  NotificationDto,
  TagListItemDto,
  ProjectDto,
  TaskDto,
  TodayReason,
  TodayViewDto,
  WorkflowStatusDto,
} from "@morrowlist/contracts";
import { describeRecurrence } from "@morrowlist/domain";

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
  /** Non-fatal notices such as the in-progress limit being exceeded (GAP-20). */
  readonly warnings?: readonly { readonly code: string; readonly message: string }[];
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
    case "TAG_NOT_FOUND":
    case "TASK_RELATION_NOT_FOUND":
    case "SAVED_VIEW_NOT_FOUND":
    case "NOTIFICATION_NOT_FOUND":
    case "NOT_FOUND":
      return EXIT.notFound;
    case "TASK_VERSION_CONFLICT":
    case "TASK_BLOCKED":
    case "TAG_NAME_CONFLICT":
    case "VERSION_CONFLICT":
    case "SAVED_VIEW_NAME_CONFLICT":
    case "IDEMPOTENCY_KEY_REUSED":
    case "STATUS_ARCHIVE_REQUIRES_DESTINATION":
    case "STATUS_ARCHIVE_REQUIRES_REPLACEMENT":
      return EXIT.conflict;
    case "VALIDATION_FAILED":
    case "TASK_INVALID_STATUS":
    case "WORKFLOW_INVARIANT_VIOLATED":
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
      const deadline = task.deadline ? `  (deadline ${task.deadline})` : "";
      const deferred = task.deferUntil ? `  (deferred until ${task.deferUntil})` : "";
      const blocked = task.isBlocked ? "  [blocked]" : "";
      const tags =
        task.tags.length > 0 ? `  #${task.tags.map((t) => t.name).join(" #")}` : "";
      return `[${done}] ${key}  ${mark}${task.title}${due}${deadline}${deferred}${blocked}${tags}`;
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

export function formatProjectTable(projects: readonly ProjectDto[]): string {
  if (projects.length === 0) return "No projects.";
  return projects
    .map(
      (project) =>
        `${project.id}  ${project.name}${project.archivedAt ? "  (archived)" : ""}`,
    )
    .join("\n");
}

/** Statuses in workflow order, with the flags that matter when editing a board. */
export function formatStatusTable(statuses: readonly WorkflowStatusDto[]): string {
  if (statuses.length === 0) return "No statuses.";
  return statuses
    .map((status) => {
      const flags = [
        status.isDefault ? "default" : null,
        status.isTerminal ? "done" : null,
        status.wipLimit !== null ? `wip ${status.wipLimit}` : null,
        status.archivedAt ? "archived" : null,
      ].filter((flag) => flag !== null);
      const suffix = flags.length > 0 ? `  [${flags.join(", ")}]` : "";
      return `${status.id}  ${status.name}  (${status.category})${suffix}`;
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

export function formatTaskDetail(
  task: TaskDto,
  subtasks: readonly TaskDto[] = [],
): string {
  const lines = [
    `${task.key}  ${task.title}`,
    `  status      ${task.isCompleted ? "completed" : "open"}`,
    `  priority    ${task.priority}`,
    `  project     ${task.projectId ?? "Inbox"}`,
    `  due         ${task.dueDate ?? "none"}${task.dueTime ? ` ${task.dueTime}` : ""}`,
    `  deadline    ${task.deadline ?? "none"}${task.deadlineTime ? ` ${task.deadlineTime}` : ""}`,
    `  deferred    ${task.deferUntil ? `until ${task.deferUntil}` : "no"}`,
    ...(task.dateWarnings.length > 0
      ? [`  warning     ${task.dateWarnings.map(describeDateWarning).join("; ")}`]
      : []),
    `  my day      ${task.dayPlans.length > 0 ? task.dayPlans.join(", ") : "no"}`,
    ...(task.isBlocked || task.blocked
      ? [
          `  blocked     ${
            task.blocked
              ? `${task.blocked.reason} (since ${task.blocked.since})`
              : "yes, waiting on an open blocker"
          }`,
        ]
      : []),
    ...(task.recurrence
      ? [`  repeat      ${describeRecurrence(task.recurrence)}`]
      : []),
    ...(task.seriesId ? [`  series      ${task.seriesId}`] : []),
    ...(task.parentTaskId ? [`  parent      ${task.parentTaskId}`] : []),
    ...(task.subtaskProgress
      ? [
          `  subtasks    ${task.subtaskProgress.completed}/${task.subtaskProgress.total} done`,
        ]
      : []),
    `  tags        ${task.tags.map((tag) => tag.name).join(", ") || "none"}`,
    `  version     ${task.version}`,
    `  created     ${task.createdAt}`,
  ];
  if (task.descriptionMd) {
    lines.push("", task.descriptionMd);
  }
  if (task.relations.length > 0) {
    lines.push(
      "",
      "Relations",
      ...task.relations.map((relation) => {
        const direction =
          relation.type === "related_to"
            ? "related to"
            : relation.sourceTaskId === task.id
              ? "blocks"
              : "blocked by";
        const done = relation.task.isCompleted ? "x" : " ";
        return `  ${direction.padEnd(10)}  [${done}] ${relation.task.key}  ${relation.task.title}`;
      }),
    );
  }
  if (subtasks.length > 0) {
    lines.push(
      "",
      "Subtasks",
      ...formatTaskTable(subtasks)
        .split("\n")
        .map((l) => `  ${l}`),
    );
  }
  return lines.join("\n");
}

/** Search hits: projects for navigation first, then tasks with the matched text marked. */
export function formatSearchResults(page: SearchResponse): string {
  const blocks: string[] = [];
  if (page.data.projects.length > 0) {
    blocks.push(
      `Projects\n${page.data.projects
        .map((hit) => `  ${hit.project.name}  (${hit.project.id})`)
        .join("\n")}`,
    );
  }
  if (page.data.tasks.length > 0) {
    blocks.push(formatTaskTable(page.data.tasks.map((hit) => hit.task)));
  }
  return blocks.length === 0 ? "No matches." : blocks.join("\n\n");
}

/** Saved views in sidebar order with their layout and filters. */
export function formatSavedViewTable(views: readonly SavedViewDto[]): string {
  if (views.length === 0) return "No saved views.";

  const nameWidth = Math.max(...views.map((view) => view.name.length));
  return views
    .map((view) => {
      const filters = Object.entries(view.filters)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ");
      return `${view.name.padEnd(nameWidth)}  ${view.layout.padEnd(5)}  ${filters || "(all open tasks)"}`;
    })
    .join("\n");
}

/** Tags with their colour and how many live tasks carry each. */
/** One line per notification: unread marker, id, when, title, body (GAP-13). */
export function formatNotificationTable(
  notifications: readonly NotificationDto[],
  unreadCount: number,
): string {
  if (notifications.length === 0) return "No notifications.";
  const lines = notifications.map(
    (notification) =>
      `${notification.readAt ? " " : "*"} ${notification.id}  ${notification.createdAt.slice(0, 16).replace("T", " ")}  ${notification.title}  ${notification.body.split("\n")[0] ?? ""}`,
  );
  return [...lines, `${unreadCount} unread`].join("\n");
}

export function formatTagTable(tags: readonly TagListItemDto[]): string {
  if (tags.length === 0) return "No tags.";

  const nameWidth = Math.max(...tags.map((tag) => tag.name.length));
  return tags
    .map((tag) => {
      const name = tag.name.padEnd(nameWidth);
      const count = `${tag.taskCount} task${tag.taskCount === 1 ? "" : "s"}`;
      const description = tag.description ? `  ${tag.description}` : "";
      return `${name}  ${tag.colorToken.padEnd(7)}  ${count}${description}`;
    })
    .join("\n");
}

const CATEGORY_LABELS: Record<string, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In progress",
  blocked: "Blocked",
  review: "Review",
  done: "Done",
};

const days = (value: number | null) => (value === null ? "-" : `${value}d`);

/** `morrow project flow`: the numbers first, then the weekly throughput and aging list. */
export function formatFlowSummary(flow: FlowSummaryDto): string {
  const lines = [
    `Flow for the last ${flow.range} days (${flow.from} to ${flow.to}, ${flow.timezone})`,
    `  WIP now     ${flow.wip}`,
    `  completed   ${flow.completed}`,
    `  cycle time  p50 ${days(flow.cycleTimeDays.p50)}  p85 ${days(flow.cycleTimeDays.p85)}  p95 ${days(flow.cycleTimeDays.p95)}  (${flow.cycleTimeDays.samples} started tasks)`,
    `  lead time   p50 ${days(flow.leadTimeDays.p50)}  p85 ${days(flow.leadTimeDays.p85)}  p95 ${days(flow.leadTimeDays.p95)}  (${flow.leadTimeDays.samples} tasks)`,
    "",
    "Throughput by week",
    ...flow.throughput.map(
      (week) =>
        `  ${week.weekStart}  ${"#".repeat(week.count)}${week.count ? " " : ""}${week.count}`,
    ),
  ];
  if (flow.aging.length > 0) {
    const keyWidth = Math.max(...flow.aging.map((item) => item.key.length));
    lines.push(
      "",
      "Aging work in progress",
      ...flow.aging.map(
        (item) =>
          `  ${item.key.padEnd(keyWidth)}  ${String(item.ageDays).padStart(6)}d  ${(CATEGORY_LABELS[item.category] ?? item.category).padEnd(11)}  ${item.title}${item.band && item.band !== "under_p50" ? `  [${item.band.replace("over_", "over ")}]` : ""}`,
      ),
    );
  }
  return lines.join("\n");
}

const DATE_WARNING_TEXT: Record<DateWarning, string> = {
  defer_after_due: "deferred past its due date",
  due_after_deadline: "due after its deadline",
  defer_after_deadline: "deferred past its deadline",
};

/** The soft date-order warnings the API attaches (GAP-16), spelled out. */
export function describeDateWarning(warning: DateWarning): string {
  return DATE_WARNING_TEXT[warning] ?? warning;
}

/**
 * What an import did, or would do. The counts first, then the columns and tags a person
 * needs to check, then every row the mapping refused — never a silent drop.
 */
export function formatImportPreview(result: ImportResultDto): string {
  const { preview } = result;
  const lines = [
    result.dryRun
      ? `Dry run: ${preview.projectName} would be created from ${preview.source}.`
      : `Imported ${preview.projectName} from ${preview.source}.`,
    `  columns    ${preview.counts.statuses}`,
    `  tasks      ${preview.counts.tasks}`,
    `  subtasks   ${preview.counts.subtasks}`,
    `  tags       ${preview.counts.tags}`,
  ];
  if (preview.statuses.length > 0) {
    const width = Math.max(...preview.statuses.map((status) => status.name.length));
    lines.push(
      "",
      "Columns",
      ...preview.statuses.map(
        (status) =>
          `  ${status.name.padEnd(width)}  ${status.category.padEnd(11)}  ${status.taskCount} task${status.taskCount === 1 ? "" : "s"}`,
      ),
    );
  }
  if (preview.tags.length > 0) lines.push("", `Tags  #${preview.tags.join(" #")}`);
  if (preview.ignoredFields.length > 0) {
    lines.push("", `Not imported  ${preview.ignoredFields.join(", ")}`);
  }
  if (preview.issues.length > 0) {
    lines.push(
      "",
      `Skipped ${preview.issues.length} row${preview.issues.length === 1 ? "" : "s"}`,
      ...preview.issues.map(
        (issue) =>
          `  row ${issue.row}  ${issue.title ?? "(no title)"}: ${issue.reason}`,
      ),
    );
  }
  if (result.projectId) lines.push("", `project  ${result.projectId}`);
  return lines.join("\n");
}

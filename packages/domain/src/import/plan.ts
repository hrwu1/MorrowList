import {
  DEFAULT_WORKFLOW,
  isStatusCategory,
  isTerminalCategory,
  type StatusCategory,
} from "../project/status.js";
import { PRIORITIES, type PlainDate, type Priority } from "../task/values.js";

/**
 * The import plan (GAP-07).
 *
 * A pure value: one mapping produces it, the preview renders it, and the apply walks it.
 * Because the preview and the apply cannot diverge, what a user approves is what runs.
 * Nothing here touches persistence — identifiers, ranks and task numbers are allocated
 * by the application layer when the plan is applied.
 */

/** A column the plan will create, in board order. */
export interface PlannedStatus {
  readonly name: string;
  readonly category: StatusCategory;
  /** The source's identifier for the list, so a task can point at it. */
  readonly externalId: string;
}

export interface PlannedTask {
  readonly title: string;
  readonly descriptionMd: string | null;
  readonly priority: Priority;
  readonly dueDate: PlainDate | null;
  readonly deadline: PlainDate | null;
  readonly deferUntil: PlainDate | null;
  /** Names, resolved to workspace tags (found or created) by the apply. */
  readonly tags: readonly string[];
  /** The `externalId` of a `PlannedStatus`; null puts the task in the default column. */
  readonly statusExternalId: string | null;
  readonly isCompleted: boolean;
  /** Archived at the source: created and then moved to the Trash (spec 9.7). */
  readonly isArchived: boolean;
  /** Where the row came from, recorded in the `task.created` payload. */
  readonly externalId: string | null;
  /** Checklist items or CSV children; one level only, matching spec 8.3's depth budget. */
  readonly subtasks: readonly PlannedSubtask[];
}

export interface PlannedSubtask {
  readonly title: string;
  readonly isCompleted: boolean;
  readonly externalId: string | null;
}

/** A row the mapping refused, with a reason a person can act on. */
export interface ImportIssue {
  /** 1-based position in the source: a CSV line, or a card's index in the board. */
  readonly row: number;
  readonly title: string | null;
  readonly reason: string;
}

export interface ImportPlan {
  readonly projectName: string;
  readonly statuses: readonly PlannedStatus[];
  readonly tasks: readonly PlannedTask[];
  /** Source fields or CSV columns the mapping ignored; nothing is dropped silently. */
  readonly ignoredFields: readonly string[];
  readonly issues: readonly ImportIssue[];
}

/** A source document that could not be read at all: the plan is empty and says why. */
export class ImportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFormatError";
  }
}

export const MAX_IMPORT_TASKS = 5000;

export function countSubtasks(plan: ImportPlan): number {
  return plan.tasks.reduce((total, task) => total + task.subtasks.length, 0);
}

/** Every tag the plan mentions, once, in first-seen order. */
export function plannedTagNames(plan: ImportPlan): readonly string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const task of plan.tasks) {
    for (const tag of task.tags) {
      const key = tag.toLocaleLowerCase("en-US");
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(tag);
    }
  }
  return names;
}

/**
 * How many cards each planned column will hold, keyed by `externalId`. Subtasks are not
 * counted: a board hides them behind their parent by default (spec 8.3), so this is the
 * number a person will actually see in the column, and the preview reports subtasks as a
 * total of their own.
 */
export function taskCountByStatus(plan: ImportPlan): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const status of plan.statuses) counts.set(status.externalId, 0);
  for (const task of plan.tasks) {
    if (task.statusExternalId === null) continue;
    counts.set(task.statusExternalId, (counts.get(task.statusExternalId) ?? 0) + 1);
  }
  return counts;
}

/** Ids for the columns the normalisation adds; a source list never uses these. */
export const SYNTHETIC_STATUS_PREFIX = "morrowlist:";

/**
 * A workflow the project invariants accept (spec 11.4): at least one Done column and at
 * least one that is not, whatever the board had. A board with no Done list gains one, so
 * completing an imported task has somewhere to go; a board that is all Done lists gains a
 * Backlog, so new tasks do. An empty board gets the default workflow (spec 11.2).
 */
export function normalizePlannedStatuses(
  statuses: readonly PlannedStatus[],
): readonly PlannedStatus[] {
  if (statuses.length === 0) {
    return DEFAULT_WORKFLOW.map((template) => ({
      name: template.name,
      category: template.category,
      externalId: `${SYNTHETIC_STATUS_PREFIX}${template.category}`,
    }));
  }

  const normalized = [...statuses];
  if (!normalized.some((status) => isTerminalCategory(status.category))) {
    normalized.push({
      name: "Done",
      category: "done",
      externalId: `${SYNTHETIC_STATUS_PREFIX}done`,
    });
  }
  if (normalized.every((status) => isTerminalCategory(status.category))) {
    normalized.unshift({
      name: "Backlog",
      category: "backlog",
      externalId: `${SYNTHETIC_STATUS_PREFIX}backlog`,
    });
  }
  return normalized;
}

/** The column new and reopened tasks land in: the first that is not a Done column. */
export function defaultPlannedStatus(
  statuses: readonly PlannedStatus[],
): PlannedStatus | null {
  return statuses.find((status) => !isTerminalCategory(status.category)) ?? null;
}

const CATEGORY_HINTS: readonly {
  readonly category: StatusCategory;
  readonly words: readonly string[];
}[] = [
  {
    category: "done",
    words: ["done", "complete", "completed", "finished", "shipped", "closed"],
  },
  {
    category: "review",
    words: ["review", "reviewing", "qa", "testing", "verify", "approval"],
  },
  {
    category: "blocked",
    words: ["blocked", "waiting", "on hold", "hold", "stuck", "paused"],
  },
  {
    category: "in_progress",
    words: [
      "progress",
      "doing",
      "in flight",
      "started",
      "working",
      "active",
      "current",
    ],
  },
  {
    category: "ready",
    words: ["ready", "todo", "to do", "next", "up next", "selected", "this week"],
  },
  {
    category: "backlog",
    words: ["backlog", "ideas", "someday", "inbox", "icebox", "later"],
  },
];

/**
 * Guess a workflow category from a column's name (spec 11.3). A board's own vocabulary
 * decides — "Doing" is in progress, "QA" is review — and anything unrecognised becomes a
 * backlog column, which is always safe: no task is completed by accident.
 */
export function guessStatusCategory(name: string): StatusCategory {
  const normalized = name.trim().toLocaleLowerCase("en-US");
  if (isStatusCategory(normalized)) return normalized;
  for (const hint of CATEGORY_HINTS) {
    if (hint.words.some((word) => normalized.includes(word))) return hint.category;
  }
  return "backlog";
}

/** A priority name from a source column, or `none` when it says nothing recognisable. */
export function readPriority(value: string | null | undefined): Priority {
  const normalized = value?.trim().toLocaleLowerCase("en-US") ?? "";
  return (PRIORITIES as readonly string[]).includes(normalized)
    ? (normalized as Priority)
    : "none";
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar date from a source value: `YYYY-MM-DD`, or the date part of an ISO instant
 * (Trello writes `2026-09-14T12:00:00.000Z`). Anything else is not a date.
 */
export function readPlainDate(value: string | null | undefined): PlainDate | null {
  const raw = value?.trim();
  if (!raw) return null;
  const candidate = raw.length > 10 && raw[10] === "T" ? raw.slice(0, 10) : raw;
  if (!DATE_PATTERN.test(candidate)) return null;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return candidate as PlainDate;
}

/** Split a tag cell: `research, ux` or `research ux` or `#research #ux`. */
export function readTagNames(value: string | null | undefined): readonly string[] {
  if (!value) return [];
  const parts = value.includes(",") ? value.split(",") : value.split(/\s+/);
  const names: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const name = part.trim().replace(/^#/, "").trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

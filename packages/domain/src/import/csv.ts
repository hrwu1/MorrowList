import { isTerminalCategory } from "../project/status.js";
import { parseCsv } from "../shared/csv.js";
import { normalizeTitle, TITLE_MAX_LENGTH } from "../task/values.js";

import {
  ImportFormatError,
  MAX_IMPORT_TASKS,
  guessStatusCategory,
  normalizePlannedStatuses,
  readPlainDate,
  readPriority,
  readTagNames,
  type ImportIssue,
  type ImportPlan,
  type PlannedStatus,
  type PlannedSubtask,
  type PlannedTask,
} from "./plan.js";

/**
 * CSV → import plan (GAP-07).
 *
 * The generic path: anything that can produce a spreadsheet — Asana, Jira, Todoist, a
 * hand-written list — arrives here, which is why no dedicated importer exists for each.
 * The columns are the ones the task CSV export writes, so an export is re-importable.
 *
 * `parentKey` nests one row under another by the parent's `key` or `title`, giving
 * subtasks (spec 8.3); one level only, matching the export.
 */

/** Column name (lower-cased, non-alphanumerics stripped) to the field it feeds. */
const COLUMN_ALIASES: Record<string, CsvField> = {
  title: "title",
  name: "title",
  task: "title",
  summary: "title",
  description: "description",
  descriptionmd: "description",
  notes: "description",
  status: "status",
  list: "status",
  column: "status",
  state: "status",
  priority: "priority",
  duedate: "dueDate",
  due: "dueDate",
  deadline: "deadline",
  deferuntil: "deferUntil",
  startdate: "deferUntil",
  start: "deferUntil",
  tags: "tags",
  labels: "tags",
  parentkey: "parentKey",
  parent: "parentKey",
  key: "key",
  completed: "completed",
  done: "completed",
};

type CsvField =
  | "title"
  | "description"
  | "status"
  | "priority"
  | "dueDate"
  | "deadline"
  | "deferUntil"
  | "tags"
  | "parentKey"
  | "key"
  | "completed";

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]/g, "");
}

function isTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLocaleLowerCase("en-US") ?? "";
  return ["1", "true", "yes", "y", "x", "done", "complete", "completed"].includes(
    normalized,
  );
}

export interface CsvImportOptions {
  readonly projectName?: string | undefined;
}

interface DraftRow {
  readonly row: number;
  readonly title: string;
  readonly key: string | null;
  readonly parentKey: string | null;
  readonly task: PlannedTask;
}

export function planFromCsv(text: string, options: CsvImportOptions = {}): ImportPlan {
  const records = parseCsv(text);
  const header = records[0];
  if (!header || header.length === 0) {
    throw new ImportFormatError(
      "The CSV is empty; the first line must name the columns.",
    );
  }

  const fields = new Map<CsvField, number>();
  const ignoredFields: string[] = [];
  for (const [index, name] of header.entries()) {
    const field = COLUMN_ALIASES[normalizeHeader(name)];
    // A repeated column keeps the first: a later duplicate would silently win otherwise.
    if (field && !fields.has(field)) fields.set(field, index);
    else if (!field && name.trim()) ignoredFields.push(name.trim());
  }
  if (!fields.has("title")) {
    throw new ImportFormatError(
      'The CSV needs a "title" column; found: ' +
        (header.filter((name) => name.trim()).join(", ") || "no named columns"),
    );
  }

  const cell = (record: readonly string[], field: CsvField): string | null => {
    const index = fields.get(field);
    if (index === undefined) return null;
    const value = record[index]?.trim();
    return value ? value : null;
  };

  const issues: ImportIssue[] = [];
  const drafts: DraftRow[] = [];
  const statusNames = new Map<string, PlannedStatus>();

  for (const [index, record] of records.slice(1).entries()) {
    // Row 1 is the header, so the first data record is row 2 in the user's file.
    const row = index + 2;
    const rawTitle = cell(record, "title");
    if (!rawTitle) {
      issues.push({ row, title: null, reason: "The row has no title." });
      continue;
    }
    if (drafts.length >= MAX_IMPORT_TASKS) {
      issues.push({
        row,
        title: rawTitle,
        reason: `Only ${MAX_IMPORT_TASKS} rows can be imported at once.`,
      });
      continue;
    }

    const statusName = cell(record, "status");
    const statusKey = statusName?.toLocaleLowerCase("en-US") ?? null;
    if (statusName && statusKey && !statusNames.has(statusKey)) {
      statusNames.set(statusKey, {
        name: statusName.slice(0, 80),
        category: guessStatusCategory(statusName),
        externalId: statusKey,
      });
    }
    // A row in a Done column is done, exactly as a Trello card in a Done list is.
    const inDoneColumn = statusKey
      ? isTerminalCategory(statusNames.get(statusKey)?.category ?? "backlog")
      : false;

    drafts.push({
      row,
      title: rawTitle,
      key: cell(record, "key"),
      parentKey: cell(record, "parentKey"),
      task: {
        title: normalizeTitle(rawTitle.slice(0, TITLE_MAX_LENGTH)),
        descriptionMd: cell(record, "description"),
        priority: readPriority(cell(record, "priority")),
        dueDate: readPlainDate(cell(record, "dueDate")),
        deadline: readPlainDate(cell(record, "deadline")),
        deferUntil: readPlainDate(cell(record, "deferUntil")),
        tags: readTagNames(cell(record, "tags")),
        statusExternalId: statusKey,
        isCompleted: isTruthy(record[fields.get("completed") ?? -1]) || inDoneColumn,
        isArchived: false,
        externalId: cell(record, "key"),
        subtasks: [],
      },
    });
  }

  return {
    projectName: options.projectName?.trim() || "Imported tasks",
    statuses: normalizePlannedStatuses([...statusNames.values()]),
    tasks: nestChildren(drafts, issues),
    ignoredFields,
    issues,
  };
}

/**
 * Fold every row naming a parent into that parent's subtasks. A parent is matched by its
 * `key` column first, then by exact title; a row whose parent is unknown stays a
 * top-level task and says so, because losing it would be worse.
 */
function nestChildren(
  drafts: readonly DraftRow[],
  issues: ImportIssue[],
): PlannedTask[] {
  const byKey = new Map<string, DraftRow>();
  const byTitle = new Map<string, DraftRow>();
  for (const draft of drafts) {
    if (draft.key && !byKey.has(draft.key)) byKey.set(draft.key, draft);
    const titleKey = draft.title.toLocaleLowerCase("en-US");
    if (!byTitle.has(titleKey)) byTitle.set(titleKey, draft);
  }

  const subtasksByParent = new Map<number, PlannedSubtask[]>();
  const nested = new Set<number>();

  for (const draft of drafts) {
    if (!draft.parentKey) continue;
    const parent =
      byKey.get(draft.parentKey) ??
      byTitle.get(draft.parentKey.toLocaleLowerCase("en-US"));
    if (!parent || parent.row === draft.row) {
      issues.push({
        row: draft.row,
        title: draft.title,
        reason: `No row matches parent "${draft.parentKey}"; imported as a top-level task.`,
      });
      continue;
    }
    // One level only (spec 8.3): a child of a child attaches to the grandparent's row.
    if (nested.has(parent.row)) {
      issues.push({
        row: draft.row,
        title: draft.title,
        reason: "Subtasks nest one level deep; imported as a top-level task.",
      });
      continue;
    }
    const bucket = subtasksByParent.get(parent.row) ?? [];
    bucket.push({
      title: draft.task.title,
      isCompleted: draft.task.isCompleted,
      externalId: draft.task.externalId,
    });
    subtasksByParent.set(parent.row, bucket);
    nested.add(draft.row);
  }

  return drafts
    .filter((draft) => !nested.has(draft.row))
    .map((draft) => ({
      ...draft.task,
      subtasks: subtasksByParent.get(draft.row) ?? [],
    }));
}

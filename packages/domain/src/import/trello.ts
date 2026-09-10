import { isTerminalCategory } from "../project/status.js";
import { normalizeTitle, TITLE_MAX_LENGTH } from "../task/values.js";

import {
  ImportFormatError,
  MAX_IMPORT_TASKS,
  guessStatusCategory,
  normalizePlannedStatuses,
  readPlainDate,
  type ImportIssue,
  type ImportPlan,
  type PlannedStatus,
  type PlannedSubtask,
  type PlannedTask,
} from "./plan.js";

/**
 * Trello board → import plan (GAP-07).
 *
 * A board's JSON export ("Print, export and share" → "Export as JSON"). Lists become
 * columns, cards become tasks, labels become tags, and checklist items become subtasks
 * (spec 8.3). Archived cards keep their place in history by landing in the Trash rather
 * than being dropped; a card Trello marks `dueComplete`, or one sitting in a list that
 * reads as Done, arrives completed.
 *
 * Everything here is pure: the mapping is the same value the preview shows and the apply
 * walks, so the two can never disagree.
 */

/** The fields of a board this mapping deliberately does not read. */
const IGNORED_TRELLO_FIELDS = [
  "actions (Trello's own history)",
  "members and card assignments",
  "attachments and cover images",
  "comments",
  "card positions within a list",
  "custom fields",
  "power-ups",
] as const;

interface TrelloBoard {
  readonly name?: unknown;
  readonly lists?: unknown;
  readonly cards?: unknown;
  readonly labels?: unknown;
  readonly checklists?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export interface TrelloImportOptions {
  /** Overrides the board's own name. */
  readonly projectName?: string | undefined;
}

/**
 * Parse a board's JSON text into a plan. Throws `ImportFormatError` when the document is
 * not a Trello board at all — a message a person can act on, not a stack trace.
 */
export function planFromTrelloJson(
  text: string,
  options: TrelloImportOptions = {},
): ImportPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ImportFormatError("This file is not valid JSON.");
  }
  return planFromTrelloBoard(parsed, options);
}

export function planFromTrelloBoard(
  board: unknown,
  options: TrelloImportOptions = {},
): ImportPlan {
  if (!isRecord(board)) {
    throw new ImportFormatError("A Trello export must be a JSON object.");
  }
  const document = board as TrelloBoard;
  if (!Array.isArray(document.cards) || !Array.isArray(document.lists)) {
    throw new ImportFormatError(
      "This does not look like a Trello board export: it has no lists and cards.",
    );
  }

  const projectName =
    options.projectName?.trim() || readString(document.name) || "Imported board";

  const listOrder = new Map<string, number>();
  const statuses: PlannedStatus[] = [];
  for (const [index, entry] of readArray(document.lists).entries()) {
    if (!isRecord(entry)) continue;
    const id = readString(entry.id);
    const name = readString(entry.name);
    if (!id || !name) continue;
    listOrder.set(id, readNumber(entry.pos) || index);
    statuses.push({
      name: name.slice(0, 80),
      category: guessStatusCategory(name),
      externalId: id,
    });
  }
  statuses.sort(
    (left, right) =>
      (listOrder.get(left.externalId) ?? 0) - (listOrder.get(right.externalId) ?? 0),
  );

  const terminalListIds = new Set(
    statuses
      .filter((status) => isTerminalCategory(status.category))
      .map((status) => status.externalId),
  );
  const knownListIds = new Set(statuses.map((status) => status.externalId));

  // Labels can be named on the board and referenced by id from a card, or embedded.
  const labelNames = new Map<string, string>();
  for (const entry of readArray(document.labels)) {
    if (!isRecord(entry)) continue;
    const id = readString(entry.id);
    const name = readString(entry.name);
    if (id && name) labelNames.set(id, name);
  }

  const checklistsByCard = readChecklists(document.checklists);

  const issues: ImportIssue[] = [];
  const tasks: PlannedTask[] = [];

  for (const [index, entry] of readArray(document.cards).entries()) {
    const row = index + 1;
    if (!isRecord(entry)) {
      issues.push({ row, title: null, reason: "The card is not an object." });
      continue;
    }
    const rawTitle = readString(entry.name);
    if (!rawTitle) {
      issues.push({ row, title: null, reason: "The card has no name." });
      continue;
    }
    if (tasks.length >= MAX_IMPORT_TASKS) {
      issues.push({
        row,
        title: rawTitle,
        reason: `Only ${MAX_IMPORT_TASKS} cards can be imported at once.`,
      });
      continue;
    }

    const cardId = readString(entry.id);
    const listId = readString(entry.idList);
    const statusExternalId = listId && knownListIds.has(listId) ? listId : null;
    if (listId && !statusExternalId) {
      issues.push({
        row,
        title: rawTitle,
        reason:
          "The card's list is missing from the export; it lands in the first column.",
      });
    }

    const dueComplete = entry.dueComplete === true;
    const inDoneList =
      statusExternalId !== null && terminalListIds.has(statusExternalId);

    tasks.push({
      title: normalizeTitle(rawTitle.slice(0, TITLE_MAX_LENGTH)),
      descriptionMd: readString(entry.desc),
      priority: "none",
      dueDate: readPlainDate(typeof entry.due === "string" ? entry.due : null),
      deadline: null,
      deferUntil: readPlainDate(typeof entry.start === "string" ? entry.start : null),
      tags: readCardLabels(entry, labelNames),
      statusExternalId,
      isCompleted: dueComplete || inDoneList,
      isArchived: entry.closed === true,
      externalId: cardId,
      sourceRow: row,
      subtasks: cardId ? (checklistsByCard.get(cardId) ?? []) : [],
      // Trello custom fields are a paid power-up and are absent from a free board export.
      fields: {},
    });
  }

  return {
    projectName,
    statuses: normalizePlannedStatuses(statuses),
    tasks,
    ignoredFields: [...IGNORED_TRELLO_FIELDS],
    issues,
  };
}

/** A card's labels, by embedded object first and by board-level id as a fallback. */
function readCardLabels(
  card: Record<string, unknown>,
  labelNames: ReadonlyMap<string, string>,
): readonly string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  const add = (value: string | null) => {
    if (!value) return;
    const key = value.toLocaleLowerCase("en-US");
    if (seen.has(key)) return;
    seen.add(key);
    names.push(value);
  };

  for (const label of readArray(card.labels)) {
    if (isRecord(label)) add(readString(label.name));
  }
  for (const id of readArray(card.idLabels)) {
    const labelId = readString(id);
    if (labelId) add(labelNames.get(labelId) ?? null);
  }
  return names;
}

/**
 * Checklist items, flattened per card in checklist then item order. MorrowList nests one
 * level under a task (spec 8.3), so several checklists on one card merge into one list of
 * subtasks rather than becoming a second level.
 */
function readChecklists(
  value: unknown,
): ReadonlyMap<string, readonly PlannedSubtask[]> {
  const byCard = new Map<string, PlannedSubtask[]>();
  const checklists = readArray(value)
    .filter(isRecord)
    .sort((left, right) => readNumber(left.pos) - readNumber(right.pos));

  for (const checklist of checklists) {
    const cardId = readString(checklist.idCard);
    if (!cardId) continue;
    const items = readArray(checklist.checkItems)
      .filter(isRecord)
      .sort((left, right) => readNumber(left.pos) - readNumber(right.pos));

    for (const item of items) {
      const title = readString(item.name);
      if (!title) continue;
      const bucket = byCard.get(cardId) ?? [];
      bucket.push({
        title: normalizeTitle(title.slice(0, TITLE_MAX_LENGTH)),
        isCompleted: item.state === "complete",
        externalId: readString(item.id),
      });
      byCard.set(cardId, bucket);
    }
  }
  return byCard;
}

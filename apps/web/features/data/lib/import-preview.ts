import type { ImportPreviewDto, ImportSource } from "@morrowlist/contracts";

/**
 * Presentation rules for the import preview (GAP-07). Pure: the page renders what these
 * return and decides nothing itself.
 */

const SOURCE_LABELS: Record<ImportSource, string> = {
  trello: "Trello board",
  csv: "CSV file",
};

export function sourceLabel(source: ImportSource): string {
  return SOURCE_LABELS[source];
}

/** The file extension each importer expects, for the file input's `accept`. */
export const SOURCE_ACCEPT: Record<ImportSource, string> = {
  trello: ".json,application/json",
  csv: ".csv,text/csv",
};

/** Guess the importer from a dropped file's name; null when it is neither. */
export function sourceForFilename(name: string): ImportSource | null {
  const lower = name.toLocaleLowerCase("en-US");
  if (lower.endsWith(".json")) return "trello";
  if (lower.endsWith(".csv")) return "csv";
  return null;
}

export interface PreviewCount {
  readonly label: string;
  readonly value: number;
}

/** The headline numbers, in the order a person checks them. */
export function previewCounts(preview: ImportPreviewDto): readonly PreviewCount[] {
  return [
    { label: "Columns", value: preview.counts.statuses },
    { label: "Tasks", value: preview.counts.tasks },
    { label: "Subtasks", value: preview.counts.subtasks },
    { label: "Tags", value: preview.counts.tags },
    { label: "Skipped", value: preview.counts.skipped },
  ];
}

/** One line per sampled task: what it is called and where it will land. */
export function describeSampleTask(task: ImportPreviewDto["sample"][number]): string {
  const parts = [task.statusName ?? "first column"];
  if (task.dueDate) parts.push(`due ${task.dueDate}`);
  if (task.tags.length > 0) parts.push(task.tags.map((tag) => `#${tag}`).join(" "));
  if (task.subtaskCount > 0) {
    parts.push(`${task.subtaskCount} subtask${task.subtaskCount === 1 ? "" : "s"}`);
  }
  if (task.isArchived) parts.push("goes to Trash");
  else if (task.isCompleted) parts.push("arrives completed");
  return parts.join(" · ");
}

/** What the Import button says, so the count is confirmed at the moment of pressing it. */
export function importButtonLabel(preview: ImportPreviewDto): string {
  const total = preview.counts.tasks + preview.counts.subtasks;
  return `Import ${total} task${total === 1 ? "" : "s"} into ${preview.projectName}`;
}

/** The size limit the API enforces, said the way a person measures a file. */
export const MAX_IMPORT_MB = 10;

export function isTooLarge(bytes: number): boolean {
  return bytes > MAX_IMPORT_MB * 1_000_000;
}

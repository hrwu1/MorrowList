import type { TaskDto } from "@morrowlist/contracts";

/**
 * Multi-select over a list or a board (spec 10.4, GAP-08).
 *
 * Selection is deliberately not URL state: it is a transient working set, not a view
 * somebody would share or reload into. It is a set of ids plus the row a range extends
 * from, kept independent of the tasks themselves so a background refetch cannot silently
 * change what "these three" means.
 */

export interface Selection {
  readonly ids: readonly string[];
  /** The last row acted on; a Shift-click selects everything between it and the click. */
  readonly anchorId: string | null;
}

export const EMPTY_SELECTION: Selection = { ids: [], anchorId: null };

export function isSelected(selection: Selection, id: string): boolean {
  return selection.ids.includes(id);
}

export function toggle(selection: Selection, id: string): Selection {
  return {
    ids: isSelected(selection, id)
      ? selection.ids.filter((current) => current !== id)
      : [...selection.ids, id],
    // The anchor follows the last row touched, selected or not, so a Shift-click after a
    // deselect still extends from where the user last was.
    anchorId: id,
  };
}

/**
 * Shift-click: add everything between the anchor and this row, inclusive, without
 * dropping what was already selected elsewhere. With no anchor it is a plain click.
 */
export function extendTo(
  selection: Selection,
  id: string,
  order: readonly string[],
): Selection {
  const from = selection.anchorId === null ? -1 : order.indexOf(selection.anchorId);
  const to = order.indexOf(id);
  if (from === -1 || to === -1) return toggle(selection, id);

  const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
  const ids = [...selection.ids];
  for (const current of range) if (!ids.includes(current)) ids.push(current);
  return { ids, anchorId: id };
}

/** Cmd/Ctrl+A within a list: everything shown, or nothing when it is already everything. */
export function selectAll(selection: Selection, order: readonly string[]): Selection {
  const everything = order.length > 0 && order.every((id) => isSelected(selection, id));
  return everything
    ? { ids: [], anchorId: selection.anchorId }
    : { ids: [...order], anchorId: order.at(-1) ?? null };
}

/**
 * Forget ids that are no longer on screen. A bulk complete removes rows from the list it
 * ran on, and a toolbar still offering to act on them would be lying.
 */
export function retain(selection: Selection, order: readonly string[]): Selection {
  const ids = selection.ids.filter((id) => order.includes(id));
  if (ids.length === selection.ids.length) return selection;
  return {
    ids,
    anchorId:
      selection.anchorId && order.includes(selection.anchorId)
        ? selection.anchorId
        : null,
  };
}

/** The selected tasks, in the order they are shown rather than the order they were picked. */
export function selectedTasks(
  selection: Selection,
  tasks: readonly TaskDto[],
): readonly TaskDto[] {
  return tasks.filter((task) => isSelected(selection, task.id));
}

/** What the live region announces, and what the toolbar shows (spec 14). */
export function selectionLabel(count: number): string {
  return `${count} ${count === 1 ? "task" : "tasks"} selected`;
}

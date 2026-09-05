import type { TaskDto } from "@morrowlist/contracts";

/**
 * Which task a shortcut acts on (GAP-10).
 *
 * The list and the board already give every task's title link a stable id — the list uses
 * it to return focus after the detail panel closes, the board does the same for its cards
 * — so the focused row or card can be identified without either view holding new state.
 * That is deliberate: it means the board's roving focus and the list's focus return are
 * reused exactly as they are, and neither view had to change for this feature.
 *
 * When nothing is focused, the open detail is the subject instead: `/tasks/ML-12`, or a
 * `?task=ML-12` panel over a list or a board.
 */

const LIST_LINK = /^task-link-(.+)$/;
const BOARD_LINK = /^board-task-link-(.+)$/;

/** The task key an element id stands for, if it is one of the row or card title links. */
export function taskKeyFromElementId(id: string | null | undefined): string | null {
  if (!id) return null;
  const list = LIST_LINK.exec(id);
  if (list) return list[1] as string;
  const board = BOARD_LINK.exec(id);
  if (board) return board[1] as string;
  return null;
}

/** The task key the route or its query string is showing, if any. */
export function taskKeyFromLocation(pathname: string, search: string): string | null {
  const detail = /^\/tasks\/([^/?#]+)/.exec(pathname);
  if (detail) return decodeURIComponent(detail[1] as string);
  const panel = new URLSearchParams(search).get("task");
  return panel && panel.length > 0 ? panel : null;
}

/**
 * The focused row or card, read from the document. Focus may sit on the title link
 * itself or on any control inside the row, so the row is found first and its title link
 * second.
 */
export function focusedTaskKey(doc: Document): string | null {
  const active = doc.activeElement;
  if (!(active instanceof Element)) return null;
  const direct = taskKeyFromElementId(active.id);
  if (direct) return direct;
  const container = active.closest(".task-row, .board-card");
  const link = container?.querySelector(
    '[id^="task-link-"], [id^="board-task-link-"]',
  );
  return taskKeyFromElementId(link?.id ?? null);
}

/** The whole rule, in the order the app resolves it: focus first, then the open detail. */
export function currentTaskKey(
  doc: Document,
  location: { readonly pathname: string; readonly search: string },
): string | null {
  return focusedTaskKey(doc) ?? taskKeyFromLocation(location.pathname, location.search);
}

function isTask(value: unknown): value is TaskDto {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TaskDto>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.key === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.version === "number"
  );
}

/**
 * The task behind a key, from whatever the query cache already holds.
 *
 * Every projection — list, board, Today, Upcoming, search, detail — caches the same
 * canonical `TaskDto` (ADR-001), so the first copy found is the right one; a shortcut
 * pressed on a visible task therefore needs no request. `entries` are raw cached query
 * payloads, which is why the shapes are probed rather than typed.
 */
export function findTaskInCaches(
  entries: readonly unknown[],
  key: string,
): TaskDto | undefined {
  for (const entry of entries) {
    const found = searchEntry(entry, key, 0);
    if (found) return found;
  }
  return undefined;
}

/** Deep enough for the deepest projection: `{ pages: [{ data: { sections: [{ tasks }] } }] }`. */
const MAX_DEPTH = 6;

function searchEntry(value: unknown, key: string, depth: number): TaskDto | undefined {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return undefined;
  if (isTask(value)) return value.key === key ? value : undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = searchEntry(item, key, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    if (item === null || typeof item !== "object") continue;
    const found = searchEntry(item, key, depth + 1);
    if (found) return found;
  }
  return undefined;
}

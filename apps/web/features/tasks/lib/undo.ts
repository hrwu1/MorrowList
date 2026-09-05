import type { TaskDto } from "@morrowlist/contracts";

/**
 * The undo model (spec 10.3, GAP-08).
 *
 * Undo is a compensating command, never a client-side visual reversal: each entry knows
 * the inverse command to send and the version its own mutation produced. If somebody else
 * has changed the task since, that version is stale and the server refuses — which is the
 * point. Spec 24.3 forbids a silent last-write-wins, so a conflicting undo reports itself
 * and offers a refresh rather than reverting a change it never saw.
 *
 * These are pure functions over an entry and a clock reading; the React wiring lives in
 * `../hooks/use-undo.ts` and the toast in `../components/undo-toast.tsx`.
 */

/** Spec 10.3: an eight-second window. */
export const UNDO_WINDOW_MS = 8_000;

export interface UndoEntry {
  /** The mutation this undoes; a newer mutation on the same id replaces the offer. */
  readonly id: string;
  /** Read out by the toast, so it says what would be undone, not just "Undo". */
  readonly label: string;
  readonly expiresAt: number;
  readonly compensate: () => Promise<void>;
}

export interface UndoOffer {
  readonly id: string;
  readonly label: string;
  readonly compensate: () => Promise<void>;
}

export function createUndoEntry(offer: UndoOffer, now: number): UndoEntry {
  return { ...offer, expiresAt: now + UNDO_WINDOW_MS };
}

export function isExpired(entry: UndoEntry, now: number): boolean {
  return now >= entry.expiresAt;
}

/** Milliseconds left in the window, floored at zero so a countdown never goes negative. */
export function remainingMs(entry: UndoEntry, now: number): number {
  return Math.max(0, entry.expiresAt - now);
}

/**
 * The offer a user can act on right now. Only the newest survives: two toasts stacked on
 * top of each other are a worse answer than one, and the older window is nearly over
 * anyway. An expired entry is dropped rather than shown as a dead button.
 */
export function currentEntry(
  stack: readonly UndoEntry[],
  now: number,
): UndoEntry | null {
  const live = stack.filter((entry) => !isExpired(entry, now));
  return live.at(-1) ?? null;
}

export function pushEntry(
  stack: readonly UndoEntry[],
  entry: UndoEntry,
  now: number,
): readonly UndoEntry[] {
  return [...stack.filter((current) => !isExpired(current, now)), entry];
}

export function dropEntry(
  stack: readonly UndoEntry[],
  id: string,
): readonly UndoEntry[] {
  return stack.filter((entry) => entry.id !== id);
}

/**
 * Where a task sat in its own rank scope, as its neighbours. Undoing a move has to put
 * the card back where it was, not merely back in the right column, so the compensating
 * move carries the same before/after anchors a drag would have sent (spec 24.2).
 */
export interface RankNeighbours {
  readonly beforeTaskId: string | null;
  readonly afterTaskId: string | null;
}

export function neighboursOf(
  task: TaskDto,
  candidates: readonly TaskDto[],
): RankNeighbours {
  const scope = candidates
    .filter(
      (candidate) =>
        candidate.id !== task.id &&
        candidate.deletedAt === null &&
        candidate.projectId === task.projectId &&
        candidate.statusId === task.statusId,
    )
    .sort((left, right) => (left.rank < right.rank ? -1 : 1));

  // "before" is the card above (a smaller rank); "after" is the card below.
  const above = scope.filter((candidate) => candidate.rank < task.rank).at(-1) ?? null;
  const below = scope.find((candidate) => candidate.rank > task.rank) ?? null;
  return { beforeTaskId: above?.id ?? null, afterTaskId: below?.id ?? null };
}

/** True when the server refused because the task moved on since the undone mutation. */
export function isUndoConflict(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "TASK_VERSION_CONFLICT" || code === "VERSION_CONFLICT";
}

export function undoErrorMessage(error: unknown): string {
  if (isUndoConflict(error)) {
    return "This changed somewhere else, so it was left alone. Refresh to see the current state.";
  }
  return error instanceof Error && error.message
    ? error.message
    : "That could not be undone.";
}

/** "Completed Draft the brief" — what the toast says it is offering to take back. */
export function undoLabel(verb: string, task: TaskDto): string {
  return `${verb} ${task.title}`;
}

/** "12 tasks completed" — the same, for a whole batch. */
export function undoBatchLabel(verb: string, count: number): string {
  return `${count} ${count === 1 ? "task" : "tasks"} ${verb}`;
}

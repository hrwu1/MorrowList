import type {
  BatchOperation,
  BatchResultItemDto,
  TaskDto,
} from "@morrowlist/contracts";

import { neighboursOf } from "./undo";

/**
 * What the selection toolbar can do, and how each of those undoes itself (spec 10.4).
 *
 * A bulk action is one shape: the operation it sends per task, and the operation that
 * takes it back. Keeping both here means the undo of a bulk change cannot drift from the
 * change itself, and the toolbar stays a set of buttons rather than a second rulebook.
 */

export type BulkAction =
  | { readonly kind: "complete" }
  | { readonly kind: "delete" }
  | {
      readonly kind: "move";
      /** Null is the Inbox (spec 11.5). */
      readonly projectId: string | null;
      readonly statusId?: string | undefined;
    }
  | { readonly kind: "setPriority"; readonly priority: TaskDto["priority"] }
  | { readonly kind: "setDueDate"; readonly dueDate: string | null }
  | { readonly kind: "addTag"; readonly tagId: string };

/** Past tense, for the toast and the live region: "3 tasks completed". */
export function bulkVerb(action: BulkAction): string {
  switch (action.kind) {
    case "complete":
      return "completed";
    case "delete":
      return "moved to Trash";
    case "move":
      return "moved";
    case "setPriority":
      return "reprioritised";
    case "setDueDate":
      return action.dueDate === null ? "cleared of a due date" : "rescheduled";
    case "addTag":
      return "tagged";
  }
}

export function toOperations(
  action: BulkAction,
  tasks: readonly TaskDto[],
): readonly BatchOperation[] {
  return tasks.map((task) => {
    const target = { taskId: task.id, expectedVersion: task.version } as const;
    switch (action.kind) {
      case "complete":
        // A blocked task is warned about once in the toolbar, not once per row.
        return { op: "complete", ...target, acknowledgeBlocked: true };
      case "delete":
        return { op: "delete", ...target };
      case "move":
        return {
          op: "move",
          ...target,
          projectId: action.projectId,
          ...(action.statusId ? { statusId: action.statusId } : {}),
        };
      case "setPriority":
        return { op: "setPriority", ...target, priority: action.priority };
      case "setDueDate":
        return { op: "setDueDate", ...target, dueDate: action.dueDate };
      case "addTag":
        // Tags are a relation, so they carry no version to be stale (ADR-001).
        return { op: "addTag", taskId: task.id, tagId: action.tagId };
    }
  });
}

/**
 * The batch that takes a bulk change back. Each entry uses the version its own forward
 * operation produced, so a task somebody has changed since refuses rather than being
 * overwritten (spec 24.3) — and because a batch is atomic, one such refusal leaves the
 * whole undo undone rather than half-applied.
 */
export function inverseOperations(
  action: BulkAction,
  before: readonly TaskDto[],
  results: readonly BatchResultItemDto[],
  /** Everything the browser has cached, for the positions a move has to restore. */
  candidates: readonly TaskDto[],
): readonly BatchOperation[] {
  const applied = new Map(results.map((item) => [item.taskId, item.data]));
  const pairs = before.flatMap((task) => {
    const after = applied.get(task.id);
    return after ? [{ task, after }] : [];
  });

  if (action.kind === "move") return inverseMove(pairs, candidates);

  return pairs.map(({ task, after }) => {
    const target = { taskId: task.id, expectedVersion: after.version } as const;
    switch (action.kind) {
      case "complete":
        return { op: "reopen", ...target };
      case "delete":
        return { op: "restore", ...target };
      case "setPriority":
        return { op: "setPriority", ...target, priority: task.priority };
      case "setDueDate":
        return { op: "setDueDate", ...target, dueDate: task.dueDate };
      case "addTag":
        return { op: "removeTag", taskId: task.id, tagId: action.tagId };
    }
  });
}

/**
 * Undoing a bulk move puts every card back in its old column *and* in its old order
 * relative to the others that moved with it. The cards are restored bottom of the group
 * upward, each anchored to the one already back: a card still sitting in the destination
 * is not somewhere anything can be anchored to, so only cards that stayed put can be
 * outer anchors. Where the group was not contiguous it comes back compacted, which is the
 * closest thing to "where it was" that a single pass can promise.
 */
function inverseMove(
  pairs: readonly { task: TaskDto; after: TaskDto }[],
  candidates: readonly TaskDto[],
): readonly BatchOperation[] {
  const moved = new Set(pairs.map((pair) => pair.task.id));
  const byScope = new Map<string, { task: TaskDto; after: TaskDto }[]>();
  for (const pair of pairs) {
    const scope = `${pair.task.projectId ?? ""}:${pair.task.statusId ?? ""}`;
    byScope.set(scope, [...(byScope.get(scope) ?? []), pair]);
  }

  return [...byScope.values()].flatMap((group) => {
    const ordered = [...group].sort((left, right) =>
      left.task.rank < right.task.rank ? -1 : 1,
    );
    const first = ordered[0] as { task: TaskDto; after: TaskDto };
    const last = ordered.at(-1) as { task: TaskDto; after: TaskDto };
    const outerBefore = neighboursOf(first.task, candidates, moved).beforeTaskId;
    const outerAfter = neighboursOf(last.task, candidates, moved).afterTaskId;

    return ordered.map(({ task, after }, index) => ({
      op: "move" as const,
      taskId: task.id,
      expectedVersion: after.version,
      projectId: task.projectId,
      ...(task.statusId ? { statusId: task.statusId } : {}),
      beforeTaskId: index === 0 ? outerBefore : (ordered[index - 1]?.task.id ?? null),
      afterTaskId: outerAfter,
    }));
  });
}

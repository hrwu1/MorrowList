import type { StatusCategory, WorkflowStatusDto } from "@morrowlist/contracts";

/** Colour tokens a column can take; the six defaults cover the default workflow. */
export const STATUS_COLOR_TOKENS = [
  "slate",
  "blue",
  "amber",
  "red",
  "violet",
  "green",
] as const;

export const CATEGORY_LABELS: Record<StatusCategory, string> = {
  backlog: "Backlog",
  ready: "Ready",
  in_progress: "In progress",
  blocked: "Blocked",
  review: "Review",
  done: "Done",
};

export const STATUS_CATEGORY_OPTIONS = Object.keys(CATEGORY_LABELS) as StatusCategory[];

/** JS relational comparison follows code-point order, matching the rank column's C collation. */
function compareRank(left: WorkflowStatusDto, right: WorkflowStatusDto): number {
  if (left.rank === right.rank) return left.id < right.id ? -1 : 1;
  return left.rank < right.rank ? -1 : 1;
}

export interface StatusPlacement {
  /** Lower-rank predecessor. */
  readonly beforeStatusId: string | null;
  /** Higher-rank successor. */
  readonly afterStatusId: string | null;
}

/**
 * Translate "put this column at position `index` among the others" into the server's
 * neighbour contract. The moving column is removed first so it never names itself.
 */
export function placementForIndex(
  statuses: readonly WorkflowStatusDto[],
  statusId: string,
  index: number,
): StatusPlacement {
  const others = statuses.filter((status) => status.id !== statusId);
  const bounded = Math.max(0, Math.min(index, others.length));
  return {
    beforeStatusId: others[bounded - 1]?.id ?? null,
    afterStatusId: others[bounded]?.id ?? null,
  };
}

/** Reorder the cached list without a rank; the authoritative rank arrives with the reply. */
export function moveStatusInList(
  statuses: readonly WorkflowStatusDto[],
  statusId: string,
  placement: StatusPlacement,
): WorkflowStatusDto[] {
  const moving = statuses.find((status) => status.id === statusId);
  if (!moving) return [...statuses];
  const others = statuses.filter((status) => status.id !== statusId);

  let index = others.length;
  if (placement.afterStatusId) {
    const after = others.findIndex((status) => status.id === placement.afterStatusId);
    if (after !== -1) index = after;
  } else if (placement.beforeStatusId) {
    const before = others.findIndex((status) => status.id === placement.beforeStatusId);
    if (before !== -1) index = before + 1;
  }
  others.splice(index, 0, moving);
  return others;
}

/**
 * Apply one status to a cached list: replace or append it, keep the list in rank order,
 * drop it once archived, and demote the previous default when it became the default.
 */
export function patchStatusInList(
  statuses: readonly WorkflowStatusDto[],
  status: WorkflowStatusDto,
): WorkflowStatusDto[] {
  const others = statuses
    .filter((candidate) => candidate.id !== status.id)
    .map((candidate) =>
      status.isDefault && candidate.isDefault
        ? { ...candidate, isDefault: false }
        : candidate,
    );
  if (status.archivedAt !== null) return others;
  return [...others, status].sort(compareRank);
}

/**
 * What saving a category change will do to the tasks in the column (spec 11.4). Null when
 * nothing happens to them; the category still affects reporting, which the form says.
 */
export function categoryChangeConsequence(
  from: StatusCategory,
  to: StatusCategory,
  taskCount: number,
): string | null {
  const wasDone = from === "done";
  const willBeDone = to === "done";
  if (wasDone === willBeDone) return null;
  const tasks = `${taskCount} ${taskCount === 1 ? "task" : "tasks"}`;
  return willBeDone
    ? `Saving completes the ${tasks} in this column: Done columns mark work finished.`
    : `Saving reopens the ${tasks} in this column: they will no longer count as finished.`;
}

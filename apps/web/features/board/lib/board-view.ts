import type {
  ProjectBoardResponse,
  TaskDto,
  WorkflowStatusDto,
} from "@morrowlist/contracts";

export const BOARD_SORTS = ["manual", "due", "priority"] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];

export const BOARD_STAGE_VIEWS = ["focus", "all"] as const;
export type BoardStageView = (typeof BOARD_STAGE_VIEWS)[number];

const CORE_BOARD_CATEGORIES = new Set<WorkflowStatusDto["category"]>([
  "backlog",
  "ready",
  "in_progress",
  "done",
]);

const PRIORITY_WEIGHT: Record<TaskDto["priority"], number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

export function readBoardSort(params: URLSearchParams): BoardSort {
  const requested = params.get("sort");
  return BOARD_SORTS.find((sort) => sort === requested) ?? "manual";
}

/** Empty exception lanes stay out of the way unless the user explicitly asks for them. */
export function readBoardStageView(params: URLSearchParams): BoardStageView {
  return params.get("show") === "all" ? "all" : "focus";
}

/**
 * Keep the four everyday stages visible while never hiding work in Blocked or Review.
 * Status order is preserved because it is the project's canonical workflow order.
 */
export function visibleBoardStatuses(
  statuses: readonly WorkflowStatusDto[],
  tasks: readonly TaskDto[],
  stageView: BoardStageView,
): WorkflowStatusDto[] {
  if (stageView === "all") return [...statuses];

  const occupiedStatusIds = new Set(tasks.map((task) => task.statusId));
  return statuses.filter(
    (status) =>
      CORE_BOARD_CATEGORIES.has(status.category) || occupiedStatusIds.has(status.id),
  );
}

/** JS relational comparison follows code-point order, matching the rank column's C collation. */
function compareRank(left: TaskDto, right: TaskDto): number {
  if (left.rank === right.rank) return left.id < right.id ? -1 : 1;
  return left.rank < right.rank ? -1 : 1;
}

export function sortBoardTasks(tasks: readonly TaskDto[], sort: BoardSort): TaskDto[] {
  if (sort === "manual") return [...tasks];

  return [...tasks].sort((left, right) => {
    if (sort === "priority") {
      const difference =
        PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority];
      return difference || compareRank(left, right);
    }

    if (left.dueDate === null && right.dueDate !== null) return 1;
    if (left.dueDate !== null && right.dueDate === null) return -1;
    const leftDue = `${left.dueDate ?? ""}T${left.dueTime ?? "23:59"}`;
    const rightDue = `${right.dueDate ?? ""}T${right.dueTime ?? "23:59"}`;
    if (leftDue === rightDue) return compareRank(left, right);
    return leftDue < rightDue ? -1 : 1;
  });
}

export function tasksInStatus(
  tasks: readonly TaskDto[],
  statusId: string,
  sort: BoardSort,
): TaskDto[] {
  return sortBoardTasks(
    tasks.filter((task) => task.statusId === statusId),
    sort,
  );
}

export interface BoardPlacement {
  readonly statusId: string;
  /** Lower-rank predecessor. */
  readonly beforeTaskId: string | null;
  /** Higher-rank successor. */
  readonly afterTaskId: string | null;
}

/**
 * Translate a visual drop into the server's neighbour contract. The active task is
 * removed first so a same-column move cannot name itself as one of its anchors.
 */
export function placementForDrop(
  tasks: readonly TaskDto[],
  activeTaskId: string,
  statusId: string,
  overTaskId: string | null,
  insertAfter: boolean,
): BoardPlacement {
  const lane = tasks.filter(
    (task) => task.statusId === statusId && task.id !== activeTaskId,
  );
  let index = lane.length;

  if (overTaskId) {
    const overIndex = lane.findIndex((task) => task.id === overTaskId);
    if (overIndex !== -1) index = overIndex + (insertAfter ? 1 : 0);
  }

  return {
    statusId,
    beforeTaskId: lane[index - 1]?.id ?? null,
    afterTaskId: lane[index]?.id ?? null,
  };
}

export function placementChangesTask(
  tasks: readonly TaskDto[],
  task: TaskDto,
  placement: BoardPlacement,
): boolean {
  if (task.statusId !== placement.statusId) return true;
  const current = tasks.filter((candidate) => candidate.statusId === task.statusId);
  const index = current.findIndex((candidate) => candidate.id === task.id);
  if (index === -1) return true;
  return (
    (current[index - 1]?.id ?? null) !== placement.beforeTaskId ||
    (current[index + 1]?.id ?? null) !== placement.afterTaskId
  );
}

export interface OptimisticBoardMove {
  readonly taskId: string;
  readonly placement: BoardPlacement;
  readonly destination: WorkflowStatusDto;
  readonly now?: string | undefined;
  readonly authoritativeTask?: TaskDto | undefined;
}

/** Keep one flat normalized task collection while changing its lane-relative order. */
export function moveTaskInBoard(
  response: ProjectBoardResponse,
  move: OptimisticBoardMove,
): ProjectBoardResponse {
  const task = response.data.tasks.find((candidate) => candidate.id === move.taskId);
  if (!task) return response;

  const without = response.data.tasks.filter(
    (candidate) => candidate.id !== move.taskId,
  );
  const nextTask =
    move.authoritativeTask ??
    ({
      ...task,
      projectId: response.data.project.id,
      statusId: move.destination.id,
      isCompleted: move.destination.isTerminal,
      completedAt: move.destination.isTerminal
        ? (task.completedAt ?? move.now ?? new Date().toISOString())
        : null,
    } satisfies TaskDto);

  let insertionIndex = without.length;
  if (move.placement.afterTaskId) {
    const afterIndex = without.findIndex(
      (candidate) => candidate.id === move.placement.afterTaskId,
    );
    if (afterIndex !== -1) insertionIndex = afterIndex;
  } else if (move.placement.beforeTaskId) {
    const beforeIndex = without.findIndex(
      (candidate) => candidate.id === move.placement.beforeTaskId,
    );
    if (beforeIndex !== -1) insertionIndex = beforeIndex + 1;
  }

  const tasks = [...without];
  tasks.splice(insertionIndex, 0, nextTask);
  return { ...response, data: { ...response.data, tasks } };
}

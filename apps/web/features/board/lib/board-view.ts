import {
  BOARD_SWIMLANES,
  type BoardColumnDto,
  type BoardLaneDto,
  type BoardPlacementDto,
  type BoardSwimlane,
  type ProjectBoardResponse,
  type StatusCategory,
  type TaskDto,
  type WorkflowStatusDto,
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

/** Boards hide subtasks by default and show progress on the parent card (spec 8.3). */
export function readBoardSubtasks(params: URLSearchParams): boolean {
  return params.get("subtasks") === "show";
}

/** Deferred tasks stay off the board until their day unless the user asks (GAP-16). */
export function readBoardDeferred(params: URLSearchParams): boolean {
  return params.get("deferred") === "show";
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
  // The lane is unchanged by a status move, but the cell is: keep the placement in step
  // so the optimistic board draws the card under its new column straight away.
  const placements = response.data.placements.map((placement) =>
    placement.taskId === move.taskId
      ? { ...placement, columnKey: `status:${move.destination.id}` }
      : placement,
  );
  return { ...response, data: { ...response.data, tasks, placements } };
}

/* ── Swimlanes (GAP-19) ─────────────────────────────────────────────────────────── */

/** The single lane a board without swimlanes still reports, mirroring the server. */
export const ALL_LANE_KEY = "all";

export const SWIMLANE_LABELS: Record<BoardSwimlane, string> = {
  none: "No swimlanes",
  priority: "Priority",
  project: "Project",
  tag: "Tag",
  due: "Due date",
  parent: "Parent task",
};

/** The pivot is a URL choice like every other view option, so a board is shareable. */
export function readBoardSwimlane(params: URLSearchParams): BoardSwimlane {
  const requested = params.get("swimlane");
  return BOARD_SWIMLANES.find((lane) => lane === requested) ?? "none";
}

/** A board is a grid: one drop target per lane and column, addressed by both keys. */
export function cellDroppableId(laneKey: string, columnKey: string): string {
  return `cell:${laneKey}::${columnKey}`;
}

export interface BoardCell {
  readonly type: "cell";
  readonly laneKey: string;
  readonly columnKey: string;
  /** Present when the column is one project's own workflow status. */
  readonly statusId: string | null;
}

export function readBoardCell(data: unknown): BoardCell | null {
  const cell = data as Partial<BoardCell> | undefined;
  return cell?.type === "cell" && cell.laneKey && cell.columnKey
    ? {
        type: "cell",
        laneKey: cell.laneKey,
        columnKey: cell.columnKey,
        statusId: cell.statusId ?? null,
      }
    : null;
}

/** The cards of one cell, in the board's current order. */
export function tasksInCell(
  tasks: readonly TaskDto[],
  placements: readonly BoardPlacementDto[],
  laneKey: string,
  columnKey: string,
  sort: BoardSort,
): TaskDto[] {
  const inCell = new Set(
    placements
      .filter(
        (placement) =>
          placement.laneKey === laneKey && placement.columnKey === columnKey,
      )
      .map((placement) => placement.taskId),
  );
  return sortBoardTasks(
    tasks.filter((task) => inCell.has(task.id)),
    sort,
  );
}

/** Every card of one column, across lanes: the order a placement is computed against. */
export function tasksInColumn(
  tasks: readonly TaskDto[],
  placements: readonly BoardPlacementDto[],
  columnKey: string,
): TaskDto[] {
  const inColumn = new Set(
    placements
      .filter((placement) => placement.columnKey === columnKey)
      .map((placement) => placement.taskId),
  );
  return tasks.filter((task) => inColumn.has(task.id));
}

/**
 * What a drop means. Kept here rather than in the component so the rule is tested:
 * a card can cross a column, a lane, or both at once, and each is an ordinary command
 * on the canonical task — never a board-only side effect.
 */
export type BoardDropStep =
  | { readonly kind: "reorder"; readonly placement: BoardPlacement }
  | {
      readonly kind: "move";
      readonly projectId: string | null;
      readonly statusId: string | null;
      readonly statusCategory: StatusCategory | null;
      readonly placement: BoardPlacement;
    }
  | { readonly kind: "priority"; readonly priority: TaskDto["priority"] }
  | {
      readonly kind: "tag";
      readonly addTagId: string | null;
      readonly removeTagId: string | null;
    }
  | { readonly kind: "complete" }
  | { readonly kind: "reopen" };

export interface BoardDrop {
  readonly steps: readonly BoardDropStep[];
  /** Why nothing happens, for the live region; null when the drop is accepted. */
  readonly refusal: string | null;
}

export interface BoardDropInput {
  readonly task: TaskDto;
  readonly swimlaneBy: BoardSwimlane;
  readonly from: { readonly laneKey: string; readonly columnKey: string };
  readonly to: BoardCell;
  readonly lanes: readonly BoardLaneDto[];
  readonly columns: readonly BoardColumnDto[];
  readonly placement: BoardPlacement;
  /** Manual order is the only order a drop may rewrite (ADR-009). */
  readonly reorderDisabled: boolean;
}

const NOT_WRITABLE: Record<BoardSwimlane, string> = {
  none: "",
  priority: "",
  project: "",
  tag: "Cards cannot be dragged into the untagged lane; remove the tag on the card.",
  due: "Due-date lanes are read-only. Change the due date on the card instead.",
  parent: "Parent lanes are read-only. Change the parent on the card instead.",
};

export function boardDropIntent(input: BoardDropInput): BoardDrop {
  const { task, from, to } = input;
  const laneChanged = from.laneKey !== to.laneKey;
  const columnChanged = from.columnKey !== to.columnKey;
  const lane = input.lanes.find((candidate) => candidate.key === to.laneKey);
  const column = input.columns.find((candidate) => candidate.key === to.columnKey);
  if (!column) return { steps: [], refusal: null };

  if (laneChanged && !lane?.writable) {
    return { steps: [], refusal: NOT_WRITABLE[input.swimlaneBy] || null };
  }

  const steps: BoardDropStep[] = [];
  const movingProject =
    laneChanged && input.swimlaneBy === "project" ? (lane?.value ?? null) : undefined;
  const projectId = movingProject === undefined ? task.projectId : movingProject;

  if (columnChanged || movingProject !== undefined) {
    if (projectId === null) {
      // An Inbox card has no workflow status at all (spec 9.1); the only board move it
      // can make is the one that does not need one.
      if (column.isTerminal && !task.isCompleted) steps.push({ kind: "complete" });
      else if (!column.isTerminal && task.isCompleted) steps.push({ kind: "reopen" });
      else if (columnChanged) {
        return {
          steps: [],
          refusal: `${task.key} is in the Inbox. Give it a project to move it between columns.`,
        };
      }
    } else {
      steps.push({
        kind: "move",
        projectId,
        statusId: column.statusId,
        statusCategory: column.statusId === null ? column.category : null,
        placement: input.placement,
      });
    }
  } else if (!input.reorderDisabled && !laneChanged) {
    steps.push({ kind: "reorder", placement: input.placement });
  }

  if (laneChanged) {
    if (input.swimlaneBy === "priority" && lane?.value) {
      steps.push({ kind: "priority", priority: lane.value as TaskDto["priority"] });
    }
    if (input.swimlaneBy === "tag") {
      const removeTagId =
        input.lanes.find((candidate) => candidate.key === from.laneKey)?.value ?? null;
      steps.push({ kind: "tag", addTagId: lane?.value ?? null, removeTagId });
    }
  }

  return { steps, refusal: null };
}

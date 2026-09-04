import type {
  ProjectBoardResponse,
  SubtaskProgress,
  TaskDto,
  WorkflowStatusDto,
} from "@morrowlist/contracts";

import { isDeferred } from "./task-dates";

/** Pick the project's intended Inbox destination without ever targeting an archived lane. */
export function selectInboxDestination(
  statuses: readonly WorkflowStatusDto[],
): WorkflowStatusDto | undefined {
  const active = statuses.filter((status) => status.archivedAt === null);
  return active.find((status) => status.isDefault) ?? active[0];
}

/**
 * Apply one authoritative task to a board projection. Tasks that no longer belong on
 * the board are removed; newly assigned/restored tasks are appended when the cached
 * projection is complete. A truncated board is never widened speculatively.
 */
export interface BoardPatchOptions {
  /** Boards hide subtasks unless asked (spec 8.3). */
  readonly includeSubtasks?: boolean | undefined;
  /** Boards hide deferred tasks unless asked (GAP-16); `today` decides deferral. */
  readonly includeDeferred?: boolean | undefined;
  readonly today?: string | undefined;
}

export function patchTaskInBoard(
  response: ProjectBoardResponse,
  task: TaskDto,
  options: BoardPatchOptions = {},
): ProjectBoardResponse {
  const currentIndex = response.data.tasks.findIndex(
    (candidate) => candidate.id === task.id,
  );
  const deferred =
    options.today !== undefined && !options.includeDeferred
      ? isDeferred(task, options.today)
      : false;
  const belongs =
    task.deletedAt === null &&
    task.projectId === response.data.project.id &&
    task.statusId !== null &&
    (options.includeSubtasks || task.parentTaskId === null) &&
    !deferred &&
    response.data.statuses.some(
      (status) => status.id === task.statusId && status.archivedAt === null,
    );

  if (!belongs) {
    if (currentIndex === -1) return response;
    return {
      ...response,
      data: {
        ...response.data,
        tasks: response.data.tasks.filter((candidate) => candidate.id !== task.id),
      },
    };
  }

  if (currentIndex === -1) {
    if (response.page.truncated) return response;
    return {
      ...response,
      data: { ...response.data, tasks: [...response.data.tasks, task] },
    };
  }

  return {
    ...response,
    data: {
      ...response.data,
      tasks: response.data.tasks.map((candidate) =>
        candidate.id === task.id ? task : candidate,
      ),
    },
  };
}

/** Completing a parent with open children needs confirmation (spec 8.3). */
export function hasOpenSubtasks(task: TaskDto): boolean {
  return (
    task.subtaskProgress !== null &&
    task.subtaskProgress.completed < task.subtaskProgress.total
  );
}

/** Every child is done, so the UI may suggest completing the parent (spec 8.3). */
export function allSubtasksDone(task: TaskDto): boolean {
  return (
    task.subtaskProgress !== null &&
    task.subtaskProgress.completed === task.subtaskProgress.total
  );
}

/**
 * How a change to one task moves its parents' progress: completing or reopening a child
 * shifts `completed`; attaching, detaching, deleting, or restoring one shifts `total`.
 * Keyed by parent id, so one patch can update the old and the new parent of a move.
 */
export function parentProgressDeltas(
  previous: TaskDto | undefined,
  next: TaskDto,
): Map<string, SubtaskProgress> {
  const deltas = new Map<string, SubtaskProgress>();
  const previousParent =
    previous && previous.deletedAt === null ? previous.parentTaskId : null;
  const nextParent = next.deletedAt === null ? next.parentTaskId : null;

  if (previousParent === nextParent) {
    if (previousParent && previous && previous.isCompleted !== next.isCompleted) {
      deltas.set(previousParent, { completed: next.isCompleted ? 1 : -1, total: 0 });
    }
    return deltas;
  }
  if (previousParent) {
    deltas.set(previousParent, {
      completed: previous?.isCompleted ? -1 : 0,
      total: -1,
    });
  }
  if (nextParent) {
    deltas.set(nextParent, { completed: next.isCompleted ? 1 : 0, total: 1 });
  }
  return deltas;
}

export function applyProgressDelta(task: TaskDto, delta: SubtaskProgress): TaskDto {
  const current = task.subtaskProgress ?? { completed: 0, total: 0 };
  const total = Math.max(0, current.total + delta.total);
  const completed = Math.min(total, Math.max(0, current.completed + delta.completed));
  return { ...task, subtaskProgress: total === 0 ? null : { completed, total } };
}

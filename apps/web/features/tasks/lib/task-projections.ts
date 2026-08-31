import type {
  ProjectBoardResponse,
  TaskDto,
  WorkflowStatusDto,
} from "@morrowlist/contracts";

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
export function patchTaskInBoard(
  response: ProjectBoardResponse,
  task: TaskDto,
): ProjectBoardResponse {
  const currentIndex = response.data.tasks.findIndex(
    (candidate) => candidate.id === task.id,
  );
  const belongs =
    task.deletedAt === null &&
    task.projectId === response.data.project.id &&
    task.statusId !== null &&
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

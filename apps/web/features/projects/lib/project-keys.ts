import type { BoardSwimlane, ListProjectsQuery } from "@morrowlist/contracts";

/**
 * The board variants a project can be cached as: subtasks and deferred tasks shown or
 * hidden, and the swimlane it is pivoted by (GAP-19), because the lanes come back with
 * the projection rather than being derived in the browser.
 */
export interface BoardViewOptions {
  readonly includeSubtasks: boolean;
  readonly includeDeferred: boolean;
  readonly swimlaneBy?: BoardSwimlane;
}

export const projectKeys = {
  all: ["projects"] as const,
  lists: () => [...projectKeys.all, "list"] as const,
  list: (filters: Partial<ListProjectsQuery> = {}) =>
    [...projectKeys.lists(), filters] as const,
  detail: (projectId: string) => [...projectKeys.all, "detail", projectId] as const,
  boards: () => [...projectKeys.all, "board"] as const,
  /** Every cached variant of one project's board, whichever subtask view it shows. */
  projectBoards: (projectId: string) =>
    [...projectKeys.all, "board", projectId] as const,
  board: (projectId: string, view: BoardViewOptions) =>
    [...projectKeys.projectBoards(projectId), view] as const,
};

import type { ListTasksQuery, Priority, TaskDto } from "@morrowlist/contracts";

/**
 * List view state as URL state (spec 7.5, VIEW-002).
 *
 * The URL is the single source of truth for what a list is showing, so a filtered view
 * can be copied out of the address bar, bookmarked, and survives a reload. Defaults are
 * omitted from the query string: `/inbox` and `/inbox?sort=rank&order=asc` mean the same
 * thing, and only one of them is worth sharing.
 */

export const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export const DUE_FILTERS = ["overdue", "today", "future", "none"] as const;
export const SORTS = ["rank", "createdAt", "dueDate", "priority", "updatedAt"] as const;
export const ORDERS = ["asc", "desc"] as const;
export const COMPLETIONS = ["open", "done", "any"] as const;

export type DueFilter = (typeof DUE_FILTERS)[number];
export type TaskSort = (typeof SORTS)[number];
export type TaskOrder = (typeof ORDERS)[number];
export type Completion = (typeof COMPLETIONS)[number];

export interface TaskView {
  readonly priority: Priority | "any";
  readonly due: DueFilter | "any";
  /** A tag id, or "any". Ids are opaque, so anything non-empty is accepted from the URL. */
  readonly tag: string | "any";
  readonly completion: Completion;
  readonly sort: TaskSort;
  readonly order: TaskOrder;
}

/** Which list a page is showing. It comes from the route, never from a query parameter. */
export type TaskScope = "inbox" | "completed" | "trash";

export const DEFAULT_VIEW: TaskView = {
  priority: "any",
  due: "any",
  tag: "any",
  completion: "open",
  sort: "rank",
  order: "asc",
};

function oneOf<T extends string>(
  options: readonly T[],
  value: string | null,
): T | undefined {
  return options.find((option) => option === value);
}

/** Read view state from a URL. Anything unrecognised falls back to the default. */
export function readTaskView(
  params: URLSearchParams,
  base: TaskView = DEFAULT_VIEW,
): TaskView {
  return {
    priority: oneOf(PRIORITIES, params.get("priority")) ?? base.priority,
    due: oneOf(DUE_FILTERS, params.get("due")) ?? base.due,
    tag: params.get("tag")?.trim() || base.tag,
    completion: oneOf(COMPLETIONS, params.get("completed")) ?? base.completion,
    sort: oneOf(SORTS, params.get("sort")) ?? base.sort,
    order: oneOf(ORDERS, params.get("order")) ?? base.order,
  };
}

/**
 * Serialise view state back to a query string, preserving unrelated parameters such as
 * the open task panel.
 */
export function writeTaskView(
  view: TaskView,
  base: TaskView = DEFAULT_VIEW,
  preserve: URLSearchParams = new URLSearchParams(),
): string {
  const params = new URLSearchParams(preserve);
  const set = (key: string, value: string, fallback: string) => {
    if (value === fallback) params.delete(key);
    else params.set(key, value);
  };

  set("priority", view.priority, base.priority);
  set("due", view.due, base.due);
  set("tag", view.tag, base.tag);
  set("completed", view.completion, base.completion);
  set("sort", view.sort, base.sort);
  set("order", view.order, base.order);

  return params.toString();
}

/**
 * The API query behind a view. Kept separate from `TaskView` because the wire format
 * spells absence as an omitted key while the controls need a concrete "any" option.
 */
export function toListQuery(scope: TaskScope, view: TaskView): Partial<ListTasksQuery> {
  const completion: Partial<ListTasksQuery> =
    view.completion === "any" ? {} : { isCompleted: view.completion === "done" };

  return {
    ...(scope === "inbox" ? { inbox: true, ...completion } : {}),
    ...(scope === "completed" ? { isCompleted: true } : {}),
    ...(scope === "trash" ? { deleted: true } : {}),
    ...(view.priority === "any" ? {} : { priority: view.priority }),
    ...(view.due === "any" ? {} : { due: view.due }),
    ...(view.tag === "any" ? {} : { tagId: view.tag }),
    sort: view.sort,
    order: view.order,
  };
}

/**
 * Does a task still belong in a list fetched with these filters?
 *
 * Used to keep every cached projection consistent after one optimistic patch (spec 23.3)
 * rather than duplicating removal logic per view. It is deliberately conservative: `due`
 * is evaluated against the workspace timezone on the server, which the browser does not
 * know, so a due-filtered list is left to the refetch that follows the mutation.
 */
export function matchesFilters(
  task: TaskDto,
  filters: Partial<ListTasksQuery>,
): boolean {
  if (filters.deleted === true && task.deletedAt === null) return false;
  if (filters.deleted !== true && task.deletedAt !== null) return false;
  if (filters.inbox === true && task.projectId !== null) return false;
  if (filters.isCompleted !== undefined && task.isCompleted !== filters.isCompleted) {
    return false;
  }
  if (filters.priority !== undefined && task.priority !== filters.priority)
    return false;
  if (
    filters.parentTaskId !== undefined &&
    task.parentTaskId !== filters.parentTaskId
  ) {
    return false;
  }
  if (
    filters.parentTaskId === undefined &&
    filters.includeSubtasks === false &&
    task.parentTaskId !== null
  ) {
    return false;
  }
  if (filters.tagId !== undefined && !task.tags.some((tag) => tag.id === filters.tagId))
    return false;
  return true;
}

import type {
  ListTasksQuery,
  Priority,
  SavedViewFilters,
  TaskDto,
} from "@morrowlist/contracts";

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
export const BLOCKED_FILTERS = ["yes", "no"] as const;
export const DEFERRED_FILTERS = ["yes", "no"] as const;
export const DEADLINE_FILTERS = ["overdue", "week", "none"] as const;

export type DueFilter = (typeof DUE_FILTERS)[number];
export type TaskSort = (typeof SORTS)[number];
export type TaskOrder = (typeof ORDERS)[number];
export type Completion = (typeof COMPLETIONS)[number];
export type BlockedFilter = (typeof BLOCKED_FILTERS)[number];
export type DeferredFilter = (typeof DEFERRED_FILTERS)[number];
export type DeadlineFilter = (typeof DEADLINE_FILTERS)[number];

export interface TaskView {
  /** A project id, or "any". Ids are opaque, so anything non-empty is accepted. */
  readonly project: string | "any";
  readonly priority: Priority | "any";
  readonly due: DueFilter | "any";
  /** A tag id, or "any". */
  readonly tag: string | "any";
  readonly completion: Completion;
  /** Blocked state (spec 8.4): flagged or waiting on an open blocker. */
  readonly blocked: BlockedFilter | "any";
  /**
   * Deferral (GAP-16). "any" is the scope's own rule: the Inbox hides deferred tasks
   * behind its collapsed section, every other scope shows both.
   */
  readonly deferred: DeferredFilter | "any";
  readonly deadline: DeadlineFilter | "any";
  readonly sort: TaskSort;
  readonly order: TaskOrder;
}

/**
 * Which list a page is showing. It comes from the route, never from a query parameter.
 * `all` is every live task in the workspace: the scope of a saved view.
 */
export type TaskScope = "inbox" | "completed" | "trash" | "all";

export const DEFAULT_VIEW: TaskView = {
  project: "any",
  priority: "any",
  due: "any",
  tag: "any",
  completion: "open",
  blocked: "any",
  deferred: "any",
  deadline: "any",
  sort: "rank",
  order: "asc",
};

function oneOf<T extends string>(
  options: readonly T[],
  value: string | null,
): T | undefined {
  return options.find((option) => option === value);
}

/** Like `oneOf`, but an explicit "any" is a choice too: it overrides a narrower base. */
function oneOfOrAny<T extends string>(
  options: readonly T[],
  value: string | null,
): T | "any" | undefined {
  return value === "any" ? "any" : oneOf(options, value);
}

/** Read view state from a URL. Anything unrecognised falls back to the default. */
export function readTaskView(
  params: URLSearchParams,
  base: TaskView = DEFAULT_VIEW,
): TaskView {
  return {
    project: params.get("project")?.trim() || base.project,
    priority: oneOfOrAny(PRIORITIES, params.get("priority")) ?? base.priority,
    due: oneOfOrAny(DUE_FILTERS, params.get("due")) ?? base.due,
    tag: params.get("tag")?.trim() || base.tag,
    completion: oneOf(COMPLETIONS, params.get("completed")) ?? base.completion,
    blocked: oneOf(BLOCKED_FILTERS, params.get("blocked")) ?? base.blocked,
    deferred: oneOfOrAny(DEFERRED_FILTERS, params.get("deferred")) ?? base.deferred,
    deadline: oneOfOrAny(DEADLINE_FILTERS, params.get("deadline")) ?? base.deadline,
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

  set("project", view.project, base.project);
  set("priority", view.priority, base.priority);
  set("due", view.due, base.due);
  set("tag", view.tag, base.tag);
  set("completed", view.completion, base.completion);
  set("blocked", view.blocked, base.blocked);
  set("deferred", view.deferred, base.deferred);
  set("deadline", view.deadline, base.deadline);
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
    // The Inbox hides deferred tasks; the page lists them in a collapsed section (GAP-16).
    ...(scope === "inbox" ? { inbox: true, deferred: false, ...completion } : {}),
    ...(scope === "all" ? completion : {}),
    ...(scope === "completed" ? { isCompleted: true } : {}),
    ...(scope === "trash" ? { deleted: true } : {}),
    ...(view.project === "any" ? {} : { projectId: view.project }),
    ...(view.priority === "any" ? {} : { priority: view.priority }),
    ...(view.due === "any" ? {} : { due: view.due }),
    ...(view.tag === "any" ? {} : { tagId: view.tag }),
    ...(view.blocked === "any" ? {} : { isBlocked: view.blocked === "yes" }),
    // An explicit choice overrides the Inbox's default of hiding deferred tasks.
    ...(view.deferred === "any" ? {} : { deferred: view.deferred === "yes" }),
    ...(view.deadline === "any" ? {} : { deadline: view.deadline }),
    sort: view.sort,
    order: view.order,
  };
}

/**
 * The filter set a saved view stores (spec 9.8): the list query without paging. Inbox
 * and All are saveable scopes; Completed is a fixed route, so a view saved from it keeps
 * "done" as its completion instead of the route's constraint. Trash is never saved.
 */
export function filtersFromView(scope: TaskScope, view: TaskView): SavedViewFilters {
  const query = toListQuery(
    scope === "inbox" ? "inbox" : "all",
    scope === "completed" ? { ...view, completion: "done" } : view,
  );
  const { deleted: _deleted, ...filters } = query;
  return filters as SavedViewFilters;
}

/** A saved view's filters back as a scope and the controls' state. */
export function viewFromFilters(filters: SavedViewFilters): {
  readonly scope: TaskScope;
  readonly view: TaskView;
} {
  return {
    scope: filters.inbox ? "inbox" : "all",
    view: {
      project: filters.projectId ?? "any",
      priority: filters.priority ?? "any",
      due: filters.due ?? "any",
      tag: filters.tagId ?? "any",
      blocked:
        filters.isBlocked === undefined ? "any" : filters.isBlocked ? "yes" : "no",
      // `deferred: false` on an Inbox view is the scope's own rule, not a choice.
      deferred:
        filters.deferred === undefined || (filters.inbox && !filters.deferred)
          ? "any"
          : filters.deferred
            ? "yes"
            : "no",
      deadline: filters.deadline ?? "any",
      completion:
        filters.isCompleted === undefined
          ? "any"
          : filters.isCompleted
            ? "done"
            : "open",
      sort: filters.sort ?? "rank",
      order: filters.order ?? "asc",
    },
  };
}

/**
 * Does a task still belong in a list fetched with these filters?
 *
 * Used to keep every cached projection consistent after one optimistic patch (spec 23.3)
 * rather than duplicating removal logic per view. It is deliberately conservative: `due`
 * and `deferred` are evaluated against the workspace timezone on the server, which the
 * browser does not know, so those lists are left to the refetch that follows the mutation.
 */
export function matchesFilters(
  task: TaskDto,
  filters: Partial<ListTasksQuery>,
): boolean {
  if (filters.deleted === true && task.deletedAt === null) return false;
  if (filters.deleted !== true && task.deletedAt !== null) return false;
  if (filters.inbox === true && task.projectId !== null) return false;
  if (filters.projectId !== undefined && task.projectId !== filters.projectId) {
    return false;
  }
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
  if (filters.isBlocked !== undefined && task.isBlocked !== filters.isBlocked) {
    return false;
  }
  if (filters.seriesId !== undefined && task.seriesId !== filters.seriesId)
    return false;
  return true;
}

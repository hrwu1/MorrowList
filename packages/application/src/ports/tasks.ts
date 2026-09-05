import { PROJECT_BOARD_TASK_LIMIT, UPCOMING_TASK_LIMIT } from "@morrowlist/contracts";
import type {
  ChildProgress,
  FieldFilter,
  PlainDate,
  RelationType,
  Tag,
  Task,
  TaskRelation,
} from "@morrowlist/domain";

/** Persistence ports for tasks. Implemented by `@morrowlist/database`. */

export interface TaskFilter {
  readonly workspaceId: string;
  readonly projectId?: string | undefined;
  readonly statusId?: string | undefined;
  readonly parentTaskId?: string | undefined;
  readonly priority?: Task["priority"] | undefined;
  /** Only tasks carrying this tag (spec 9.8). */
  readonly tagId?: string | undefined;
  /** Every occurrence of one repeating task (GAP-12). */
  readonly seriesId?: string | undefined;
  /** True selects Inbox tasks only: those with no project (spec 9.1). */
  readonly inboxOnly?: boolean | undefined;
  readonly isCompleted?: boolean | undefined;
  /**
   * Blocked state as the domain defines it (spec 8.4): open and either flagged or
   * waiting on a live, incomplete `blocks` predecessor.
   */
  readonly isBlocked?: boolean | undefined;
  /**
   * Select soft-deleted tasks instead of live ones — the Trash view (spec 9.7). Off by
   * default, because a deleted task is excluded from every normal view (spec 8.2
   * invariant 10). There is deliberately no "both" option: no view shows a mix.
   */
  readonly deletedOnly?: boolean | undefined;
  readonly includeSubtasks?: boolean | undefined;
  readonly due?: "overdue" | "today" | "future" | "none" | undefined;
  /**
   * Deferral is a date comparison at read time (GAP-16): `true` selects tasks whose
   * `deferUntil` is after `today`, `false` excludes them; omitted means both.
   */
  readonly deferred?: boolean | undefined;
  /** `week` is a deadline from `today` through the next seven days inclusive. */
  readonly deadline?: "overdue" | "week" | "none" | undefined;
  /**
   * Typed custom-field filters (GAP-24), already resolved against their definitions so
   * the values are in stored form. Combined with AND, at most `MAX_FIELD_FILTERS`.
   */
  readonly fields?: readonly FieldFilter[] | undefined;
  /** The workspace's local date, for the `due`, `deferred`, and `deadline` filters (spec 12.3). */
  readonly today?: string | undefined;
  readonly sort?:
    | "rank"
    | "createdAt"
    | "dueDate"
    | "priority"
    | "updatedAt"
    | undefined;
  readonly order?: "asc" | "desc" | undefined;
}

/**
 * Full-text search (spec 9.8): every filter of a list plus prefix terms matched against
 * the title, the description and the names of the task's tags. Ordered by relevance
 * (title hits first), then newest id, with a keyset cursor on that order.
 */
export interface TaskSearchQuery extends TaskFilter {
  readonly terms: readonly string[];
}

export interface Cursor {
  readonly limit: number;
  readonly after?: string | undefined;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * The project-board read is deliberately bounded. Unlike the cursor-paginated list views,
 * a board has to be internally complete enough to support cross-column ordering in one
 * response, so the repository reports when its hard cap omitted additional cards.
 */
export interface BoardTaskPage {
  readonly items: readonly Task[];
  readonly hasMore: boolean;
  readonly truncated: boolean;
}

export interface BoardTaskQuery {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly limit?: number | undefined;
  /** Boards hide subtasks unless asked to show them (spec 8.3). */
  readonly includeSubtasks?: boolean | undefined;
  /** Boards also hide deferred tasks by default (GAP-16); `today` decides deferral. */
  readonly includeDeferred?: boolean | undefined;
  readonly today?: PlainDate | undefined;
}

export const BOARD_TASK_LIMIT = PROJECT_BOARD_TASK_LIMIT;
export const UPCOMING_LIMIT = UPCOMING_TASK_LIMIT;

/**
 * The Today read: every open task that is overdue, due on `date`, or planned for `date`,
 * in one bounded query (spec 9.2). The projection is complete for any realistic day; the
 * cap only guards a pathological workspace.
 */
export interface TodayTaskQuery {
  readonly workspaceId: string;
  readonly date: PlainDate;
  readonly limit?: number | undefined;
}

/** Open tasks due after `from` and, when `to` is set, on or before it (spec 9.3). */
export interface UpcomingTaskQuery {
  readonly workspaceId: string;
  readonly from: PlainDate;
  readonly to: PlainDate | null;
  readonly limit?: number | undefined;
}

/**
 * A relation with both endpoints loaded, so a page can show the other task's key and
 * title and decide whether an incomplete predecessor blocks it (spec 8.4).
 */
export interface RelationEdge {
  readonly relation: TaskRelation;
  readonly source: Task;
  readonly target: Task;
}

/** How far the blocks-cycle walk follows edges before giving up (spec 29.1 scale). */
export const BLOCKS_WALK_DEPTH = 64;

/** The ordering scope a rank is unique within: an Inbox, or a project status column. */
export interface RankScope {
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly statusId: string | null;
}

export interface TaskRepository {
  findById(workspaceId: string, taskId: string): Promise<Task | null>;
  findByNumber(workspaceId: string, taskNumber: number): Promise<Task | null>;
  list(filter: TaskFilter, cursor: Cursor): Promise<Page<Task>>;
  search(query: TaskSearchQuery, cursor: Cursor): Promise<Page<Task>>;
  /** Active project tasks ordered by status rank, then task rank, in one data query. */
  listBoard(query: BoardTaskQuery): Promise<BoardTaskPage>;
  listToday(query: TodayTaskQuery): Promise<BoardTaskPage>;
  /** Ordered by due date, then rank. */
  listUpcoming(query: UpcomingTaskQuery): Promise<BoardTaskPage>;
  /**
   * Every task referencing a status, trashed ones included, in rank order. Used to empty
   * a column before it is archived (spec 8.6), so nothing may be left behind.
   */
  listInStatus(workspaceId: string, statusId: string): Promise<readonly Task[]>;
  /**
   * Every open task in an active in-progress column, across the workspace's projects, in
   * project then rank order: the work the cross-project limit counts (GAP-20).
   */
  listInProgress(workspaceId: string): Promise<readonly Task[]>;
  insert(task: Task): Promise<void>;
  /**
   * Persist a task, guarding on the version the caller loaded. Returns false when the
   * row changed underneath, which the command turns into TASK_VERSION_CONFLICT.
   */
  update(task: Task, previousVersion: number): Promise<boolean>;
  hardDelete(workspaceId: string, taskId: string): Promise<void>;
  /** Neighbouring ranks for placing a task at an end of a scope (spec 24.1). */
  firstRankIn(scope: RankScope): Promise<string | null>;
  lastRankIn(scope: RankScope): Promise<string | null>;
  /** Ranks of two anchor tasks, used to place a task between neighbours (spec 24.2). */
  ranksOf(
    workspaceId: string,
    taskIds: readonly string[],
  ): Promise<Map<string, string>>;
  /** Ancestor chain of a task, nearest parent first, for cycle and depth checks. */
  ancestorIds(workspaceId: string, taskId: string): Promise<readonly string[]>;
  /** Levels below a task: 0 for a leaf, 1 with children, 2 with grandchildren. */
  descendantDepth(workspaceId: string, taskId: string): Promise<number>;
  /**
   * Direct-child progress for many parents in one query (spec 8.3, 29.3). Parents with
   * no live children are absent from the result.
   */
  childSummary(
    workspaceId: string,
    taskIds: readonly string[],
  ): Promise<ReadonlyMap<string, ChildProgress>>;
  /**
   * The tags of a page of tasks in one query (spec 29.3), keyed by task id and ordered
   * by normalized name then id so every response lists them the same way (spec 12.1).
   */
  tagsFor(
    workspaceId: string,
    taskIds: readonly string[],
  ): Promise<Map<string, readonly Tag[]>>;
  addTag(taskId: string, tagId: string, createdAt: Date): Promise<void>;
  removeTag(taskId: string, tagId: string): Promise<void>;
  /**
   * Every relation touching any of the tasks, each once, with both endpoints, in one
   * query (spec 29.3). Ordered by creation then id so lists are stable.
   */
  relationsFor(
    workspaceId: string,
    taskIds: readonly string[],
  ): Promise<readonly RelationEdge[]>;
  findRelation(workspaceId: string, relationId: string): Promise<TaskRelation | null>;
  /** Returns false when the same edge already exists (unique source, target, type). */
  insertRelation(relation: TaskRelation): Promise<boolean>;
  deleteRelation(workspaceId: string, relationId: string): Promise<void>;
  /**
   * Ids reachable from a task by following `type` edges source → target, walked at
   * most `BLOCKS_WALK_DEPTH` levels, for the cycle check (spec 8.2 invariant 5).
   */
  downstreamOf(
    workspaceId: string,
    taskId: string,
    type: RelationType,
  ): Promise<readonly string[]>;
}

export interface TaskCounterRepository {
  /**
   * Materialise the counter row for a new workspace without consuming a number, so the
   * workspace's first task is number 1.
   */
  ensure(workspaceId: string): Promise<void>;
  /**
   * Allocate the next task number for a workspace inside the current transaction.
   * Implementations must serialise concurrent callers with row locking or an atomic
   * upsert so two tasks never share a number (spec 18.2).
   */
  allocate(workspaceId: string): Promise<number>;
}

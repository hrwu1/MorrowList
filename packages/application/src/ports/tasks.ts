import { PROJECT_BOARD_TASK_LIMIT, UPCOMING_TASK_LIMIT } from "@morrowlist/contracts";
import type { PlainDate, Task } from "@morrowlist/domain";

/** Persistence ports for tasks. Implemented by `@morrowlist/database`. */

export interface TaskFilter {
  readonly workspaceId: string;
  readonly projectId?: string | undefined;
  readonly statusId?: string | undefined;
  readonly parentTaskId?: string | undefined;
  readonly priority?: Task["priority"] | undefined;
  /** True selects Inbox tasks only: those with no project (spec 9.1). */
  readonly inboxOnly?: boolean | undefined;
  readonly isCompleted?: boolean | undefined;
  /**
   * Select soft-deleted tasks instead of live ones — the Trash view (spec 9.7). Off by
   * default, because a deleted task is excluded from every normal view (spec 8.2
   * invariant 10). There is deliberately no "both" option: no view shows a mix.
   */
  readonly deletedOnly?: boolean | undefined;
  readonly includeSubtasks?: boolean | undefined;
  readonly due?: "overdue" | "today" | "future" | "none" | undefined;
  /** The workspace's local date, for evaluating the `due` filter (spec 12.3). */
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
  /** Active project tasks ordered by status rank, then task rank, in one data query. */
  listBoard(query: BoardTaskQuery): Promise<BoardTaskPage>;
  listToday(query: TodayTaskQuery): Promise<BoardTaskPage>;
  /** Ordered by due date, then rank. */
  listUpcoming(query: UpcomingTaskQuery): Promise<BoardTaskPage>;
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

import type { Task } from "@morrowlist/domain";

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

import type { StatusCategory, StatusInterval } from "@morrowlist/domain";

/**
 * Status-interval persistence (GAP-17). Written inside the same transaction as the task
 * change that opens or closes the interval, read in bulk for boards and flow metrics.
 */

export interface StatusIntervalInput {
  readonly id: string;
  readonly taskId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly statusId: string;
  readonly category: StatusCategory;
  readonly enteredAt: Date;
}

export interface StatusIntervalRepository {
  /** Open the interval the task is in now. The task must have no open interval. */
  open(interval: StatusIntervalInput): Promise<void>;
  /** Close the task's open interval, if it has one. */
  close(taskId: string, leftAt: Date): Promise<void>;
  /** Every interval of the given tasks, for card age. */
  listForTasks(
    workspaceId: string,
    taskIds: readonly string[],
  ): Promise<readonly StatusInterval[]>;
  /**
   * The full history of every task in the project that was on its board at any point
   * since `since`: the intervals still open or left after that instant, plus the earlier
   * intervals of the same tasks so cycle and lead time can look back to the start.
   */
  listForProject(
    workspaceId: string,
    projectId: string,
    since: Date,
  ): Promise<readonly StatusInterval[]>;
}

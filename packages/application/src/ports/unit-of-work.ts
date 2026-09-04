import type { DayPlanRepository } from "./day-plans.js";
import type { ActivityRepository, OutboxRepository } from "./events.js";
import type { StatusIntervalRepository } from "./flow.js";
import type { ProjectRepository, WorkflowStatusRepository } from "./projects.js";
import type { TagRepository } from "./tags.js";
import type { TaskCounterRepository, TaskRepository } from "./tasks.js";
import type { WorkspaceRepository } from "./workspace.js";

/**
 * The repository set visible inside one transaction (spec 17.3 step 7). A command
 * receives this handle rather than individual repositories so that its data change, its
 * activity row, and its outbox row cannot be committed separately.
 */
export interface TransactionContext {
  readonly tasks: TaskRepository;
  readonly taskCounters: TaskCounterRepository;
  readonly dayPlans: DayPlanRepository;
  readonly projects: ProjectRepository;
  readonly statuses: WorkflowStatusRepository;
  readonly tags: TagRepository;
  readonly statusIntervals: StatusIntervalRepository;
  readonly workspaces: WorkspaceRepository;
  readonly activity: ActivityRepository;
  readonly outbox: OutboxRepository;
}

/**
 * Transaction boundary port (spec 17.4). The database package implements it; the
 * application layer stays unaware of Drizzle and of connection handling.
 */
export interface UnitOfWork {
  execute<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

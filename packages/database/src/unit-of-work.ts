import type { TransactionContext, UnitOfWork } from "@morrowlist/application";

import type { Database, DatabaseHandle } from "./client.js";
import {
  createActivityRepository,
  createOutboxRepository,
} from "./repositories/events.js";
import {
  createProjectRepository,
  createWorkflowStatusRepository,
} from "./repositories/projects.js";
import {
  createTaskCounterRepository,
  createTaskRepository,
} from "./repositories/tasks.js";
import { createWorkspaceRepository } from "./repositories/workspaces.js";

/**
 * Transaction boundary (spec 17.3 step 7, FND-005).
 *
 * Every repository handed to the callback is bound to the same transaction, so the data
 * change, the activity row, and the outbox row commit or roll back together. Throwing
 * from the callback aborts the transaction.
 */
export function buildTransactionContext(db: Database): TransactionContext {
  return {
    tasks: createTaskRepository(db),
    taskCounters: createTaskCounterRepository(db),
    projects: createProjectRepository(db),
    statuses: createWorkflowStatusRepository(db),
    workspaces: createWorkspaceRepository(db),
    activity: createActivityRepository(db),
    outbox: createOutboxRepository(db),
  };
}

export function createUnitOfWork(handle: DatabaseHandle): UnitOfWork {
  return {
    execute<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
      return handle.db.transaction(async (tx) =>
        fn(buildTransactionContext(tx as unknown as Database)),
      );
    },
  };
}

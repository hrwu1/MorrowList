export {
  checkDatabaseHealth,
  createDatabase,
  type CreateDatabaseOptions,
  type Database,
  type DatabaseHandle,
} from "./client.js";
export { migrate, type MigrateOptions, type MigrateResult } from "./migrate.js";
export { buildTransactionContext, createUnitOfWork } from "./unit-of-work.js";
export { createDayPlanRepository } from "./repositories/day-plans.js";
export {
  createActivityRepository,
  createOutboxRepository,
} from "./repositories/events.js";
export {
  createProjectRepository,
  createWorkflowStatusRepository,
} from "./repositories/projects.js";
export {
  createTaskCounterRepository,
  createTaskRepository,
} from "./repositories/tasks.js";
export { createWorkspaceRepository } from "./repositories/workspaces.js";
export {
  toProject,
  toTask,
  toWorkflowStatus,
  toWorkspace,
} from "./repositories/mappers.js";
export {
  setupTestDatabase,
  teardownTestDatabase,
  testDatabaseUrl,
  truncateAll,
} from "./test-harness.js";

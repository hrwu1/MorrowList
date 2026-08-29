import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Enumerations shared across tables. Postgres enums are used rather than free text so an
 * invalid value cannot be written even by a direct SQL statement.
 */

export const actorKindEnum = pgEnum("actor_kind", [
  "user",
  "api_key",
  "system",
  "integration",
  // Reserved and unused in the MVP; present so audit history needs no migration when
  // agent execution lands (spec 17.4).
  "agent",
]);

export const priorityEnum = pgEnum("task_priority", [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
]);

export const statusCategoryEnum = pgEnum("workflow_status_category", [
  "backlog",
  "ready",
  "in_progress",
  "blocked",
  "review",
  "done",
]);

export const workspaceRoleEnum = pgEnum("workspace_role", [
  "owner",
  "admin",
  "member",
  "viewer",
]);

export const aggregateTypeEnum = pgEnum("aggregate_type", [
  "task",
  "project",
  "status",
  "tag",
  "workspace",
]);

export const relationTypeEnum = pgEnum("task_relation_type", ["blocks", "related_to"]);

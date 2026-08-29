import { z } from "zod";

import { actorKindSchema, uuidSchema } from "./common.js";

/**
 * Domain event envelope (spec 19.6). The MVP writes events to the transactional outbox
 * and exposes them for inspection; external delivery is deferred, but the envelope is
 * fixed now so that adding a dispatcher later is not a breaking change.
 */

export const EVENT_SCHEMA_VERSION = 1;

export const aggregateTypeSchema = z.enum([
  "task",
  "project",
  "status",
  "tag",
  "workspace",
]);

export const domainEventSchema = z.object({
  id: uuidSchema,
  schemaVersion: z.number().int().positive(),
  type: z.string(),
  aggregateType: aggregateTypeSchema,
  aggregateId: uuidSchema,
  workspaceId: uuidSchema,
  actor: z.object({ kind: actorKindSchema, id: z.string() }),
  occurredAt: z.iso.datetime(),
  correlationId: z.string(),
  causationId: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
});

/** Event catalogue implemented in this slice (spec 19.5). */
export const TASK_EVENTS = {
  created: "task.created",
  updated: "task.updated",
  moved: "task.moved",
  reordered: "task.reordered",
  completed: "task.completed",
  reopened: "task.reopened",
  deleted: "task.deleted",
  restored: "task.restored",
} as const;

export const WORKSPACE_EVENTS = {
  created: "workspace.created",
} as const;

export const PROJECT_EVENTS = {
  created: "project.created",
  updated: "project.updated",
  archived: "project.archived",
  restored: "project.restored",
} as const;

export type AggregateType = z.infer<typeof aggregateTypeSchema>;
export type DomainEvent = z.infer<typeof domainEventSchema>;

export const activityEventSchema = z.object({
  id: uuidSchema,
  workspaceId: uuidSchema,
  aggregateType: aggregateTypeSchema,
  aggregateId: uuidSchema,
  eventType: z.string(),
  actorKind: actorKindSchema,
  actorId: z.string(),
  actorDisplayName: z.string().nullable(),
  summary: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});

export type ActivityEventDto = z.infer<typeof activityEventSchema>;

import { z } from "zod";

import {
  actorKindSchema,
  paginated,
  paginationQuerySchema,
  uuidSchema,
} from "./common.js";

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
  "saved_view",
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
  /**
   * Payload: `{ taskId, taskNumber, projectId, statusId, priority, parentTaskId,
   * seriesId }` plus `spawnedFrom` when completion of a repeating task created it.
   */
  created: "task.created",
  updated: "task.updated",
  moved: "task.moved",
  reordered: "task.reordered",
  completed: "task.completed",
  reopened: "task.reopened",
  deleted: "task.deleted",
  restored: "task.restored",
  /** My Day add/remove (spec 9.2). Payload: `{ taskId, planDate, source }`. */
  dayAdded: "task.day_added",
  dayRemoved: "task.day_removed",
  /** Payload: `{ taskId, previousParentId, parentId }`. */
  parentChanged: "task.parent_changed",
  /** Payload: `{ taskId, tagId, tagName }`. */
  tagAdded: "task.tag_added",
  tagRemoved: "task.tag_removed",
  /**
   * Relationship add/remove (spec 8.4), recorded on both endpoint tasks. Payload:
   * `{ taskId, relationId, type, sourceTaskId, targetTaskId, otherTaskId, otherTaskKey }`.
   */
  relationAdded: "task.relation_added",
  relationRemoved: "task.relation_removed",
  /** The blocker flag (spec 8.4, GAP-06). Payload: `{ taskId, reason, since }`. */
  blocked: "task.blocked",
  /** Payload: `{ taskId, reason, since, clearedAt }`. */
  unblocked: "task.unblocked",
  /** A repeating task moved on without being done. Payload: `{ taskId, changes }`. */
  occurrenceSkipped: "task.occurrence_skipped",
} as const;

export const TAG_EVENTS = {
  created: "tag.created",
  updated: "tag.updated",
  deleted: "tag.deleted",
} as const;

export const WORKSPACE_EVENTS = {
  created: "workspace.created",
  /** Payload: `{ workspaceId, changes }` with the field-level diff (GAP-20). */
  updated: "workspace.updated",
} as const;

export const PROJECT_EVENTS = {
  created: "project.created",
  updated: "project.updated",
  archived: "project.archived",
  restored: "project.restored",
} as const;

export const WORKFLOW_STATUS_EVENTS = {
  created: "workflow_status.created",
  updated: "workflow_status.updated",
  reordered: "workflow_status.reordered",
  archived: "workflow_status.archived",
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

/**
 * Activity read model (ACT-001, spec 10.2). A stored event is exposed as-is plus a
 * `changes` list mapped from its payload for the user-facing fields only, so a client can
 * render a diff without knowing how any payload is shaped — and never has to show raw
 * payload JSON (spec 26.2).
 */
export const activityChangeSchema = z.object({
  field: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
});

export const activityEntrySchema = activityEventSchema.extend({
  changes: z.array(activityChangeSchema),
});

export const activityQuerySchema = paginationQuerySchema;
export const activityListResponseSchema = paginated(activityEntrySchema);

export type ActivityChangeDto = z.infer<typeof activityChangeSchema>;
export type ActivityEntryDto = z.infer<typeof activityEntrySchema>;
export type ActivityQuery = z.infer<typeof activityQuerySchema>;
export type ActivityListResponse = z.infer<typeof activityListResponseSchema>;

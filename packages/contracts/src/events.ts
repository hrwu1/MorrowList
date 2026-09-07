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
  "field",
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
/** Address lifecycle events never contain the capability or email body. */
export const INBOUND_EVENTS = {
  addressRotated: "workspace.inbound_address_rotated",
} as const;

export const TASK_EVENTS = {
  /**
   * Payload: `{ taskId, taskNumber, projectId, statusId, priority, parentTaskId,
   * seriesId }` plus `spawnedFrom` when completion of a repeating task created it, or
   * `importedFrom` (`{ source, id }`) when an import did (GAP-07).
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
  /** A reminder was delivered (GAP-13). Payload: `{ taskId, remindAt, recipients, channels }`. */
  reminderSent: "task.reminder_sent",
  /** Payload: `{ taskId, notificationId, remindAt }`. */
  reminderSnoozed: "task.reminder_snoozed",
  /**
   * One administrative summary for a bulk edit (GAP-08, spec 10.4), written once per
   * `POST /tasks/batch` beside the ordinary per-task rows the individual operations
   * record. It is anchored to the batch's first task so it is reachable from that task's
   * history; the correlation id on every row of the transaction is what groups them.
   * Payload: `{ taskIds, operations: [{ op, taskId }], count }`.
   */
  batchApplied: "task.batch_applied",
} as const;

export const TAG_EVENTS = {
  created: "tag.created",
  updated: "tag.updated",
  deleted: "tag.deleted",
} as const;

/** Payload: `{ viewId, name, layout, filters }`; updated adds `changes`. */
/**
 * Typed custom-field definitions (GAP-24). Payload: `{ fieldId, key, name, type }`;
 * `updated` adds `changes`, and `deleted` adds `taskCount` — how many tasks lost a value
 * when the definition went.
 */
export const FIELD_EVENTS = {
  created: "field.created",
  updated: "field.updated",
  deleted: "field.deleted",
} as const;

export const SAVED_VIEW_EVENTS = {
  created: "saved_view.created",
  updated: "saved_view.updated",
  deleted: "saved_view.deleted",
} as const;

export const WORKSPACE_EVENTS = {
  created: "workspace.created",
  /** Payload: `{ workspaceId, changes }` with the field-level diff (GAP-20). */
  updated: "workspace.updated",
  /** Payload: `{ workspaceId, userId, date, counts }` (GAP-13). */
  digestSent: "workspace.digest_sent",
  /** Payload: `{ workspaceId, userId, changes }`. */
  notificationPreferencesUpdated: "workspace.notification_preferences_updated",
  /**
   * A Trello board or a CSV became a project (GAP-07). Payload:
   * `{ workspaceId, source, projectId, projectName, counts }`.
   */
  imported: "workspace.imported",
  /**
   * Webhook subscriptions (GAP-18). Recorded on the workspace because a subscription is
   * workspace configuration, not an aggregate of its own. Payload:
   * `{ subscriptionId, url, eventTypes }`; updated adds `changes`. The secret never
   * appears in a payload, an activity summary, or a log line.
   */
  webhookCreated: "workspace.webhook_created",
  webhookUpdated: "workspace.webhook_updated",
  webhookDeleted: "workspace.webhook_deleted",
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

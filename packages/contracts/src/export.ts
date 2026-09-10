import { z } from "zod";

import {
  actorSchema,
  plainDateSchema,
  plainTimeSchema,
  prioritySchema,
  statusCategorySchema,
  timezoneSchema,
  uuidSchema,
} from "./common.js";
import { activityEventSchema } from "./events.js";
import { fieldTypeSchema, fieldValuesSchema } from "./field.js";
import { savedViewFiltersSchema, savedViewLayoutSchema } from "./saved-view.js";
import {
  listTasksQuerySchema,
  recurrenceRuleSchema,
  relationTypeSchema,
  reminderOffsetSchema,
} from "./task.js";

/**
 * Data portability (spec 30, GAP-07).
 *
 * The archive is the canonical rows, not the read projections: a `TaskDto` drops `rank`,
 * `lastActiveStatusId`, the blocker flag and `deletedAt`, and a restore needs all four.
 * Nothing here is a secret — no password hash, session token, API key, or push
 * registration key is exportable, by construction (spec 30.1).
 *
 * Derived tables are deliberately absent: `task_status_intervals` is rebuilt by
 * `pnpm db:backfill-flow` (GAP-17) and `task_reminders` is recomputed from the task's
 * `reminderOffsetMinutes` on every write (GAP-13).
 *
 * Adding a section is additive — a new key here plus a reader — and does not bump
 * `schemaVersion`; removing or reshaping one does.
 */

export const EXPORT_FORMAT = "morrowlist-export";
export const EXPORT_SCHEMA_VERSION = 1;

/** How much history the archive carries; the size control of spec 30.1. */
export const exportActivityScopeSchema = z.enum(["none", "tasks", "all"]);

export const exportWorkspaceQuerySchema = z.object({
  activity: exportActivityScopeSchema.default("all"),
});

/** The CSV export takes the task list query, minus paging: it writes every match. */
export const exportTasksCsvQuerySchema = listTasksQuerySchema.omit({
  cursor: true,
  limit: true,
});

export const exportedWorkspaceSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  taskKeyPrefix: z.string(),
  timezone: timezoneSchema,
  inProgressLimit: z.number().int().positive().nullable(),
  createdByUserId: uuidSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const exportedProjectSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  descriptionMd: z.string().nullable(),
  colorToken: z.string(),
  icon: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const exportedStatusSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  name: z.string(),
  category: statusCategorySchema,
  rank: z.string(),
  colorToken: z.string(),
  wipLimit: z.number().int().positive().nullable(),
  isDefault: z.boolean(),
  policyMd: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
});

export const exportedTaskSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  taskNumber: z.number().int().positive(),
  projectId: uuidSchema.nullable(),
  statusId: uuidSchema.nullable(),
  title: z.string(),
  descriptionMd: z.string().nullable(),
  priority: prioritySchema,
  dueDate: plainDateSchema.nullable(),
  dueTime: plainTimeSchema.nullable(),
  dueTimezone: timezoneSchema.nullable(),
  deferUntil: plainDateSchema.nullable(),
  deadline: plainDateSchema.nullable(),
  deadlineTime: plainTimeSchema.nullable(),
  reminderOffsetMinutes: reminderOffsetSchema.nullable(),
  parentTaskId: uuidSchema.nullable(),
  recurrence: recurrenceRuleSchema.nullable(),
  seriesId: uuidSchema.nullable(),
  rank: z.string(),
  lastActiveStatusId: uuidSchema.nullable(),
  completedAt: z.iso.datetime().nullable(),
  blockedReason: z.string().nullable(),
  blockedSince: z.iso.datetime().nullable(),
  version: z.number().int().positive(),
  createdBy: actorSchema,
  lastActor: actorSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
  /**
   * Typed custom field values, keyed by the definition's `key` (GAP-24). Defaults to `{}`
   * so an archive written before fields were exportable still validates.
   */
  fields: fieldValuesSchema.default({}),
});

/** A workspace's field definitions; the values live on each task (GAP-24, spec 20.3). */
export const exportedFieldSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  name: z.string(),
  type: fieldTypeSchema,
  options: z.array(z.string()),
  rank: z.string(),
  showOnCard: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const exportedTagSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  normalizedName: z.string(),
  colorToken: z.string(),
  description: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const exportedTaskTagSchema = z.object({
  taskId: uuidSchema,
  tagId: uuidSchema,
});

export const exportedRelationSchema = z.object({
  id: uuidSchema,
  sourceTaskId: uuidSchema,
  targetTaskId: uuidSchema,
  type: relationTypeSchema,
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});

/** My Day history: the dated relation, never a field copied onto the task (ADR-001). */
export const exportedDayPlanSchema = z.object({
  taskId: uuidSchema,
  planDate: plainDateSchema,
});

export const exportedSavedViewSchema = z.object({
  id: uuidSchema,
  ownerUserId: uuidSchema,
  name: z.string(),
  filters: savedViewFiltersSchema,
  layout: savedViewLayoutSchema,
  rank: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const workspaceExportSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  exportedAt: z.iso.datetime(),
  workspace: exportedWorkspaceSchema,
  projects: z.array(exportedProjectSchema),
  statuses: z.array(exportedStatusSchema),
  tasks: z.array(exportedTaskSchema),
  fields: z.array(exportedFieldSchema),
  tags: z.array(exportedTagSchema),
  taskTags: z.array(exportedTaskTagSchema),
  relations: z.array(exportedRelationSchema),
  dayPlans: z.array(exportedDayPlanSchema),
  savedViews: z.array(exportedSavedViewSchema),
  activity: z.array(activityEventSchema),
});

/**
 * The array sections, in the order the archive writes them. The route streams by walking
 * this list, so a new section is added here and nowhere else in the transport.
 */
export const EXPORT_ARRAY_SECTIONS = [
  "projects",
  "statuses",
  "tasks",
  "fields",
  "tags",
  "taskTags",
  "relations",
  "dayPlans",
  "savedViews",
  "activity",
] as const;

/** The task CSV's columns, in order. The importer reads the same names (spec 30.1). */
export const TASK_CSV_COLUMNS = [
  "key",
  "title",
  "description",
  "status",
  "priority",
  "dueDate",
  "deadline",
  "deferUntil",
  "tags",
  "parentKey",
  "completed",
] as const;

/** Imports (GAP-07). `trello` reads a board's JSON export; `csv` reads the task CSV. */
export const importSourceSchema = z.enum(["trello", "csv"]);

export const MAX_IMPORT_BYTES = 10_000_000;

export const importRequestSchema = z.object({
  /** The raw file: a Trello board's JSON, or CSV text with a header row. */
  content: z.string().min(1).max(MAX_IMPORT_BYTES),
  /** Overrides the name the source suggests; the project must not already exist. */
  projectName: z.string().trim().min(1).max(100).optional(),
});

export const importQuerySchema = z.object({
  /** Preview only: nothing is written and `projectId` comes back null. */
  dryRun: z.stringbool().default(false),
});

/** One row the mapping could not take, with the reason a person can act on. */
export const importIssueSchema = z.object({
  /** 1-based position in the source: a CSV line, or a card's index in the board. */
  row: z.number().int().positive(),
  title: z.string().nullable(),
  reason: z.string(),
});

export const importStatusPlanSchema = z.object({
  name: z.string(),
  category: statusCategorySchema,
  taskCount: z.number().int().nonnegative(),
});

export const importTaskPreviewSchema = z.object({
  title: z.string(),
  statusName: z.string().nullable(),
  tags: z.array(z.string()),
  dueDate: plainDateSchema.nullable(),
  isCompleted: z.boolean(),
  isArchived: z.boolean(),
  subtaskCount: z.number().int().nonnegative(),
});

export const MAX_IMPORT_SAMPLE = 20;

/**
 * What an import would do, or did. The dry run and the apply return the same shape from
 * the same mapping, so the preview a user approves is the plan that runs.
 */
export const importPreviewSchema = z.object({
  source: importSourceSchema,
  projectName: z.string(),
  counts: z.object({
    statuses: z.number().int().nonnegative(),
    tasks: z.number().int().nonnegative(),
    subtasks: z.number().int().nonnegative(),
    tags: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  }),
  statuses: z.array(importStatusPlanSchema),
  tags: z.array(z.string()),
  /** The first few tasks, so a person can check the mapping before approving it. */
  sample: z.array(importTaskPreviewSchema).max(MAX_IMPORT_SAMPLE),
  /** Columns or fields the mapping ignored, so nothing is silently dropped. */
  ignoredFields: z.array(z.string()),
  issues: z.array(importIssueSchema),
});

export const importResultSchema = z.object({
  dryRun: z.boolean(),
  /** Null on a dry run; the created project otherwise. */
  projectId: uuidSchema.nullable(),
  preview: importPreviewSchema,
});

export const importResponseSchema = z.object({ data: importResultSchema });

export type ExportActivityScope = z.infer<typeof exportActivityScopeSchema>;
export type ExportWorkspaceQuery = z.infer<typeof exportWorkspaceQuerySchema>;
export type ExportTasksCsvQuery = z.infer<typeof exportTasksCsvQuerySchema>;
export type ExportedWorkspaceDto = z.infer<typeof exportedWorkspaceSchema>;
export type ExportedProjectDto = z.infer<typeof exportedProjectSchema>;
export type ExportedStatusDto = z.infer<typeof exportedStatusSchema>;
export type ExportedTaskDto = z.infer<typeof exportedTaskSchema>;
export type ExportedFieldDto = z.infer<typeof exportedFieldSchema>;
export type ExportedTagDto = z.infer<typeof exportedTagSchema>;
export type ExportedTaskTagDto = z.infer<typeof exportedTaskTagSchema>;
export type ExportedRelationDto = z.infer<typeof exportedRelationSchema>;
export type ExportedDayPlanDto = z.infer<typeof exportedDayPlanSchema>;
export type ExportedSavedViewDto = z.infer<typeof exportedSavedViewSchema>;
export type WorkspaceExport = z.infer<typeof workspaceExportSchema>;
export type ExportArraySection = (typeof EXPORT_ARRAY_SECTIONS)[number];
export type TaskCsvColumn = (typeof TASK_CSV_COLUMNS)[number];
export type ImportSource = z.infer<typeof importSourceSchema>;
export type ImportRequest = z.infer<typeof importRequestSchema>;
export type ImportQuery = z.infer<typeof importQuerySchema>;
export type ImportIssueDto = z.infer<typeof importIssueSchema>;
export type ImportStatusPlanDto = z.infer<typeof importStatusPlanSchema>;
export type ImportTaskPreviewDto = z.infer<typeof importTaskPreviewSchema>;
export type ImportPreviewDto = z.infer<typeof importPreviewSchema>;
export type ImportResultDto = z.infer<typeof importResultSchema>;
export type ImportResponse = z.infer<typeof importResponseSchema>;

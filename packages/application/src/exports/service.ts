import {
  EXPORT_FORMAT,
  EXPORT_SCHEMA_VERSION,
  TASK_CSV_COLUMNS,
  type ExportActivityScope,
  type ExportTasksCsvQuery,
  type ExportedDayPlanDto,
  type ExportedProjectDto,
  type ExportedRelationDto,
  type ExportedSavedViewDto,
  type ExportedStatusDto,
  type ExportedTagDto,
  type ExportedTaskDto,
  type ExportedTaskTagDto,
  type WorkspaceExport,
  type ActivityEventDto,
} from "@morrowlist/contracts";
import {
  DomainError,
  formatCsv,
  isCompleted,
  systemClock,
  taskKey,
  toLocalDate,
  type Clock,
  type PlainDate,
  type Tag,
  type Task,
} from "@morrowlist/domain";

import type {
  AggregateType,
  Project,
  SavedView,
  TransactionContext,
  UnitOfWork,
  Workspace,
} from "../ports/index.js";
import {
  SCOPES,
  assertScope,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";
import { toTaskFilter } from "../tasks/mappers.js";

/**
 * Data portability (spec 30, GAP-07).
 *
 * The archive is read inside one read-only transaction, so every section describes the
 * same instant: a task cannot appear without the tag row it points at. Nothing here can
 * reach auth-provider tables — they live behind `packages/auth` and no repository in the
 * transaction exposes them (spec 18.3) — so "no secrets are exported" is a property of
 * the architecture, not of a filter somewhere in this file.
 *
 * Derived tables are absent by design: `task_status_intervals` is rebuilt by
 * `pnpm db:backfill-flow` and `task_reminders` is recomputed from the task.
 */

export interface ExportServiceOptions {
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
}

export interface ExportWorkspaceOptions {
  readonly activity?: ExportActivityScope;
}

/** How many rows one repository call reads while walking a large workspace. */
const PAGE_SIZE = 500;

/** The earliest date the day-plan read will accept; "every plan the workspace has". */
const BEGINNING_OF_TIME = "0001-01-01" as PlainDate;

export class ExportService {
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;

  constructor(options: ExportServiceOptions) {
    this.unitOfWork = options.unitOfWork;
    this.clock = options.clock ?? systemClock;
  }

  /** The whole workspace as one versioned archive (spec 30.2). */
  async workspace(
    context: ActorContext,
    workspaceId: string,
    options: ExportWorkspaceOptions = {},
  ): Promise<WorkspaceExport> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.exportRead);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await requireWorkspace(tx, workspaceId);
      const tasks = await readAllTasks(tx, workspaceId);
      const projects = await tx.projects.listByWorkspace(workspaceId, {
        includeArchived: true,
      });
      const statuses: ExportedStatusDto[] = [];
      for (const project of projects) {
        const projectStatuses = await tx.statuses.listByProject(project.id, {
          includeArchived: true,
        });
        for (const status of projectStatuses) {
          statuses.push({
            id: status.id,
            projectId: project.id,
            name: status.name,
            category: status.category,
            rank: status.rank,
            colorToken: status.colorToken,
            wipLimit: status.wipLimit,
            isDefault: status.isDefault,
            policyMd: status.policyMd,
            archivedAt: status.archivedAt?.toISOString() ?? null,
          });
        }
      }

      const { taskTags, relations, dayPlans } = await readTaskAssociations(
        tx,
        workspaceId,
        tasks,
      );
      const tags = await tx.tags.listByWorkspace(workspaceId);
      const savedViews = context.userId
        ? await tx.savedViews.listForOwner(workspaceId, context.userId)
        : [];

      return {
        format: EXPORT_FORMAT,
        schemaVersion: EXPORT_SCHEMA_VERSION,
        exportedAt: this.clock.now().toISOString(),
        workspace: {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          taskKeyPrefix: workspace.taskKeyPrefix,
          timezone: workspace.timezone,
          inProgressLimit: workspace.inProgressLimit,
          createdByUserId: workspace.createdByUserId,
          createdAt: workspace.createdAt.toISOString(),
          updatedAt: workspace.updatedAt.toISOString(),
        },
        projects: projects.map(toExportedProject),
        statuses,
        tasks: tasks.map((task) => toExportedTask(task, workspace.taskKeyPrefix)),
        tags: tags.map(toExportedTag),
        taskTags,
        relations,
        dayPlans,
        savedViews: savedViews.map(toExportedSavedView),
        activity: await readActivity(tx, workspaceId, options.activity ?? "all"),
      } satisfies WorkspaceExport;
    });
  }

  /**
   * The task list as CSV (spec 30.1), through the same filter the list endpoint takes,
   * so "export what I am looking at" is one query string away. Ordered by the query's
   * sort, and re-importable: the columns are the ones the CSV importer reads.
   */
  async tasksCsv(
    context: ActorContext,
    query: Partial<ExportTasksCsvQuery> & { readonly workspaceId: string },
  ): Promise<string> {
    assertWorkspaceAccess(context, query.workspaceId);
    assertScope(context, SCOPES.exportRead);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await requireWorkspace(tx, query.workspaceId);
      const today = toLocalDate(this.clock.now(), workspace.timezone);
      const filter = toTaskFilter(query, today);

      const rows: string[][] = [[...TASK_CSV_COLUMNS]];
      const tasksById = new Map<string, Task>();
      const collected: Task[] = [];
      let after: string | undefined;

      for (;;) {
        const page = await tx.tasks.list(filter, { limit: PAGE_SIZE, after });
        for (const task of page.items) {
          tasksById.set(task.id, task);
          collected.push(task);
        }
        if (!page.hasMore || page.items.length === 0) break;
        after = page.items.at(-1)?.id;
      }

      // Parents may fall outside the filter, so the parent key is resolved separately
      // rather than only from the page: a subtask still names the task it belongs to.
      const missingParents = [
        ...new Set(
          collected
            .map((task) => task.parentTaskId)
            .filter((id): id is string => id !== null && !tasksById.has(id)),
        ),
      ];
      for (const parentId of missingParents) {
        const parent = await tx.tasks.findById(query.workspaceId, parentId);
        if (parent) tasksById.set(parent.id, parent);
      }

      const tagsByTask = await readTagsInPages(
        tx,
        query.workspaceId,
        collected.map((task) => task.id),
      );

      for (const task of collected) {
        const parent = task.parentTaskId ? tasksById.get(task.parentTaskId) : undefined;
        rows.push([
          taskKey(workspace.taskKeyPrefix, task.taskNumber),
          task.title,
          task.descriptionMd ?? "",
          task.statusId ?? "",
          task.priority,
          task.dueDate ?? "",
          task.deadline ?? "",
          task.deferUntil ?? "",
          (tagsByTask.get(task.id) ?? []).map((tag) => tag.name).join(", "),
          parent ? taskKey(workspace.taskKeyPrefix, parent.taskNumber) : "",
          isCompleted(task) ? "yes" : "no",
        ]);
      }

      // The `status` column carries the column's name, not its id: a person reads it and
      // the importer matches on it. Resolved after the rows so it is one query, not N.
      const statusNames = await readStatusNames(tx, collected);
      for (const row of rows.slice(1)) {
        row[3] = row[3] ? (statusNames.get(row[3]) ?? "") : "";
      }

      return `${formatCsv(rows)}\r\n`;
    });
  }
}

async function requireWorkspace(
  tx: TransactionContext,
  workspaceId: string,
): Promise<Workspace> {
  const workspace = await tx.workspaces.findById(workspaceId);
  if (!workspace) {
    throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace not found.", {
      workspaceId,
    });
  }
  return workspace;
}

/** Every task in the workspace, live rows then trashed ones, in pages. */
async function readAllTasks(
  tx: TransactionContext,
  workspaceId: string,
): Promise<Task[]> {
  const tasks: Task[] = [];
  for (const deletedOnly of [false, true]) {
    let after: string | undefined;
    for (;;) {
      const page = await tx.tasks.list(
        { workspaceId, deletedOnly, sort: "createdAt", order: "asc" },
        { limit: PAGE_SIZE, after },
      );
      tasks.push(...page.items);
      if (!page.hasMore || page.items.length === 0) break;
      after = page.items.at(-1)?.id;
    }
  }
  return tasks;
}

/**
 * The associations of every task, read a page at a time so a large workspace never puts
 * ten thousand ids into one query. A relation touching two pages is returned by both, so
 * relations are collected by id.
 */
async function readTaskAssociations(
  tx: TransactionContext,
  workspaceId: string,
  tasks: readonly Task[],
): Promise<{
  taskTags: ExportedTaskTagDto[];
  relations: ExportedRelationDto[];
  dayPlans: ExportedDayPlanDto[];
}> {
  const taskTags: ExportedTaskTagDto[] = [];
  const dayPlans: ExportedDayPlanDto[] = [];
  const relations = new Map<string, ExportedRelationDto>();

  for (let start = 0; start < tasks.length; start += PAGE_SIZE) {
    const ids = tasks.slice(start, start + PAGE_SIZE).map((task) => task.id);
    const [tags, edges, plans] = await Promise.all([
      tx.tasks.tagsFor(workspaceId, ids),
      tx.tasks.relationsFor(workspaceId, ids),
      tx.dayPlans.listForTasks(ids, BEGINNING_OF_TIME),
    ]);

    for (const taskId of ids) {
      for (const tag of tags.get(taskId) ?? []) {
        taskTags.push({ taskId, tagId: tag.id });
      }
      for (const planDate of plans.get(taskId) ?? []) {
        dayPlans.push({ taskId, planDate });
      }
    }
    for (const edge of edges) {
      relations.set(edge.relation.id, {
        id: edge.relation.id,
        sourceTaskId: edge.relation.sourceTaskId,
        targetTaskId: edge.relation.targetTaskId,
        type: edge.relation.type,
        metadata: edge.relation.metadata,
        createdAt: edge.relation.createdAt.toISOString(),
      });
    }
  }

  return { taskTags, relations: [...relations.values()], dayPlans };
}

async function readTagsInPages(
  tx: TransactionContext,
  workspaceId: string,
  taskIds: readonly string[],
): Promise<Map<string, readonly Tag[]>> {
  const merged = new Map<string, readonly Tag[]>();
  for (let start = 0; start < taskIds.length; start += PAGE_SIZE) {
    const page = await tx.tasks.tagsFor(
      workspaceId,
      taskIds.slice(start, start + PAGE_SIZE),
    );
    for (const [taskId, tags] of page) merged.set(taskId, tags);
  }
  return merged;
}

async function readStatusNames(
  tx: TransactionContext,
  tasks: readonly Task[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const projectIds = new Set(
    tasks.map((task) => task.projectId).filter((id): id is string => id !== null),
  );
  for (const projectId of projectIds) {
    for (const status of await tx.statuses.listByProject(projectId, {
      includeArchived: true,
    })) {
      names.set(status.id, status.name);
    }
  }
  return names;
}

const ACTIVITY_SCOPES: Record<ExportActivityScope, readonly AggregateType[] | null> = {
  none: [],
  tasks: ["task"],
  all: null,
};

async function readActivity(
  tx: TransactionContext,
  workspaceId: string,
  scope: ExportActivityScope,
): Promise<ActivityEventDto[]> {
  const types: readonly AggregateType[] | null = ACTIVITY_SCOPES[scope] ?? null;
  if (types !== null && types.length === 0) return [];

  const events: ActivityEventDto[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await tx.activity.listForWorkspace(
      workspaceId,
      { limit: PAGE_SIZE, after },
      types ?? undefined,
    );
    events.push(
      ...page.items.map((event) => ({
        ...event,
        createdAt: event.createdAt.toISOString(),
      })),
    );
    if (!page.hasMore || page.items.length === 0) break;
    after = page.items.at(-1)?.id;
  }
  return events;
}

function toExportedProject(project: Project): ExportedProjectDto {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    descriptionMd: project.descriptionMd,
    colorToken: project.colorToken,
    icon: project.icon,
    archivedAt: project.archivedAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

function toExportedTask(task: Task, taskKeyPrefix: string): ExportedTaskDto {
  return {
    id: task.id,
    key: taskKey(taskKeyPrefix, task.taskNumber),
    taskNumber: task.taskNumber,
    projectId: task.projectId,
    statusId: task.statusId,
    title: task.title,
    descriptionMd: task.descriptionMd,
    priority: task.priority,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    dueTimezone: task.dueTimezone,
    deferUntil: task.deferUntil,
    deadline: task.deadline,
    deadlineTime: task.deadlineTime,
    reminderOffsetMinutes: task.reminderOffsetMinutes,
    parentTaskId: task.parentTaskId,
    recurrence: task.recurrence
      ? {
          ...task.recurrence,
          weekdays: task.recurrence.weekdays ? [...task.recurrence.weekdays] : null,
        }
      : null,
    seriesId: task.seriesId,
    rank: task.rank,
    lastActiveStatusId: task.lastActiveStatusId,
    completedAt: task.completedAt?.toISOString() ?? null,
    blockedReason: task.blockedReason,
    blockedSince: task.blockedSince?.toISOString() ?? null,
    version: task.version,
    createdBy: { kind: task.createdBy.kind, id: task.createdBy.id },
    lastActor: { kind: task.lastActor.kind, id: task.lastActor.id },
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    deletedAt: task.deletedAt?.toISOString() ?? null,
  };
}

function toExportedTag(tag: Tag): ExportedTagDto {
  return {
    id: tag.id,
    name: tag.name,
    normalizedName: tag.normalizedName,
    colorToken: tag.colorToken,
    description: tag.description,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString(),
  };
}

function toExportedSavedView(view: SavedView): ExportedSavedViewDto {
  return {
    id: view.id,
    ownerUserId: view.ownerUserId,
    name: view.name,
    filters: view.filters,
    layout: view.layout,
    rank: view.rank,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

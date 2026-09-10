import {
  MAX_IMPORT_SAMPLE,
  PROJECT_EVENTS,
  TAG_EVENTS,
  TASK_EVENTS,
  WORKSPACE_EVENTS,
  type ImportPreviewDto,
  type ImportResultDto,
  type ImportSource,
} from "@morrowlist/contracts";
import {
  DEFAULT_TAG_COLOR,
  DomainError,
  ImportFormatError,
  ValidationError,
  canonicalFieldValues,
  completeTask,
  countSubtasks,
  defaultPlannedStatus,
  deleteTask,
  fieldColumnName,
  isTerminalCategory,
  normalizeTagName,
  planFromCsv,
  planFromTrelloJson,
  plannedTagNames,
  rankBetween,
  ranksBetween,
  systemClock,
  tagLookupKey,
  taskCountByStatus,
  toTagColorToken,
  uuidv7,
  validateFieldValue,
  type Clock,
  type FieldDefinition,
  type FieldValue,
  type FieldValues,
  type ImportIssue,
  type ImportPlan,
  type PlannedStatus,
  type PlannedTask,
  type Tag,
  type Task,
  type WorkflowStatus,
} from "@morrowlist/domain";

import { syncIntervals } from "../flow/intervals.js";
import { recomputeReminder } from "../notifications/scheduler.js";
import type {
  Project,
  TransactionContext,
  UnitOfWork,
  Workspace,
} from "../ports/index.js";
import {
  SCOPES,
  actorRef,
  assertScope,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";
import { recordEvent } from "../shared/event-recorder.js";
import { insertNewTask } from "../tasks/create.js";
import { slugify } from "../workspace/bootstrap.js";

/**
 * Importing a board or a spreadsheet (GAP-07, spec 30).
 *
 * The mapping is pure and lives in the domain; this service is the transaction around
 * it. A dry run runs exactly the same mapping and writes nothing, so the preview a user
 * approves is the plan that runs.
 *
 * One import is one transaction: the project, its columns, its tags, every task and
 * subtask, and every activity and outbox row commit together or not at all. A failure
 * half way through leaves no half-imported project behind.
 */

export interface ImportServiceOptions {
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
}

export interface ImportRequestInput {
  readonly content: string;
  readonly projectName?: string | undefined;
  readonly dryRun?: boolean | undefined;
}

export class ImportService {
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;

  constructor(options: ImportServiceOptions) {
    this.unitOfWork = options.unitOfWork;
    this.clock = options.clock ?? systemClock;
  }

  /** Map the file and report what an import would do; nothing is written. */
  async preview(
    context: ActorContext,
    workspaceId: string,
    source: ImportSource,
    request: ImportRequestInput,
  ): Promise<ImportResultDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.importWrite);

    const plan = mapSource(source, request);
    // The definitions are read here too: a dry run that did not mention an unusable
    // field column would not be the plan the apply runs.
    const definitions = await this.unitOfWork.execute((tx) =>
      tx.fields.listByWorkspace(workspaceId),
    );
    const resolved = withResolvedFields(plan, resolvePlanFields(plan, definitions));
    return { dryRun: true, projectId: null, preview: toPreview(source, resolved) };
  }

  /**
   * Create the project the plan describes. The project name must be free, because an
   * import that silently merged into an existing project would be unrecoverable.
   */
  async apply(
    context: ActorContext,
    workspaceId: string,
    source: ImportSource,
    request: ImportRequestInput,
  ): Promise<ImportResultDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.importWrite);

    if (request.dryRun) return this.preview(context, workspaceId, source, request);

    const plan = mapSource(source, request);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await tx.workspaces.findById(workspaceId);
      if (!workspace) {
        throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace not found.", {
          workspaceId,
        });
      }

      const existing = await tx.projects.listByWorkspace(workspaceId, {
        includeArchived: true,
      });
      if (
        existing.some(
          (project) =>
            project.name.toLocaleLowerCase("en-US") ===
            plan.projectName.toLocaleLowerCase("en-US"),
        )
      ) {
        throw new ValidationError(
          `A project named "${plan.projectName}" already exists. Choose another name for the import.`,
          { field: "projectName", name: plan.projectName },
        );
      }

      const now = this.clock.now();
      const project: Project = {
        id: uuidv7(),
        workspaceId,
        name: plan.projectName,
        slug: uniqueSlug(plan.projectName, existing),
        descriptionMd: null,
        colorToken: "blue",
        icon: null,
        archivedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      const statuses = buildStatuses(project.id, plan.statuses);

      await tx.projects.insert(project);
      await tx.statuses.insertMany(statuses.map((entry) => entry.status));
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "project",
        aggregateId: project.id,
        eventType: PROJECT_EVENTS.created,
        summary: `Created project ${project.name}`,
        payload: {
          projectId: project.id,
          name: project.name,
          statusIds: statuses.map((entry) => entry.status.id),
          importedFrom: { source },
        },
      });

      const tags = await this.resolveTags(tx, context, workspaceId, plan);
      const resolvedFields = resolvePlanFields(
        plan,
        await tx.fields.listByWorkspace(workspaceId),
      );
      const statusById = new Map(
        statuses.map((entry) => [entry.externalId, entry.status]),
      );
      const fallback =
        statuses.find((entry) => !isTerminalCategory(entry.status.category))?.status ??
        statuses[0]?.status;
      if (!fallback) {
        throw new DomainError(
          "WORKFLOW_INVARIANT_VIOLATED",
          "The import produced no usable column.",
          { projectId: project.id },
        );
      }
      const doneStatus = statuses.find((entry) =>
        isTerminalCategory(entry.status.category),
      )?.status;

      let created = 0;
      let createdSubtasks = 0;
      for (const [index, planned] of plan.tasks.entries()) {
        const status =
          (planned.statusExternalId
            ? statusById.get(planned.statusExternalId)
            : undefined) ?? fallback;
        // A task never starts in a Done column (spec 8.5); it is completed afterwards.
        const landing = isTerminalCategory(status.category) ? fallback : status;
        const parent = await this.createOne(tx, context, workspace, {
          source,
          project,
          status: landing,
          planned,
          fields: resolvedFields.values[index] ?? {},
          tags,
          parentTaskId: null,
          doneStatus,
        });
        created += 1;

        for (const subtask of planned.subtasks) {
          // A subtask sits in its parent's column, so showing subtasks on the board
          // does not scatter a card's checklist across the workflow.
          await this.createOne(tx, context, workspace, {
            source,
            project,
            status: landing,
            planned: {
              ...emptyPlannedTask(subtask.title, planned.sourceRow),
              isCompleted: subtask.isCompleted,
              externalId: subtask.externalId,
            },
            // A checklist item or a child row carries no field columns of its own.
            fields: {},
            tags,
            parentTaskId: parent.id,
            doneStatus,
          });
          createdSubtasks += 1;
        }
      }

      const preview = toPreview(source, withResolvedFields(plan, resolvedFields));
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "workspace",
        aggregateId: workspaceId,
        eventType: WORKSPACE_EVENTS.imported,
        summary: `Imported ${created} task${created === 1 ? "" : "s"} from ${SOURCE_LABELS[source]} into ${project.name}`,
        payload: {
          workspaceId,
          source,
          projectId: project.id,
          projectName: project.name,
          counts: { ...preview.counts, tasks: created, subtasks: createdSubtasks },
        },
      });

      return { dryRun: false, projectId: project.id, preview };
    });
  }

  /** Find or create every tag the plan names, once, in the import's transaction. */
  private async resolveTags(
    tx: TransactionContext,
    context: ActorContext,
    workspaceId: string,
    plan: ImportPlan,
  ): Promise<Map<string, Tag>> {
    const resolved = new Map<string, Tag>();
    for (const name of plannedTagNames(plan)) {
      const normalizedName = tagLookupKey(name);
      const existing = await tx.tags.findByNormalizedName(workspaceId, normalizedName);
      if (existing) {
        resolved.set(normalizedName, existing);
        continue;
      }
      const now = this.clock.now();
      const tag: Tag = {
        id: uuidv7(),
        workspaceId,
        name: normalizeTagName(name),
        normalizedName,
        colorToken: toTagColorToken(DEFAULT_TAG_COLOR),
        description: null,
        createdAt: now,
        updatedAt: now,
      };
      await tx.tags.insert(tag);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "tag",
        aggregateId: tag.id,
        eventType: TAG_EVENTS.created,
        summary: `Created tag ${tag.name}`,
        payload: { tagId: tag.id, name: tag.name, colorToken: tag.colorToken },
      });
      resolved.set(normalizedName, tag);
    }
    return resolved;
  }

  /**
   * One planned row as a task: created through the same path as capture, then completed
   * or trashed if the source said so — each of those a recorded event of its own, so the
   * history reads exactly as if a person had done it.
   */
  private async createOne(
    tx: TransactionContext,
    context: ActorContext,
    workspace: Workspace,
    input: {
      source: ImportSource;
      project: Project;
      status: WorkflowStatus;
      planned: PlannedTask;
      /** Already checked against this workspace's definitions (GAP-24). */
      fields: FieldValues;
      tags: ReadonlyMap<string, Tag>;
      parentTaskId: string | null;
      doneStatus: WorkflowStatus | undefined;
    },
  ): Promise<Task> {
    const { planned } = input;
    const created = await insertNewTask({
      tx,
      context,
      clock: this.clock,
      workspace,
      fields: {
        id: uuidv7(),
        title: planned.title,
        descriptionMd: planned.descriptionMd,
        priority: planned.priority,
        dueDate: planned.dueDate,
        deadline: planned.deadline,
        deferUntil: planned.deferUntil,
        parentTaskId: input.parentTaskId,
        fields: input.fields,
        project: { id: input.project.id, status: input.status },
      },
      origin: {
        importedFrom: { source: input.source, id: planned.externalId },
        tags: planned.tags
          .map((name) => input.tags.get(tagLookupKey(name)))
          .filter((tag): tag is Tag => tag !== undefined),
      },
    });

    let current = created;
    if (planned.isCompleted)
      current = await this.complete(tx, context, workspace, current, input.doneStatus);
    if (planned.isArchived) current = await this.trash(tx, context, current);
    return current;
  }

  private async complete(
    tx: TransactionContext,
    context: ActorContext,
    workspace: Workspace,
    task: Task,
    doneStatus: WorkflowStatus | undefined,
  ): Promise<Task> {
    if (!doneStatus) return task;
    const lastRank = await tx.tasks.lastRankIn({
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      statusId: doneStatus.id,
    });
    const completed = completeTask(
      task,
      { doneStatus: { status: doneStatus, rank: rankBetween(lastRank, null) } },
      { actor: actorRef(context), clock: this.clock },
    );
    await tx.tasks.update(completed, task.version);
    await syncIntervals(tx, task, completed, doneStatus);
    await recomputeReminder(tx, completed, workspace.timezone, this.clock.now());
    await recordEvent(tx, context, this.clock, {
      workspaceId: task.workspaceId,
      aggregateType: "task",
      aggregateId: task.id,
      eventType: TASK_EVENTS.completed,
      summary: "Completed task",
      payload: { taskId: task.id, statusId: completed.statusId },
    });
    return completed;
  }

  private async trash(
    tx: TransactionContext,
    context: ActorContext,
    task: Task,
  ): Promise<Task> {
    const deleted = deleteTask(task, { actor: actorRef(context), clock: this.clock });
    await tx.tasks.update(deleted, task.version);
    await syncIntervals(tx, task, deleted);
    await tx.reminders.delete(task.id);
    await recordEvent(tx, context, this.clock, {
      workspaceId: task.workspaceId,
      aggregateType: "task",
      aggregateId: task.id,
      eventType: TASK_EVENTS.deleted,
      summary: "Moved task to Trash",
      payload: { taskId: task.id, importedArchived: true },
    });
    return deleted;
  }
}

const SOURCE_LABELS: Record<ImportSource, string> = {
  trello: "Trello",
  csv: "a CSV",
};

function mapSource(source: ImportSource, request: ImportRequestInput): ImportPlan {
  try {
    return source === "trello"
      ? planFromTrelloJson(request.content, { projectName: request.projectName })
      : planFromCsv(request.content, { projectName: request.projectName });
  } catch (error) {
    if (error instanceof ImportFormatError) {
      throw new ValidationError(error.message, { field: "content", source });
    }
    throw error;
  }
}

/** The plan as the preview contract: counts first, then enough detail to check it. */
function toPreview(source: ImportSource, plan: ImportPlan): ImportPreviewDto {
  const counts = taskCountByStatus(plan);
  return {
    source,
    projectName: plan.projectName,
    counts: {
      statuses: plan.statuses.length,
      tasks: plan.tasks.length,
      subtasks: countSubtasks(plan),
      tags: plannedTagNames(plan).length,
      skipped: plan.issues.length,
    },
    statuses: plan.statuses.map((status) => ({
      name: status.name,
      category: status.category,
      taskCount: counts.get(status.externalId) ?? 0,
    })),
    tags: [...plannedTagNames(plan)],
    sample: plan.tasks.slice(0, MAX_IMPORT_SAMPLE).map((task) => ({
      title: task.title,
      statusName:
        plan.statuses.find((status) => status.externalId === task.statusExternalId)
          ?.name ?? null,
      tags: [...task.tags],
      dueDate: task.dueDate,
      isCompleted: task.isCompleted,
      isArchived: task.isArchived,
      subtaskCount: task.subtasks.length,
    })),
    ignoredFields: [...plan.ignoredFields],
    issues: plan.issues.map((issue) => ({ ...issue })),
  };
}

interface BuiltStatus {
  readonly externalId: string;
  readonly status: WorkflowStatus;
}

/**
 * The plan's columns as workflow statuses, in plan order. The first non-Done column is
 * the default for new tasks, which is what the project invariants require (spec 11.4).
 */
function buildStatuses(
  projectId: string,
  planned: readonly PlannedStatus[],
): BuiltStatus[] {
  const ranks = ranksBetween(null, null, planned.length);
  const defaultStatus = defaultPlannedStatus(planned);
  return planned.map((entry, index) => ({
    externalId: entry.externalId,
    status: {
      id: uuidv7(),
      projectId,
      name: entry.name,
      category: entry.category,
      rank: ranks[index] as string,
      colorToken: COLORS[entry.category],
      wipLimit: null,
      isDefault: entry.externalId === defaultStatus?.externalId,
      policyMd: null,
      archivedAt: null,
      version: 1,
    },
  }));
}

const COLORS: Record<WorkflowStatus["category"], string> = {
  backlog: "slate",
  ready: "blue",
  in_progress: "amber",
  blocked: "red",
  review: "violet",
  done: "green",
};

function emptyPlannedTask(title: string, sourceRow: number): PlannedTask {
  return {
    title,
    descriptionMd: null,
    priority: "none",
    dueDate: null,
    deadline: null,
    deferUntil: null,
    tags: [],
    statusExternalId: null,
    isCompleted: false,
    isArchived: false,
    externalId: null,
    sourceRow,
    subtasks: [],
    fields: {},
  };
}

/**
 * The typed custom field values of every planned row, resolved against the definitions
 * the *target* workspace has (GAP-24).
 *
 * Import never creates a definition: a type and a select's options cannot be inferred
 * from a spreadsheet cell, and the ten-field cap is a design rule rather than a limit to
 * route around. So a column naming a field this workspace does not define is reported as
 * ignored, and a value its definition refuses becomes a row issue — the two channels the
 * preview already has for "this was not silently dropped".
 */
interface ResolvedPlanFields {
  /** Canonical values per planned task, in plan order. */
  readonly values: readonly FieldValues[];
  readonly ignoredColumns: readonly string[];
  readonly issues: readonly ImportIssue[];
}

function resolvePlanFields(
  plan: ImportPlan,
  definitions: readonly FieldDefinition[],
): ResolvedPlanFields {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const ignoredColumns = new Set<string>();
  const issues: ImportIssue[] = [];
  const values: FieldValues[] = [];

  for (const planned of plan.tasks) {
    const resolved: Record<string, FieldValue> = {};
    for (const [key, raw] of Object.entries(planned.fields)) {
      const definition = byKey.get(key);
      if (!definition) {
        ignoredColumns.add(fieldColumnName(key));
        continue;
      }
      try {
        resolved[key] = validateFieldValue(definition, raw);
      } catch (error) {
        issues.push({
          row: planned.sourceRow,
          title: planned.title,
          reason:
            error instanceof Error
              ? error.message
              : `${definition.name} could not be read.`,
        });
      }
    }
    values.push(canonicalFieldValues(resolved, definitions));
  }

  return { values, ignoredColumns: [...ignoredColumns], issues };
}

/** The plan the preview and the apply share, with the workspace's fields resolved. */
function withResolvedFields(
  plan: ImportPlan,
  resolved: ResolvedPlanFields,
): ImportPlan {
  if (resolved.ignoredColumns.length === 0 && resolved.issues.length === 0) return plan;
  return {
    ...plan,
    ignoredFields: [...plan.ignoredFields, ...resolved.ignoredColumns],
    issues: [...plan.issues, ...resolved.issues],
  };
}

function uniqueSlug(name: string, existing: readonly Project[]): string {
  const base = slugify(name);
  const used = new Set(existing.map((project) => project.slug));
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix++) {
    if (!used.has(`${base}-${suffix}`)) return `${base}-${suffix}`;
  }
  return `${base}-${uuidv7().slice(0, 8)}`;
}

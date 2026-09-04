import type {
  ArchiveStatusRequest,
  CreateStatusRequest,
  ListStatusesQuery,
  ReorderStatusRequest,
  UpdateStatusRequest,
  WorkflowStatusDto,
} from "@morrowlist/contracts";
import { TASK_EVENTS, WORKFLOW_STATUS_EVENTS } from "@morrowlist/contracts";
import {
  archiveStatus,
  createStatus,
  isTerminal,
  materialChanges,
  ranksBetween,
  relocateTask,
  reorderStatus,
  systemClock,
  updateStatus,
  uuidv7,
  type Clock,
  type Task,
  type WorkflowStatus,
} from "@morrowlist/domain";

import { reenterInterval, syncIntervals } from "../flow/intervals.js";
import { recomputeReminder } from "../notifications/scheduler.js";
import type { TransactionContext, UnitOfWork, Workspace } from "../ports/index.js";
import {
  SCOPES,
  actorRef,
  assertScope,
  assertWorkspaceAccess,
  type ActorContext,
} from "../shared/actor-context.js";
import { recordEvent } from "../shared/event-recorder.js";

import {
  assertVersion,
  requireActiveProject,
  requireStatus,
  requireWorkspace,
  versionConflict,
} from "./lookup.js";
import { toWorkflowStatusDto } from "./mappers.js";

export interface WorkflowServiceOptions {
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
}

/**
 * Workflow editing use cases (spec 11.3, 11.4, GAP-05). The domain decides what a valid
 * workflow is; this layer loads the project's columns, persists what changed, carries the
 * column's tasks along where the change demands it, and records activity plus an outbox
 * event for every material mutation inside one transaction.
 */
export class WorkflowService {
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;

  constructor(options: WorkflowServiceOptions) {
    this.unitOfWork = options.unitOfWork;
    this.clock = options.clock ?? systemClock;
  }

  async list(
    context: ActorContext,
    workspaceId: string,
    projectId: string,
    query: Partial<ListStatusesQuery> = {},
  ): Promise<WorkflowStatusDto[]> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.projectsRead);

    return this.unitOfWork.execute(async (tx) => {
      await requireWorkspace(tx, workspaceId);
      const project = await requireActiveProject(tx, workspaceId, projectId);
      const statuses = await tx.statuses.listByProject(project.id, {
        includeArchived: query.includeArchived ?? false,
      });
      return statuses.map(toWorkflowStatusDto);
    });
  }

  async create(
    context: ActorContext,
    workspaceId: string,
    projectId: string,
    request: CreateStatusRequest,
  ): Promise<WorkflowStatusDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.projectsWrite);

    return this.unitOfWork.execute(async (tx) => {
      await requireWorkspace(tx, workspaceId);
      const project = await requireActiveProject(tx, workspaceId, projectId);
      const statuses = await tx.statuses.listByProject(project.id, {
        includeArchived: true,
      });

      const status = createStatus(
        {
          id: uuidv7(),
          projectId: project.id,
          name: request.name,
          category: request.category,
          colorToken: request.colorToken,
          wipLimit: request.wipLimit,
          policyMd: request.policyMd,
        },
        statuses,
      );

      await tx.statuses.insertMany([status]);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "status",
        aggregateId: status.id,
        eventType: WORKFLOW_STATUS_EVENTS.created,
        summary: `Added column ${status.name}`,
        payload: {
          statusId: status.id,
          projectId: project.id,
          name: status.name,
          category: status.category,
        },
      });

      return toWorkflowStatusDto(status);
    });
  }

  /**
   * Edit a column. A category change across the Done boundary completes or reopens the
   * tasks in the column through the canonical move policy, so completion stays globally
   * consistent (ADR-001); each affected task records its own event.
   */
  async update(
    context: ActorContext,
    workspaceId: string,
    statusId: string,
    request: UpdateStatusRequest,
  ): Promise<WorkflowStatusDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.projectsWrite);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await requireWorkspace(tx, workspaceId);
      const {
        project,
        status: previous,
        statuses,
      } = await requireStatus(tx, workspaceId, statusId);
      assertVersion(previous, request.expectedVersion, "status");

      const changed = updateStatus(statuses, statusId, {
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.category !== undefined ? { category: request.category } : {}),
        ...(request.colorToken !== undefined ? { colorToken: request.colorToken } : {}),
        ...(request.wipLimit !== undefined ? { wipLimit: request.wipLimit } : {}),
        ...(request.isDefault !== undefined ? { isDefault: request.isDefault } : {}),
        ...(request.policyMd !== undefined ? { policyMd: request.policyMd } : {}),
      });
      if (changed.length === 0) return toWorkflowStatusDto(previous);

      // The database allows one active default at a time, so a demotion is written
      // before the promotion it makes room for.
      const ordered = [...changed].sort(
        (left, right) => Number(left.isDefault) - Number(right.isDefault),
      );
      for (const next of ordered) {
        const before = statuses.find((candidate) => candidate.id === next.id);
        if (!before) throw versionConflict(next, "status");
        await this.persistStatus(tx, context, workspaceId, next, before, {
          summary:
            next.id === statusId
              ? `Updated column ${next.name}`
              : `Column ${next.name} is no longer the default`,
        });
      }

      const next = changed[0] as WorkflowStatus;
      if (isTerminal(next) !== isTerminal(previous)) {
        await this.applyCompletionChange(tx, context, workspace, project.id, next);
      }
      return toWorkflowStatusDto(next);
    });
  }

  async reorder(
    context: ActorContext,
    workspaceId: string,
    statusId: string,
    request: ReorderStatusRequest,
  ): Promise<WorkflowStatusDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.projectsWrite);

    return this.unitOfWork.execute(async (tx) => {
      await requireWorkspace(tx, workspaceId);
      const { status: previous, statuses } = await requireStatus(
        tx,
        workspaceId,
        statusId,
      );
      assertVersion(previous, request.expectedVersion, "status");

      const next = reorderStatus(statuses, statusId, request);
      if (next === previous) return toWorkflowStatusDto(previous);

      await this.persistStatus(tx, context, workspaceId, next, previous, {
        eventType: WORKFLOW_STATUS_EVENTS.reordered,
        summary: `Reordered column ${next.name}`,
        payload: {
          beforeStatusId: request.beforeStatusId ?? null,
          afterStatusId: request.afterStatusId ?? null,
        },
      });
      return toWorkflowStatusDto(next);
    });
  }

  /**
   * Move every task out of a column and archive it, atomically (spec 8.6, 11.4). Either
   * all tasks land in the destination and the column is archived, or nothing changes.
   */
  async archive(
    context: ActorContext,
    workspaceId: string,
    statusId: string,
    request: ArchiveStatusRequest,
  ): Promise<WorkflowStatusDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.projectsWrite);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await requireWorkspace(tx, workspaceId);
      const {
        project,
        status: previous,
        statuses,
      } = await requireStatus(tx, workspaceId, statusId);
      assertVersion(previous, request.expectedVersion, "status");

      const tasksInColumn = await tx.tasks.listInStatus(workspaceId, statusId);
      const result = archiveStatus(
        statuses,
        statusId,
        {
          hasTasks: tasksInColumn.length > 0,
          destinationStatusId: request.destinationStatusId,
          newDefaultStatusId: request.newDefaultStatusId,
        },
        this.clock.now(),
      );

      const movedTaskIds: string[] = [];
      if (result.destination && tasksInColumn.length > 0) {
        const destination = result.destination;
        const lastRank = await tx.tasks.lastRankIn({
          workspaceId,
          projectId: project.id,
          statusId: destination.id,
        });
        const ranks = ranksBetween(lastRank, null, tasksInColumn.length);
        for (const [index, task] of tasksInColumn.entries()) {
          const moved = relocateTask(
            task,
            {
              destination: { projectId: project.id, status: destination },
              rank: ranks[index] as string,
            },
            { actor: actorRef(context), clock: this.clock },
          );
          await this.persistTask(tx, context, workspace, moved, task, {
            eventType: TASK_EVENTS.moved,
            summary: `Moved task to ${destination.name} when ${previous.name} was archived`,
          });
          // The flow read model follows the move like any other (GAP-17).
          await syncIntervals(tx, task, moved, destination);
          movedTaskIds.push(task.id);
        }
      }

      // Archiving clears the old default, which has to land before the new default is
      // promoted: the database allows one active default at a time.
      await this.persistStatus(tx, context, workspaceId, result.archived, previous, {
        eventType: WORKFLOW_STATUS_EVENTS.archived,
        summary: `Archived column ${previous.name}`,
        payload: {
          destinationStatusId: result.destination?.id ?? null,
          newDefaultStatusId: result.newDefault?.id ?? null,
          movedTaskIds,
        },
      });

      if (result.newDefault) {
        const before = statuses.find((s) => s.id === result.newDefault?.id);
        if (!before) throw versionConflict(result.newDefault, "status");
        await this.persistStatus(tx, context, workspaceId, result.newDefault, before, {
          summary: `Column ${result.newDefault.name} is now the default`,
        });
      }
      return toWorkflowStatusDto(result.archived);
    });
  }

  private async persistStatus(
    tx: TransactionContext,
    context: ActorContext,
    workspaceId: string,
    next: WorkflowStatus,
    previous: WorkflowStatus,
    event: {
      readonly eventType?: string;
      readonly summary: string;
      readonly payload?: Record<string, unknown>;
    },
  ): Promise<void> {
    const persisted = await tx.statuses.update(next, previous.version);
    if (!persisted) throw versionConflict(previous, "status");

    await recordEvent(tx, context, this.clock, {
      workspaceId,
      aggregateType: "status",
      aggregateId: next.id,
      eventType: event.eventType ?? WORKFLOW_STATUS_EVENTS.updated,
      summary: event.summary,
      payload: {
        statusId: next.id,
        projectId: next.projectId,
        changes: statusChanges(next, previous),
        ...event.payload,
      },
    });
  }

  /**
   * Write a task the workflow change carried along. The reminder schedule follows the
   * task in the same transaction, exactly as it does for `TaskService`'s own commands
   * (GAP-13): a task completed by a column becoming Done loses its pending reminder, and
   * one reopened by the reverse change gets it back.
   */
  private async persistTask(
    tx: TransactionContext,
    context: ActorContext,
    workspace: Workspace,
    next: Task,
    previous: Task,
    event: { readonly eventType: string; readonly summary: string },
  ): Promise<void> {
    if (next === previous) return;
    const persisted = await tx.tasks.update(next, previous.version);
    if (!persisted) {
      throw versionConflict(previous, "status");
    }
    await recordEvent(tx, context, this.clock, {
      workspaceId: next.workspaceId,
      aggregateType: "task",
      aggregateId: next.id,
      eventType: event.eventType,
      summary: event.summary,
      payload: { taskId: next.id, changes: materialChanges(next, previous) },
    });
    await recomputeReminder(tx, next, workspace.timezone, this.clock.now());
  }

  /** Re-enter every task of the column so its completion follows the new category. */
  private async applyCompletionChange(
    tx: TransactionContext,
    context: ActorContext,
    workspace: Workspace,
    projectId: string,
    status: WorkflowStatus,
  ): Promise<void> {
    const entering = isTerminal(status);
    for (const task of await tx.tasks.listInStatus(workspace.id, status.id)) {
      const next = relocateTask(
        task,
        { destination: { projectId, status }, rank: task.rank },
        { actor: actorRef(context), clock: this.clock },
      );
      await this.persistTask(tx, context, workspace, next, task, {
        eventType: entering ? TASK_EVENTS.completed : TASK_EVENTS.reopened,
        summary: entering
          ? `Completed task because ${status.name} became a Done column`
          : `Reopened task because ${status.name} is no longer a Done column`,
      });
      // The task did not move, but its column's category did: the flow read model
      // records that as leaving one stay and starting another (GAP-17).
      if (next !== task) await reenterInterval(tx, next, status);
    }
  }
}

const STATUS_FIELDS = [
  "name",
  "category",
  "rank",
  "colorToken",
  "wipLimit",
  "isDefault",
  "policyMd",
  "archivedAt",
] as const satisfies readonly (keyof WorkflowStatus)[];

/** The fields that changed, for the activity payload (spec 18.2). */
function statusChanges(
  next: WorkflowStatus,
  previous: WorkflowStatus,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of STATUS_FIELDS) {
    const a = next[field];
    const b = previous[field];
    const changed =
      a instanceof Date && b instanceof Date ? a.getTime() !== b.getTime() : a !== b;
    if (changed) {
      changes[field] = {
        from: b instanceof Date ? b.toISOString() : b,
        to: a instanceof Date ? a.toISOString() : a,
      };
    }
  }
  return changes;
}

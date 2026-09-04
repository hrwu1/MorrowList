import type {
  AddTaskRelationRequest,
  AddTaskToDayRequest,
  CompleteTaskRequest,
  CreateTaskRequest,
  ListTasksQuery,
  MoveTaskRequest,
  ReorderTaskRequest,
  SetTaskBlockedRequest,
  SetTaskParentRequest,
  TaskCommandResult,
  TaskDto,
  UpdateTaskRequest,
  WipWarningDto,
} from "@morrowlist/contracts";
import { TASK_EVENTS } from "@morrowlist/contracts";
import {
  DomainError,
  MAX_TAGS_PER_TASK,
  ValidationError,
  assertExpectedVersion,
  assertNoBlocksCycle,
  assertParentIsAssignable,
  canonicalizeRelation,
  clearBlocked as applyClearBlocked,
  completeTask,
  createTask,
  deleteTask,
  flagBlocked,
  isBlocked,
  entersInProgress,
  isTerminal,
  materialChanges,
  moveTask as applyTaskMove,
  rankBetween,
  reopenTask,
  reorderTask as applyTaskReorder,
  resolveReopenStatus,
  restoreTask,
  setParent as applyParent,
  skipOccurrence as applySkip,
  spawnNextOccurrence,
  systemClock,
  taskKey,
  toLocalDate,
  toPlainDate,
  updateTaskFields,
  uuidv7,
  wipWarning,
  type Clock,
  type CreateTaskInput,
  type DayPlanSource,
  type PlainDate,
  type PlainTime,
  type Tag,
  type Task,
  type TaskRelation,
  type WorkflowStatus,
} from "@morrowlist/domain";

import type {
  Page,
  RankScope,
  RelationEdge,
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
import { decodeCursor, encodeCursor } from "../shared/cursor.js";
import { recordEvent } from "../shared/event-recorder.js";

import { toTaskDto } from "./mappers.js";

/**
 * Task use cases (spec 19.2). Each method is one user-visible intention: it authorises,
 * validates, mutates, and records activity plus an outbox event in a single transaction
 * (spec 17.3). No HTTP or SQL detail appears here.
 */

export interface TaskServiceOptions {
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
  /** Secret used to sign pagination cursors so clients cannot forge a position. */
  readonly cursorSecret: string;
}

export interface WorkspaceScopedRequest {
  readonly workspaceId: string;
}

export class TaskService {
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;
  private readonly cursorSecret: string;

  constructor(options: TaskServiceOptions) {
    this.unitOfWork = options.unitOfWork;
    this.clock = options.clock ?? systemClock;
    this.cursorSecret = options.cursorSecret;
  }

  /**
   * Create a task (spec 19.2 CreateTask). With only a title supplied, the task lands in
   * the Inbox with a workspace task key, a rank, version 1, an activity event, and an
   * outbox event (M3 acceptance scenario 1).
   */
  async create(
    context: ActorContext,
    request: CreateTaskRequest & WorkspaceScopedRequest,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, request.workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, request.workspaceId);

      const id = uuidv7();
      const parent = request.parentTaskId
        ? await this.requireTask(tx, request.workspaceId, request.parentTaskId)
        : null;
      if (parent) {
        // The new task is a leaf, so only the depth above the parent matters.
        assertParentIsAssignable(
          id,
          parent.id,
          await tx.tasks.ancestorIds(request.workspaceId, parent.id),
          0,
        );
      }

      // A subtask defaults to its parent's project unless the request says otherwise
      // (spec 8.3); an explicit null still means the Inbox.
      const projectId =
        request.projectId === undefined
          ? (parent?.projectId ?? null)
          : request.projectId;
      const destination = projectId
        ? await this.resolveDestination(
            tx,
            request.workspaceId,
            projectId,
            request.statusId ?? null,
          )
        : null;

      const task = await this.insertNewTask(tx, context, workspace, {
        id,
        title: request.title,
        descriptionMd: request.descriptionMd ?? null,
        ...(request.priority ? { priority: request.priority } : {}),
        dueDate: (request.dueDate ?? null) as PlainDate | null,
        dueTime: (request.dueTime ?? null) as PlainTime | null,
        dueTimezone: request.dueTimezone ?? workspace.timezone,
        parentTaskId: parent?.id ?? null,
        recurrence: request.recurrence ?? null,
        project: destination,
      });

      if (request.addToDay) {
        // Capturing straight into My Day is the same dated relation as adding later,
        // recorded in the same transaction as the task itself (spec 20.4).
        await this.insertDayPlan(
          tx,
          context,
          task,
          toPlainDate(request.addToDay, "addToDay"),
          "capture",
        );
      }

      return this.toDto(tx, workspace, task);
    });
  }

  /**
   * Add a task to My Day for a date, defaulting to the workspace's current date (spec
   * 9.2). The selection is a dated relation: the task row is untouched, so its version
   * does not change and nothing about its due date or status moves.
   */
  async addToDay(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    request: AddTaskToDayRequest = {},
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, workspaceId);
      const task = await this.requireTask(tx, workspaceId, taskId);
      const date = request.date
        ? toPlainDate(request.date, "date")
        : this.workspaceToday(workspace.timezone);

      await this.insertDayPlan(tx, context, task, date, "manual");
      return this.toDto(tx, workspace, task);
    });
  }

  /** Remove a My Day selection. Removing one that does not exist is a harmless no-op. */
  async removeFromDay(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    date: string,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, workspaceId);
      const task = await this.requireTask(tx, workspaceId, taskId);
      const planDate = toPlainDate(date, "date");

      const removed = await tx.dayPlans.delete(task.id, planDate);
      if (removed) {
        await recordEvent(tx, context, this.clock, {
          workspaceId,
          aggregateType: "task",
          aggregateId: task.id,
          eventType: TASK_EVENTS.dayRemoved,
          summary: `Removed task from My Day for ${planDate}`,
          payload: { taskId: task.id, planDate, source: "manual" },
        });
      }
      return this.toDto(tx, workspace, task);
    });
  }

  /** Fetch one task by UUID or by workspace task key such as `ML-142` (spec 20.3). */
  async get(
    context: ActorContext,
    workspaceId: string,
    idOrKey: string,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksRead);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, workspaceId);
      const task = await this.resolveTask(tx, workspaceId, idOrKey);
      return this.toDto(tx, workspace, task);
    });
  }

  async list(
    context: ActorContext,
    query: ListTasksQuery & WorkspaceScopedRequest,
  ): Promise<{
    data: TaskDto[];
    page: { nextCursor: string | null; hasMore: boolean };
  }> {
    assertWorkspaceAccess(context, query.workspaceId);
    assertScope(context, SCOPES.tasksRead);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, query.workspaceId);
      const after = query.cursor
        ? decodeCursor(query.cursor, this.cursorSecret).i
        : undefined;

      const page: Page<Task> = await tx.tasks.list(
        {
          workspaceId: query.workspaceId,
          projectId: query.projectId,
          statusId: query.statusId,
          parentTaskId: query.parentTaskId,
          priority: query.priority,
          tagId: query.tagId,
          seriesId: query.seriesId,
          inboxOnly: query.inbox,
          isCompleted: query.isCompleted,
          isBlocked: query.isBlocked,
          deletedOnly: query.deleted,
          includeSubtasks: query.includeSubtasks,
          due: query.due,
          today: this.workspaceToday(workspace.timezone),
          sort: query.sort,
          order: query.order,
        },
        { limit: query.limit, after },
      );

      const last = page.items.at(-1);
      return {
        data: await this.toDtos(tx, workspace, page.items),
        page: {
          hasMore: page.hasMore,
          nextCursor:
            page.hasMore && last
              ? encodeCursor({ k: last.rank, i: last.id }, this.cursorSecret)
              : null,
        },
      };
    });
  }

  /** Update the simple fields; omitted keys are untouched and explicit nulls clear. */
  async update(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    request: UpdateTaskRequest,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.mutate(context, workspaceId, taskId, request.expectedVersion, {
      eventType: TASK_EVENTS.updated,
      summarize: () => "Updated task fields",
      apply: (task) =>
        updateTaskFields(
          task,
          {
            ...(request.title !== undefined ? { title: request.title } : {}),
            ...(request.descriptionMd !== undefined
              ? { descriptionMd: request.descriptionMd }
              : {}),
            ...(request.priority !== undefined ? { priority: request.priority } : {}),
            ...(request.dueDate !== undefined
              ? { dueDate: request.dueDate as PlainDate | null }
              : {}),
            ...(request.dueTime !== undefined
              ? { dueTime: request.dueTime as PlainTime | null }
              : {}),
            ...(request.dueTimezone !== undefined
              ? { dueTimezone: request.dueTimezone }
              : {}),
            ...(request.recurrence !== undefined
              ? { recurrence: request.recurrence }
              : {}),
          },
          { actor: actorRef(context), clock: this.clock },
        ),
    });
  }

  /**
   * Move a task to another project/status and place it between server-validated neighbours.
   * The destination category drives completion, so a card dropped into Done is the same
   * canonical completion seen by every other task projection.
   */
  async move(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    request: MoveTaskRequest,
  ): Promise<TaskCommandResult> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.mutateWithWarnings(
      context,
      workspaceId,
      taskId,
      request.expectedVersion,
      {
        eventType: TASK_EVENTS.moved,
        summarize: (next) =>
          next.projectId === null
            ? "Moved task to Inbox"
            : "Moved task to another status",
        apply: async (task, tx) => {
          if (request.projectId === null && request.statusId != null) {
            throw new DomainError(
              "VALIDATION_FAILED",
              "An Inbox destination cannot have a workflow status.",
              { projectId: null, statusId: request.statusId },
            );
          }

          const destination =
            request.projectId === null
              ? null
              : await this.resolveDestination(
                  tx,
                  workspaceId,
                  request.projectId,
                  request.statusId ?? null,
                );
          const scope: RankScope = {
            workspaceId,
            projectId: destination?.id ?? null,
            statusId: destination?.status.id ?? null,
          };
          const rank = await this.resolveOrderingRank(tx, task.id, scope, request);

          return applyTaskMove(
            task,
            {
              destination: destination
                ? { projectId: destination.id, status: destination.status }
                : null,
              rank,
            },
            { actor: actorRef(context), clock: this.clock },
          );
        },
      },
    );
  }

  /** Reorder a task inside its current Inbox or project-status rank scope. */
  async reorder(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    request: ReorderTaskRequest,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.mutate(context, workspaceId, taskId, request.expectedVersion, {
      eventType: TASK_EVENTS.reordered,
      summarize: () => "Reordered task",
      apply: async (task, tx) => {
        const scope: RankScope = {
          workspaceId,
          projectId: task.projectId,
          statusId: task.statusId,
        };
        const rank = await this.resolveOrderingRank(tx, task.id, scope, request);
        return applyTaskReorder(task, rank, {
          actor: actorRef(context),
          clock: this.clock,
        });
      },
    });
  }

  /**
   * Make a task a subtask of another (spec 8.3). The parent must be a live task in this
   * workspace; the chain stays acyclic and at most three levels deep.
   */
  async setParent(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    request: SetTaskParentRequest,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.mutate(context, workspaceId, taskId, request.expectedVersion, {
      eventType: TASK_EVENTS.parentChanged,
      summarize: () => "Made task a subtask",
      payload: parentChangePayload,
      apply: async (task, tx) => {
        const parent = await this.requireTask(tx, workspaceId, request.parentTaskId);
        return applyParent(
          task,
          {
            parent,
            ancestorIds: await tx.tasks.ancestorIds(workspaceId, parent.id),
            descendantDepth: await tx.tasks.descendantDepth(workspaceId, task.id),
          },
          { actor: actorRef(context), clock: this.clock },
        );
      },
    });
  }

  /** Detach a subtask from its parent; it stays exactly where it is otherwise. */
  async clearParent(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    expectedVersion?: number,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.mutate(context, workspaceId, taskId, expectedVersion, {
      eventType: TASK_EVENTS.parentChanged,
      summarize: () => "Detached task from its parent",
      payload: parentChangePayload,
      apply: (task) =>
        applyParent(
          task,
          { parent: null },
          { actor: actorRef(context), clock: this.clock },
        ),
    });
  }

  /**
   * Complete a task (spec 8.5). A project task moves to the project's Done status at the
   * end of that column; an Inbox task keeps its null project and status. A blocked task
   * completes only once the caller has acknowledged the warning (spec 8.4): the product
   * warns, it does not enforce one productivity philosophy.
   *
   * A repeating task also spawns its next occurrence here, in the same transaction, and
   * hands its rule over to it (GAP-12): there is no scheduler, and a completed occurrence
   * without a rule cannot spawn a duplicate if it is reopened and completed again. The
   * last occurrence of a bounded series spawns nothing and simply drops its rule.
   */
  async complete(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    request: CompleteTaskRequest = {},
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    let spawned: Task | null = null;
    return this.mutate(context, workspaceId, taskId, request.expectedVersion, {
      eventType: TASK_EVENTS.completed,
      summarize: (_next, _previous, workspace) =>
        spawned
          ? `Completed task; next occurrence is ${taskKey(workspace.taskKeyPrefix, spawned.taskNumber)}`
          : "Completed task",
      apply: async (task, tx, workspace) => {
        if (
          !request.acknowledgeBlocked &&
          isBlocked(task, await this.blockersOf(tx, task))
        ) {
          throw new DomainError(
            "TASK_BLOCKED",
            "This task is blocked. Acknowledge the warning to complete it anyway.",
            { taskId: task.id },
          );
        }
        const doneStatus = task.projectId
          ? await this.resolveDoneStatus(tx, task)
          : undefined;
        const completed = completeTask(task, doneStatus ? { doneStatus } : {}, {
          actor: actorRef(context),
          clock: this.clock,
        });
        if (completed === task || task.recurrence === null) return completed;

        const next = spawnNextOccurrence(task, this.workspaceToday(workspace.timezone));
        if (next) {
          const destination = next.projectId
            ? await this.resolveDestination(tx, workspaceId, next.projectId, null)
            : null;
          spawned = await this.insertNewTask(
            tx,
            context,
            workspace,
            { ...next, id: uuidv7(), project: destination },
            { spawnedFrom: task.id, tags: await this.tagsOf(tx, task) },
          );
        }
        return { ...completed, recurrence: null };
      },
    });
  }

  /**
   * Skip the current occurrence of a repeating task (GAP-12): the task itself moves on
   * to its next date, exactly where completion would have put the next occurrence, and
   * nothing is created. The last occurrence is rejected; complete or delete it instead.
   */
  async skipOccurrence(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    expectedVersion?: number,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.mutate(context, workspaceId, taskId, expectedVersion, {
      eventType: TASK_EVENTS.occurrenceSkipped,
      summarize: (_next, previous) =>
        previous.dueDate
          ? `Skipped occurrence due ${previous.dueDate}`
          : "Skipped occurrence",
      apply: (task, _tx, workspace) =>
        applySkip(task, this.workspaceToday(workspace.timezone), {
          actor: actorRef(context),
          clock: this.clock,
        }),
    });
  }

  /**
   * Reopen a completed task, restoring its prior status where possible (spec 8.5). That
   * status may be In Progress, so this can start work again and warn like a move.
   */
  async reopen(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    expectedVersion?: number,
  ): Promise<TaskCommandResult> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.mutateWithWarnings(context, workspaceId, taskId, expectedVersion, {
      eventType: TASK_EVENTS.reopened,
      summarize: () => "Reopened task",
      apply: async (task, tx) => {
        if (!task.projectId) {
          return reopenTask(task, {}, { actor: actorRef(context), clock: this.clock });
        }
        const statuses = await tx.statuses.listByProject(task.projectId);
        const status = resolveReopenStatus(task, statuses);
        if (!status) {
          throw new DomainError(
            "STATUS_NOT_FOUND",
            "The project has no active status to reopen into.",
            { taskId: task.id, projectId: task.projectId },
          );
        }
        const lastRank = await tx.tasks.lastRankIn({
          workspaceId: task.workspaceId,
          projectId: task.projectId,
          statusId: status.id,
        });
        return reopenTask(
          task,
          { destination: { status, rank: rankBetween(lastRank, null) } },
          { actor: actorRef(context), clock: this.clock },
        );
      },
    });
  }

  /** Soft delete: the task moves to Trash and stays restorable (spec 8.6). */
  async delete(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    expectedVersion?: number,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.mutate(
      context,
      workspaceId,
      taskId,
      expectedVersion,
      {
        eventType: TASK_EVENTS.deleted,
        summarize: () => "Moved task to Trash",
        apply: (task) =>
          deleteTask(task, { actor: actorRef(context), clock: this.clock }),
      },
      { allowDeleted: true },
    );
  }

  async restore(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    expectedVersion?: number,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.mutate(
      context,
      workspaceId,
      taskId,
      expectedVersion,
      {
        eventType: TASK_EVENTS.restored,
        summarize: () => "Restored task from Trash",
        apply: (task) =>
          restoreTask(task, { actor: actorRef(context), clock: this.clock }),
      },
      { allowDeleted: true },
    );
  }

  /**
   * Attach a workspace tag (spec 12.1). The tag set is a relation on the canonical task,
   * like My Day (ADR-001): it changes no task column, so the task's version is untouched
   * and an open editor's expectedVersion stays valid. Adding a tag the task already
   * carries is a no-op that records no event.
   */
  async addTag(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    tagId: string,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, workspaceId);
      const task = await this.requireTask(tx, workspaceId, taskId);
      const tag = await this.requireTag(tx, workspaceId, tagId);
      const current = await this.tagsOf(tx, task);

      if (current.some((candidate) => candidate.id === tag.id)) {
        return this.toDto(tx, workspace, task);
      }
      if (current.length >= MAX_TAGS_PER_TASK) {
        throw new ValidationError(
          `A task can carry at most ${MAX_TAGS_PER_TASK} tags.`,
          { taskId, maxTags: MAX_TAGS_PER_TASK },
        );
      }

      await tx.tasks.addTag(taskId, tagId, this.clock.now());
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "task",
        aggregateId: taskId,
        eventType: TASK_EVENTS.tagAdded,
        summary: `Added tag ${tag.name}`,
        payload: { taskId, tagId, tagName: tag.name },
      });
      return this.toDto(tx, workspace, task);
    });
  }

  async removeTag(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    tagId: string,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, workspaceId);
      const task = await this.requireTask(tx, workspaceId, taskId);
      const current = await this.tagsOf(tx, task);
      const tag = current.find((candidate) => candidate.id === tagId);
      if (!tag) {
        // Not carried: nothing to remove, nothing to record. An unknown tag id is still
        // reported so a client cannot mistake a typo for success.
        await this.requireTag(tx, workspaceId, tagId);
        return this.toDto(tx, workspace, task);
      }

      await tx.tasks.removeTag(taskId, tagId);
      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "task",
        aggregateId: taskId,
        eventType: TASK_EVENTS.tagRemoved,
        summary: `Removed tag ${tag.name}`,
        payload: { taskId, tagId, tagName: tag.name },
      });
      return this.toDto(tx, workspace, task);
    });
  }

  /**
   * Flag a task as blocked with a reason (spec 8.4, GAP-06). The flag is a task column,
   * so the version moves like any other edit; the task stays in its workflow status.
   */
  async setBlocked(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    request: SetTaskBlockedRequest,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.mutate(context, workspaceId, taskId, request.expectedVersion, {
      eventType: TASK_EVENTS.blocked,
      summarize: (next) => `Marked task blocked: ${next.blockedReason ?? ""}`,
      payload: (next) => ({
        taskId: next.id,
        reason: next.blockedReason,
        since: next.blockedSince?.toISOString() ?? null,
      }),
      apply: (task) =>
        flagBlocked(task, request.reason, {
          actor: actorRef(context),
          clock: this.clock,
        }),
    });
  }

  /** Clear the blocker flag; a no-op that records nothing when the task is not flagged. */
  async clearBlocked(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    expectedVersion?: number,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.mutate(context, workspaceId, taskId, expectedVersion, {
      eventType: TASK_EVENTS.unblocked,
      summarize: () => "Cleared the blocked flag",
      payload: (next, previous) => ({
        taskId: next.id,
        reason: previous.blockedReason,
        since: previous.blockedSince?.toISOString() ?? null,
        clearedAt: next.updatedAt.toISOString(),
      }),
      apply: (task) =>
        applyClearBlocked(task, { actor: actorRef(context), clock: this.clock }),
    });
  }

  /**
   * Relate two tasks (spec 8.4). `taskId` is the source of a `blocks` edge; `related_to`
   * is stored once in canonical order. Neither task's row changes, so their versions are
   * untouched; adding an edge that already exists is a no-op with no event. A `blocks`
   * edge that would close a loop is TASK_RELATION_CYCLE.
   */
  async addRelation(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    request: AddTaskRelationRequest,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, workspaceId);
      const task = await this.requireTask(tx, workspaceId, taskId);
      const target = await this.requireTask(tx, workspaceId, request.targetTaskId);
      const endpoints = canonicalizeRelation(request.type, task, target);
      if (request.type === "blocks") {
        assertNoBlocksCycle(
          endpoints.sourceTaskId,
          endpoints.targetTaskId,
          await tx.tasks.downstreamOf(workspaceId, endpoints.targetTaskId, "blocks"),
        );
      }

      const relation: TaskRelation = {
        id: uuidv7(),
        workspaceId,
        ...endpoints,
        type: request.type,
        metadata: {},
        createdBy: actorRef(context),
        createdAt: this.clock.now(),
      };
      if (await tx.tasks.insertRelation(relation)) {
        await this.recordRelationEvent(
          tx,
          context,
          workspace,
          TASK_EVENTS.relationAdded,
          relation,
          task,
          target,
        );
      }
      return this.toDto(tx, workspace, task);
    });
  }

  /** Remove a relation from either of its endpoints. */
  async removeRelation(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    relationId: string,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, workspaceId);
      const task = await this.requireTask(tx, workspaceId, taskId);
      const relation = await tx.tasks.findRelation(workspaceId, relationId);
      if (
        !relation ||
        (relation.sourceTaskId !== task.id && relation.targetTaskId !== task.id)
      ) {
        throw new DomainError("TASK_RELATION_NOT_FOUND", "Relation not found.", {
          taskId,
          relationId,
        });
      }
      const otherId =
        relation.sourceTaskId === task.id
          ? relation.targetTaskId
          : relation.sourceTaskId;
      const other = await this.requireTask(tx, workspaceId, otherId, {
        allowDeleted: true,
      });

      await tx.tasks.deleteRelation(workspaceId, relation.id);
      await this.recordRelationEvent(
        tx,
        context,
        workspace,
        TASK_EVENTS.relationRemoved,
        relation,
        task,
        other,
      );
      return this.toDto(tx, workspace, task);
    });
  }

  /**
   * A relation belongs to both of its endpoints, so each gets an activity and an outbox
   * row (spec 8.4 "captured in activity history") in the one transaction.
   */
  private async recordRelationEvent(
    tx: TransactionContext,
    context: ActorContext,
    workspace: Workspace,
    eventType: string,
    relation: TaskRelation,
    task: Task,
    other: Task,
  ): Promise<void> {
    const verb = eventType === TASK_EVENTS.relationAdded ? "Added" : "Removed";
    for (const [subject, counterpart] of [
      [task, other],
      [other, task],
    ] as const) {
      const counterpartKey = `${workspace.taskKeyPrefix}-${counterpart.taskNumber}`;
      await recordEvent(tx, context, this.clock, {
        workspaceId: workspace.id,
        aggregateType: "task",
        aggregateId: subject.id,
        eventType,
        summary: `${verb} relation: ${describeRelation(relation, subject.id)} ${counterpartKey}`,
        payload: {
          taskId: subject.id,
          relationId: relation.id,
          type: relation.type,
          sourceTaskId: relation.sourceTaskId,
          targetTaskId: relation.targetTaskId,
          otherTaskId: counterpart.id,
          otherTaskKey: counterpartKey,
        },
      });
    }
  }

  /** The live `blocks` predecessors of one task, for the completion guard. */
  private async blockersOf(tx: TransactionContext, task: Task): Promise<Task[]> {
    const edges = await tx.tasks.relationsFor(task.workspaceId, [task.id]);
    return edges
      .filter((edge) => edge.relation.type === "blocks" && edge.target.id === task.id)
      .map((edge) => edge.source);
  }

  /**
   * Shared mutation pipeline: load, guard the expected version, apply a policy, persist
   * with an optimistic-concurrency check, and record activity plus an outbox event — all
   * in one transaction.
   */
  private async mutate(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    expectedVersion: number | undefined,
    step: MutationStep,
    options: { allowDeleted?: boolean } = {},
  ): Promise<TaskDto> {
    const result = await this.mutateWithWarnings(
      context,
      workspaceId,
      taskId,
      expectedVersion,
      step,
      options,
    );
    return result.task;
  }

  /** The mutation pipeline plus the cross-project WIP check on what it produced. */
  private async mutateWithWarnings(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    expectedVersion: number | undefined,
    step: MutationStep,
    options: { allowDeleted?: boolean } = {},
  ): Promise<TaskCommandResult> {
    return this.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, workspaceId);
      const previous = await this.requireTask(tx, workspaceId, taskId, options);

      assertExpectedVersion(previous, expectedVersion);

      const next = await step.apply(previous, tx, workspace);
      if (next === previous) {
        // The policy decided nothing material changed: no version bump, no event.
        return { task: await this.toDto(tx, workspace, previous), warnings: [] };
      }

      const persisted = await tx.tasks.update(next, previous.version);
      if (!persisted) {
        // The row moved between the read and the write inside this transaction.
        const current = await tx.tasks.findById(workspaceId, taskId);
        throw new DomainError(
          "TASK_VERSION_CONFLICT",
          "The task changed after you loaded it.",
          {
            taskId,
            expectedVersion: previous.version,
            actualVersion: current?.version ?? null,
          },
        );
      }

      await recordEvent(tx, context, this.clock, {
        workspaceId,
        aggregateType: "task",
        aggregateId: taskId,
        eventType: step.eventType,
        summary: step.summarize(next, previous, workspace),
        payload: step.payload
          ? step.payload(next, previous)
          : { taskId, changes: materialChanges(next, previous) },
      });

      return {
        task: await this.toDto(tx, workspace, next),
        warnings: await this.wipWarnings(tx, workspace, next, previous),
      };
    });
  }

  /**
   * The workspace's cross-project limit (GAP-20), checked only when the task has just
   * entered an in-progress column: reordering inside one, or moving between two, starts
   * nothing new. Exceeding the limit warns and names every started task; it never blocks.
   */
  private async wipWarnings(
    tx: TransactionContext,
    workspace: Workspace,
    next: Task,
    previous: Task,
  ): Promise<WipWarningDto[]> {
    if (
      workspace.inProgressLimit === null ||
      next.statusId === null ||
      next.statusId === previous.statusId
    ) {
      return [];
    }
    const [from, to] = await Promise.all([
      previous.statusId ? tx.statuses.findById(previous.statusId) : null,
      tx.statuses.findById(next.statusId),
    ]);
    if (!entersInProgress(from, to)) return [];

    const inProgress = await tx.tasks.listInProgress(workspace.id);
    const warning = wipWarning(inProgress.length, workspace.inProgressLimit);
    if (!warning) return [];
    return [
      {
        ...warning,
        message: `${warning.count} tasks are in progress across your projects; the limit is ${warning.limit}.`,
        tasks: inProgress.map((task) => ({
          id: task.id,
          key: taskKey(workspace.taskKeyPrefix, task.taskNumber),
          title: task.title,
          projectId: task.projectId,
        })),
      },
    ];
  }

  /**
   * Persist a new task at the end of its scope with its `task.created` event. Shared by
   * capture and by the spawn of a repeating task's next occurrence, so both land the same
   * way: a workspace number, a rank after everything else, and one activity row.
   */
  private async insertNewTask(
    tx: TransactionContext,
    context: ActorContext,
    workspace: Workspace,
    fields: Omit<CreateTaskInput, "workspaceId" | "taskNumber" | "rank">,
    origin: { spawnedFrom: string; tags: readonly Tag[] } | null = null,
  ): Promise<Task> {
    const scope: RankScope = {
      workspaceId: workspace.id,
      projectId: fields.project?.id ?? null,
      statusId: fields.project?.status.id ?? null,
    };
    // New tasks land at the end of their scope so capture never reorders existing work.
    const lastRank = await tx.tasks.lastRankIn(scope);

    const task = createTask(
      {
        ...fields,
        workspaceId: workspace.id,
        taskNumber: await tx.taskCounters.allocate(workspace.id),
        rank: rankBetween(lastRank, null),
      },
      { actor: actorRef(context), clock: this.clock },
    );

    await tx.tasks.insert(task);
    for (const tag of origin?.tags ?? []) {
      await tx.tasks.addTag(task.id, tag.id, this.clock.now());
    }
    const key = taskKey(workspace.taskKeyPrefix, task.taskNumber);
    await recordEvent(tx, context, this.clock, {
      workspaceId: task.workspaceId,
      aggregateType: "task",
      aggregateId: task.id,
      eventType: TASK_EVENTS.created,
      summary: origin
        ? `Created task ${key} as the next occurrence of a repeating task`
        : `Created task ${key}`,
      payload: {
        taskId: task.id,
        taskNumber: task.taskNumber,
        projectId: task.projectId,
        statusId: task.statusId,
        priority: task.priority,
        parentTaskId: task.parentTaskId,
        seriesId: task.seriesId,
        ...(origin ? { spawnedFrom: origin.spawnedFrom } : {}),
      },
    });
    return task;
  }

  private async insertDayPlan(
    tx: TransactionContext,
    context: ActorContext,
    task: Task,
    planDate: PlainDate,
    source: DayPlanSource,
  ): Promise<void> {
    const inserted = await tx.dayPlans.insert({
      taskId: task.id,
      planDate,
      source,
      createdBy: actorRef(context),
      createdAt: this.clock.now(),
    });
    // Already planned for that day: nothing changed, so nothing is recorded.
    if (!inserted) return;

    await recordEvent(tx, context, this.clock, {
      workspaceId: task.workspaceId,
      aggregateType: "task",
      aggregateId: task.id,
      eventType: TASK_EVENTS.dayAdded,
      summary: `Added task to My Day for ${planDate}`,
      payload: { taskId: task.id, planDate, source },
    });
  }

  private async toDto(
    tx: TransactionContext,
    workspace: Workspace,
    task: Task,
  ): Promise<TaskDto> {
    const [dto] = await this.toDtos(tx, workspace, [task]);
    return dto as TaskDto;
  }

  /**
   * Map tasks with their upcoming My Day dates (spec 9.5), their child progress, their
   * tags and their relations (spec 29.3), each loaded in one query for the whole page.
   * Tags and relations survive every command here: completion, moves, deletion and
   * restore all leave them alone (spec 8.5).
   */
  private async toDtos(
    tx: TransactionContext,
    workspace: Workspace,
    tasks: readonly Task[],
  ): Promise<TaskDto[]> {
    const ids = tasks.map((task) => task.id);
    const [plans, progress, tags, edges]: [
      ReadonlyMap<string, readonly string[]>,
      ReadonlyMap<string, { completed: number; total: number }>,
      ReadonlyMap<string, readonly Tag[]>,
      readonly RelationEdge[],
    ] = await Promise.all([
      tx.dayPlans.listForTasks(ids, this.workspaceToday(workspace.timezone)),
      tx.tasks.childSummary(workspace.id, ids),
      tx.tasks.tagsFor(workspace.id, ids),
      tx.tasks.relationsFor(workspace.id, ids),
    ]);
    return tasks.map((task) =>
      toTaskDto(
        task,
        workspace.taskKeyPrefix,
        plans.get(task.id) ?? [],
        progress.get(task.id) ?? null,
        tags.get(task.id) ?? [],
        edges,
      ),
    );
  }

  private async tagsOf(tx: TransactionContext, task: Task): Promise<readonly Tag[]> {
    const tags = await tx.tasks.tagsFor(task.workspaceId, [task.id]);
    return tags.get(task.id) ?? [];
  }

  private async requireTag(
    tx: TransactionContext,
    workspaceId: string,
    tagId: string,
  ): Promise<Tag> {
    const tag = await tx.tags.findById(workspaceId, tagId);
    if (!tag) throw new DomainError("TAG_NOT_FOUND", "Tag not found.", { tagId });
    return tag;
  }

  private async requireWorkspace(tx: TransactionContext, workspaceId: string) {
    const workspace = await tx.workspaces.findById(workspaceId);
    if (!workspace) {
      throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace not found.", {
        workspaceId,
      });
    }
    return workspace;
  }

  private async requireTask(
    tx: TransactionContext,
    workspaceId: string,
    taskId: string,
    options: { allowDeleted?: boolean } = {},
  ): Promise<Task> {
    const task = await tx.tasks.findById(workspaceId, taskId);
    if (!task || (task.deletedAt !== null && !options.allowDeleted)) {
      throw new DomainError("TASK_NOT_FOUND", "Task not found.", { taskId });
    }
    return task;
  }

  private async resolveTask(
    tx: TransactionContext,
    workspaceId: string,
    idOrKey: string,
  ): Promise<Task> {
    const numeric = /^\d+$/.test(idOrKey)
      ? Number(idOrKey)
      : /-(\d+)$/.exec(idOrKey)?.[1];
    const task =
      numeric === undefined
        ? await tx.tasks.findById(workspaceId, idOrKey)
        : await tx.tasks.findByNumber(workspaceId, Number(numeric));

    if (!task || task.deletedAt !== null) {
      throw new DomainError("TASK_NOT_FOUND", "Task not found.", { idOrKey });
    }
    return task;
  }

  private async resolveDestination(
    tx: TransactionContext,
    workspaceId: string,
    projectId: string,
    statusId: string | null,
  ): Promise<{ id: string; status: WorkflowStatus }> {
    const project = await tx.projects.findById(workspaceId, projectId);
    if (!project || project.archivedAt !== null) {
      throw new DomainError("PROJECT_NOT_FOUND", "Project not found.", { projectId });
    }
    const statuses = await tx.statuses.listByProject(projectId);
    if (statuses.length === 0) {
      throw new DomainError("PROJECT_NOT_FOUND", "Project not found.", { projectId });
    }

    const status = statusId
      ? statuses.find((candidate) => candidate.id === statusId)
      : statuses.find((candidate) => candidate.isDefault);

    if (!status) {
      throw new DomainError(
        "STATUS_NOT_FOUND",
        statusId
          ? "The selected status does not belong to this project."
          : "The project has no default status.",
        { projectId, statusId },
      );
    }
    return { id: projectId, status };
  }

  /**
   * Resolve a client-described position to a server-owned fractional rank. Every supplied
   * anchor must still be a live task in the exact destination scope. A disappeared or moved
   * anchor is a board race, so it becomes the same recoverable conflict UX as a stale task.
   */
  private async resolveOrderingRank(
    tx: TransactionContext,
    movingTaskId: string,
    scope: RankScope,
    request: {
      readonly beforeTaskId?: string | null | undefined;
      readonly afterTaskId?: string | null | undefined;
    },
  ): Promise<string> {
    const beforeId = request.beforeTaskId ?? null;
    const afterId = request.afterTaskId ?? null;
    if (beforeId !== null && beforeId === afterId) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Ordering neighbours must be different tasks.",
        { beforeTaskId: beforeId, afterTaskId: afterId },
      );
    }
    if (beforeId === movingTaskId || afterId === movingTaskId) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "A task cannot be its own ordering neighbour.",
        { taskId: movingTaskId },
      );
    }

    if (beforeId === null && afterId === null) {
      return rankBetween(await tx.tasks.lastRankIn(scope), null);
    }

    const before = beforeId
      ? await this.requireOrderingNeighbour(tx, movingTaskId, beforeId, scope)
      : null;
    const after = afterId
      ? await this.requireOrderingNeighbour(tx, movingTaskId, afterId, scope)
      : null;
    if (before && after && before.rank >= after.rank) {
      throw this.orderingConflict(movingTaskId, beforeId, afterId);
    }
    return rankBetween(before?.rank ?? null, after?.rank ?? null);
  }

  private async requireOrderingNeighbour(
    tx: TransactionContext,
    movingTaskId: string,
    neighbourId: string,
    scope: RankScope,
  ): Promise<Task> {
    const neighbour = await tx.tasks.findById(scope.workspaceId, neighbourId);
    if (
      !neighbour ||
      neighbour.deletedAt !== null ||
      neighbour.projectId !== scope.projectId ||
      neighbour.statusId !== scope.statusId
    ) {
      throw this.orderingConflict(movingTaskId, neighbourId, null);
    }
    return neighbour;
  }

  private orderingConflict(
    taskId: string,
    beforeTaskId: string | null,
    afterTaskId: string | null,
  ): DomainError {
    return new DomainError(
      "TASK_VERSION_CONFLICT",
      "The board order changed before this move could be saved.",
      { taskId, beforeTaskId, afterTaskId },
    );
  }

  private async resolveDoneStatus(
    tx: TransactionContext,
    task: Task,
  ): Promise<{ status: WorkflowStatus; rank: string } | undefined> {
    if (!task.projectId) return undefined;
    const statuses = await tx.statuses.listByProject(task.projectId);
    const done = statuses.find(
      (status) => isTerminal(status) && status.archivedAt === null,
    );
    if (!done) return undefined;

    const lastRank = await tx.tasks.lastRankIn({
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      statusId: done.id,
    });
    return { status: done, rank: rankBetween(lastRank, null) };
  }

  /** The workspace's local calendar date, used by the `due` filter (spec 12.3). */
  private workspaceToday(timezone: string): PlainDate {
    return toLocalDate(this.clock.now(), timezone);
  }
}

/** "blocks", "blocked by", or "related to", as read from one endpoint. */
function describeRelation(relation: TaskRelation, fromTaskId: string): string {
  if (relation.type === "related_to") return "related to";
  return relation.sourceTaskId === fromTaskId ? "blocks" : "blocked by";
}

interface MutationStep {
  readonly eventType: string;
  readonly summarize: (next: Task, previous: Task, workspace: Workspace) => string;
  readonly apply: (
    task: Task,
    tx: TransactionContext,
    workspace: Workspace,
  ) => Task | Promise<Task>;
  /** Event payload; defaults to the field-level diff (spec 18.2). */
  readonly payload?: (next: Task, previous: Task) => Record<string, unknown>;
}

function parentChangePayload(next: Task, previous: Task): Record<string, unknown> {
  return {
    taskId: next.id,
    previousParentId: previous.parentTaskId,
    parentId: next.parentTaskId,
  };
}

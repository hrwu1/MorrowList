import type {
  AddTaskToDayRequest,
  CreateTaskRequest,
  ListTasksQuery,
  MoveTaskRequest,
  ReorderTaskRequest,
  SetTaskParentRequest,
  TaskDto,
  UpdateTaskRequest,
} from "@morrowlist/contracts";
import { TASK_EVENTS } from "@morrowlist/contracts";
import {
  DomainError,
  MAX_TAGS_PER_TASK,
  ValidationError,
  assertExpectedVersion,
  assertParentIsAssignable,
  completeTask,
  createTask,
  deleteTask,
  isTerminal,
  materialChanges,
  moveTask as applyTaskMove,
  rankBetween,
  reopenTask,
  reorderTask as applyTaskReorder,
  resolveReopenStatus,
  restoreTask,
  setParent as applyParent,
  systemClock,
  toLocalDate,
  toPlainDate,
  updateTaskFields,
  uuidv7,
  type Clock,
  type DayPlanSource,
  type PlainDate,
  type PlainTime,
  type Tag,
  type Task,
  type WorkflowStatus,
} from "@morrowlist/domain";

import type {
  Page,
  RankScope,
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

      const scope: RankScope = {
        workspaceId: request.workspaceId,
        projectId: destination?.id ?? null,
        statusId: destination?.status.id ?? null,
      };
      // New tasks land at the end of their scope so capture never reorders existing work.
      const lastRank = await tx.tasks.lastRankIn(scope);

      const task = createTask(
        {
          id,
          workspaceId: request.workspaceId,
          taskNumber: await tx.taskCounters.allocate(request.workspaceId),
          title: request.title,
          rank: rankBetween(lastRank, null),
          descriptionMd: request.descriptionMd ?? null,
          ...(request.priority ? { priority: request.priority } : {}),
          dueDate: (request.dueDate ?? null) as PlainDate | null,
          dueTime: (request.dueTime ?? null) as PlainTime | null,
          dueTimezone: request.dueTimezone ?? workspace.timezone,
          parentTaskId: parent?.id ?? null,
          project: destination,
        },
        { actor: actorRef(context), clock: this.clock },
      );

      await tx.tasks.insert(task);
      await recordEvent(tx, context, this.clock, {
        workspaceId: task.workspaceId,
        aggregateType: "task",
        aggregateId: task.id,
        eventType: TASK_EVENTS.created,
        summary: `Created task ${workspace.taskKeyPrefix}-${task.taskNumber}`,
        payload: {
          taskId: task.id,
          taskNumber: task.taskNumber,
          projectId: task.projectId,
          statusId: task.statusId,
          priority: task.priority,
          parentTaskId: task.parentTaskId,
        },
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
          inboxOnly: query.inbox,
          isCompleted: query.isCompleted,
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
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.mutate(context, workspaceId, taskId, request.expectedVersion, {
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
    });
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
   * end of that column; an Inbox task keeps its null project and status.
   */
  async complete(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    expectedVersion?: number,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.mutate(context, workspaceId, taskId, expectedVersion, {
      eventType: TASK_EVENTS.completed,
      summarize: () => "Completed task",
      apply: async (task, tx) => {
        const doneStatus = task.projectId
          ? await this.resolveDoneStatus(tx, task)
          : undefined;
        return completeTask(task, doneStatus ? { doneStatus } : {}, {
          actor: actorRef(context),
          clock: this.clock,
        });
      },
    });
  }

  /** Reopen a completed task, restoring its prior status where possible (spec 8.5). */
  async reopen(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    expectedVersion?: number,
  ): Promise<TaskDto> {
    assertWorkspaceAccess(context, workspaceId);
    assertScope(context, SCOPES.tasksWrite);

    return this.mutate(context, workspaceId, taskId, expectedVersion, {
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
   * Shared mutation pipeline: load, guard the expected version, apply a policy, persist
   * with an optimistic-concurrency check, and record activity plus an outbox event — all
   * in one transaction.
   */
  private async mutate(
    context: ActorContext,
    workspaceId: string,
    taskId: string,
    expectedVersion: number | undefined,
    step: {
      eventType: string;
      summarize: (next: Task, previous: Task) => string;
      apply: (task: Task, tx: TransactionContext) => Task | Promise<Task>;
      /** Event payload; defaults to the field-level diff (spec 18.2). */
      payload?: (next: Task, previous: Task) => Record<string, unknown>;
    },
    options: { allowDeleted?: boolean } = {},
  ): Promise<TaskDto> {
    return this.unitOfWork.execute(async (tx) => {
      const workspace = await this.requireWorkspace(tx, workspaceId);
      const previous = await this.requireTask(tx, workspaceId, taskId, options);

      assertExpectedVersion(previous, expectedVersion);

      const next = await step.apply(previous, tx);
      if (next === previous) {
        // The policy decided nothing material changed: no version bump, no event.
        return this.toDto(tx, workspace, previous);
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
        summary: step.summarize(next, previous),
        payload: step.payload
          ? step.payload(next, previous)
          : { taskId, changes: materialChanges(next, previous) },
      });

      return this.toDto(tx, workspace, next);
    });
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
   * Map tasks with their upcoming My Day dates (spec 9.5), their child progress and
   * their tags (spec 29.3), each loaded in one query for the whole page. Tags survive
   * every command here: completion, moves, deletion and restore all leave the relation
   * alone (spec 8.5).
   */
  private async toDtos(
    tx: TransactionContext,
    workspace: Workspace,
    tasks: readonly Task[],
  ): Promise<TaskDto[]> {
    const ids = tasks.map((task) => task.id);
    const [plans, progress, tags] = await Promise.all([
      tx.dayPlans.listForTasks(ids, this.workspaceToday(workspace.timezone)),
      tx.tasks.childSummary(workspace.id, ids),
      tx.tasks.tagsFor(workspace.id, ids),
    ]);
    return tasks.map((task) =>
      toTaskDto(
        task,
        workspace.taskKeyPrefix,
        plans.get(task.id) ?? [],
        progress.get(task.id) ?? null,
        tags.get(task.id) ?? [],
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

function parentChangePayload(next: Task, previous: Task): Record<string, unknown> {
  return {
    taskId: next.id,
    previousParentId: previous.parentTaskId,
    parentId: next.parentTaskId,
  };
}
